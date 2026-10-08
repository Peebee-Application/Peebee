"use client";

import type { Rental, RentalVehicle, SelfDriveResidenceMethod, SelfDriveRenterKycProfile } from "@peebee/shared";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import type { PlaceResult } from "../../components/PlaceFlow";
import { useRoadRoute } from "../../lib/useRoadRoute";
import { VehiclePhoto } from "../../components/VehiclePhoto";
import { RentalCarDetails } from "../../components/RentalCarDetails";
import { loadSelfDriveRoute } from "../../lib/selfdrive-route";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;
const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold";
const when = (iso: string) => new Date(iso).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" });
const rentalQuote = (v: RentalVehicle, period: "hourly" | "half_day" | "full_day", hours: number) => period === "hourly" ? (v.hourlyPrice ?? Math.round(v.dailyPrice * 1.2 / 24)) * hours : period === "half_day" ? v.halfDayPrice ?? Math.round(v.dailyPrice * 0.6) : v.dailyPrice;

export default function RentPage() {
  const router = useRouter();
  const [startsAt, setStartsAt] = useState("");
  const [licence, setLicence] = useState("");
  const [expiry, setExpiry] = useState("");
  const [vehicles, setVehicles] = useState<RentalVehicle[] | null>(null);
  const [periodType, setPeriodType] = useState<"hourly" | "half_day" | "full_day">("full_day");
  const [hourCount, setHourCount] = useState(1);
  const [mine, setMine] = useState<Rental[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [route, setRoute] = useState<PlaceResult | null>(null);
  const [fuelPrice, setFuelPrice] = useState(6900);
  const [renterProfile, setRenterProfile] = useState<SelfDriveRenterKycProfile | null>(null);
  const [kycOpen, setKycOpen] = useState(false);
  const [pendingVehicle, setPendingVehicle] = useState<RentalVehicle | null>(null);
  const [nin, setNin] = useState("");
  const [residentialAddress, setResidentialAddress] = useState("");
  const [residenceMethod, setResidenceMethod] = useState<SelfDriveResidenceMethod>("rent_and_landlord_letter");
  const [nationalIdFile, setNationalIdFile] = useState<File | null>(null);
  const [rentReceiptFile, setRentReceiptFile] = useState<File | null>(null);
  const [landlordLetterFile, setLandlordLetterFile] = useState<File | null>(null);
  const [residenceBillFile, setResidenceBillFile] = useState<File | null>(null);
  const [tenancyStart, setTenancyStart] = useState("");
  const [tenancyEnd, setTenancyEnd] = useState("");
  const [kycBusy, setKycBusy] = useState(false);
  const roadRoute = useRoadRoute(route?.pickup?.lat, route?.pickup?.lng, route?.destination.lat, route?.destination.lng);
  const roundTripKm = roadRoute ? roadRoute.route.distanceMeters / 1000 * 2 : null;
  const rentalEnd = () => {
    const start = new Date(startsAt);
    return new Date(start.getTime() + (periodType === "hourly" ? hourCount : periodType === "half_day" ? 6 : 24) * 3_600_000);
  };

  const loadMine = useCallback(() => {
    api.myRentals().then((r) => setMine(r.rentals)).catch(() => undefined);
  }, []);
  useEffect(() => {
    loadMine();
    const timer = window.setInterval(loadMine, 10000);
    const clock = window.setInterval(() => setNow(Date.now()), 30000);
    return () => { window.clearInterval(timer); window.clearInterval(clock); };
  }, [loadMine]);
  useEffect(() => { api.selfDriveRenterProfile().then(setRenterProfile).catch(() => setRenterProfile(null)); }, []);
  useEffect(() => { setRoute(loadSelfDriveRoute()); }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy("search");
    setError("");
    setNotice("");
    try {
      const end = rentalEnd();
      const res = await api.rentalSearch(new Date(startsAt).toISOString(), end.toISOString());
      setVehicles(res.vehicles);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function placeRental(v: RentalVehicle) {
    setBusy(v.id);
    setError("");
    try {
      const end = rentalEnd();
      const created = await api.rentalRequest({ vehicleId: v.id, startsAt: new Date(startsAt).toISOString(), endsAt: end.toISOString(), licenceNumber: licence, licenceExpiry: expiry, periodType });
      setNotice(created.status === "active" ? "Rental confirmed. The demo owner has handed over the car and the rental clock is running." : "Rental request sent. Rent and deposit are held from your wallet until the owner responds.");
      setVehicles(null);
      loadMine();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function request(v: RentalVehicle) {
    setError("");
    let profile = renterProfile;
    if (!profile) {
      try { profile = await api.selfDriveRenterProfile(); setRenterProfile(profile); }
      catch (err) { setError(errorMessage(err)); return; }
    }
    if (profile.status !== "approved") {
      setPendingVehicle(v);
      setKycOpen(true);
      setNotice("Complete renter identity and residence verification before placing this order.");
      return;
    }
    await placeRental(v);
  }

  async function submitRenterProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!nationalIdFile || (residenceMethod === "rent_and_landlord_letter" && (!rentReceiptFile || !landlordLetterFile)) || (residenceMethod === "bill" && !residenceBillFile)) {
      setError("Add your National ID scan and the selected proof of residence documents."); return;
    }
    setKycBusy(true); setError("");
    try {
      const result = await api.submitSelfDriveRenterProfile({ nin, residentialAddress, residenceMethod, nationalId: nationalIdFile, rentReceipt: rentReceiptFile ?? undefined, landlordLetter: landlordLetterFile ?? undefined, residenceBill: residenceBillFile ?? undefined, tenancyStart: tenancyStart || undefined, tenancyEnd: tenancyEnd || undefined });
      const updated = await api.selfDriveRenterProfile();
      setRenterProfile(updated);
      setKycOpen(false);
      setNotice(result.status === "approved" ? "Practice verification is simulated. Your demo rental can continue." : "Your verification documents were submitted privately for review. You can place the rental order after approval.");
      if (updated.status === "approved" && pendingVehicle) { const chosen = pendingVehicle; setPendingVehicle(null); await placeRental(chosen); }
    } catch (err) { setError(errorMessage(err)); }
    finally { setKycBusy(false); }
  }

  async function refreshRenterProfile() {
    try {
      const updated = await api.selfDriveRenterProfile();
      setRenterProfile(updated);
      if (updated.status === "approved" && pendingVehicle) { const chosen = pendingVehicle; setPendingVehicle(null); setKycOpen(false); setNotice("Your profile is approved. Continuing with your selected car."); await placeRental(chosen); }
    } catch (err) { setError(errorMessage(err)); }
  }

  async function cancel(id: string) {
    setError("");
    try {
      await api.cancelRental(id);
      loadMine();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function finishDemo(id: string) {
    setError("");
    try { await api.finishDemoRental(id); setNotice("Demo car returned. Rental settlement and deposit return are complete."); loadMine(); }
    catch (err) { setError(errorMessage(err)); }
  }

  return (
    <div className="space-y-4 px-4 pb-24 pt-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => router.back()} aria-label="Back" className="-ml-1.5 flex h-8 w-8 items-center justify-center rounded-full text-ink-500">
          <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <h1 className="text-xl font-bold text-ink">Selfdrive</h1>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm font-medium text-green">{notice}</p>}
      {renterProfile?.isSimulated && <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-ink-500">Sandbox/Practice: renter verification is simulated. Do not upload real identity documents here.</p>}

      {renterProfile?.status !== "approved" && (
        <section className="home-card space-y-2">
          <h2 className="text-sm font-bold text-ink">Renter identity and residence verification</h2>
          <p className="text-xs text-ink-500">Self-drive orders require your 14-character NIN, a National ID scan, and proof that you currently live at your stated residence. Only authorised Peebee reviewers can view these documents; car owners cannot.</p>
          {renterProfile?.status === "pending" && <p className="text-xs font-semibold text-ink">Your documents are awaiting review. {renterProfile.ninMasked ?? "NIN received"}.</p>}
          {renterProfile?.status === "rejected" && <p className="text-xs font-semibold text-ink">Please correct and resubmit: {renterProfile.reviewNotes ?? "The documents need an update."}</p>}
          {renterProfile?.status === "pending" && <button type="button" onClick={refreshRenterProfile} className="min-h-9 rounded-full bg-gold/15 px-3 text-xs font-bold text-ink">Check review status</button>}
          {renterProfile?.status !== "pending" && <button type="button" onClick={() => setKycOpen((value) => !value)} className="min-h-9 rounded-full bg-gold px-3 text-xs font-bold text-ink-gold">{kycOpen ? "Close verification form" : renterProfile?.status === "rejected" ? "Update verification profile" : "Complete verification profile"}</button>}
        </section>
      )}
      {kycOpen && renterProfile?.status !== "approved" && (
        <form onSubmit={submitRenterProfile} className="home-card space-y-3">
          <h2 className="text-sm font-bold text-ink">1 · Confirm your identity</h2>
          <label className="block space-y-1 text-xs font-semibold text-ink-500">National Identification Number (NIN)<input required value={nin} onChange={(e) => setNin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14))} maxLength={14} minLength={14} autoComplete="off" placeholder="14-character NIN" className={field} /></label>
          <label className="block space-y-1 text-xs font-semibold text-ink-500">Current residential address<input required minLength={5} maxLength={250} value={residentialAddress} onChange={(e) => setResidentialAddress(e.target.value)} placeholder="Area, street or village, house number or landmark" className={field} /></label>
          <label className="block space-y-1 text-xs font-semibold text-ink-500">Scanned National ID (photo or PDF)<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setNationalIdFile(e.target.files?.[0] ?? null)} className={field} /></label>
          <h2 className="pt-1 text-sm font-bold text-ink">2 · Prove your current residence</h2>
          <label className="block space-y-1 text-xs font-semibold text-ink-500">Choose one proof option<select value={residenceMethod} onChange={(e) => setResidenceMethod(e.target.value as SelfDriveResidenceMethod)} className={field}><option value="rent_and_landlord_letter">Recent rent receipt + landlord/landlady letter</option><option value="bill">Utility or service bill in my name</option></select></label>
          {residenceMethod === "rent_and_landlord_letter" ? (
            <>
              <p className="text-xs text-ink-500">The letter should confirm that you are a tenant and state the tenancy agreement period. Upload both items.</p>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Recent rent payment receipt<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setRentReceiptFile(e.target.files?.[0] ?? null)} className={field} /></label>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Landlord/landlady tenancy letter<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setLandlordLetterFile(e.target.files?.[0] ?? null)} className={field} /></label>
              <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs font-semibold text-ink-500">Agreement starts<input required type="date" value={tenancyStart} onChange={(e) => setTenancyStart(e.target.value)} className={field} /></label><label className="space-y-1 text-xs font-semibold text-ink-500">Agreement ends<input required type="date" value={tenancyEnd} onChange={(e) => setTenancyEnd(e.target.value)} className={field} /></label></div>
            </>
          ) : (
            <>
              <p className="text-xs text-ink-500">Use a recent electricity, water, internet or other service bill that shows your name and current address.</p>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Bill in your name<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setResidenceBillFile(e.target.files?.[0] ?? null)} className={field} /></label>
            </>
          )}
          <p className="text-xs text-ink-500">Accepted: JPG, PNG, WebP or PDF, up to 8 MB each. Documents are sent privately for manual review and are not shown to vehicle owners.</p>
          <button disabled={kycBusy} className="min-h-11 w-full rounded-full bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-60">{kycBusy ? "Submitting…" : "Submit for verification"}</button>
        </form>
      )}

      <form onSubmit={search} className="home-card space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Pickup</label>
          <input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Rental period</label>
          <select value={periodType} onChange={(e) => setPeriodType(e.target.value as typeof periodType)} className={field}>
            <option value="hourly">Hourly</option><option value="half_day">Half-day · 6 hours</option><option value="full_day">Full day · 24 hours</option>
          </select>
          {periodType === "hourly" && <input aria-label="Number of rental hours" type="number" min={1} max={24} value={hourCount} onChange={(e) => setHourCount(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} className={field} />}
          <p className="text-xs text-ink-500">Scheduled return: {startsAt ? when(rentalEnd().toISOString()) : "Choose a pickup time"}. Time starts when the owner hands over the car.</p>
        </div>
        <input required value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="Driving licence number" className={field} />
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Licence expiry</label>
          <input required type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={field} />
        </div>
        <button disabled={busy === "search"} className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60">{busy === "search" ? "Searching…" : "Find cars"}</button>
      </form>

      {vehicles && vehicles.length === 0 && <p className="text-sm text-ink-500">No cars are free for those dates.</p>}
      {vehicles?.map((v) => (
        <section key={v.id} className="home-card space-y-2">
          {v.photos?.length ? <div className="grid grid-cols-2 gap-2">{v.photos.slice(0, 4).map((photoId) => <VehiclePhoto key={photoId} vehicleId={v.id} photoId={photoId} />)}</div> : null}
          <p className="text-sm font-bold text-ink">{v.name}</p>
          <p className="text-xs text-ink-500">{v.category}{v.seats ? ` · ${v.seats} seats` : ""} · {v.serviceClass === "comfort" ? "Comfort" : "Convenient"}</p>
          <RentalCarDetails vehicle={v} roundTripKm={roundTripKm} routeLabel={route ? `${route.pickup?.label ?? "Pickup"} → ${route.destination.label}` : null} fuelPrice={fuelPrice} onFuelPriceChange={setFuelPrice} />
          <div className="grid grid-cols-3 gap-2 text-xs text-ink-500"><span className={v.hourlyEnabled === false ? "opacity-40" : ""}>Hourly<br/><strong className="text-ink">{ugx(v.hourlyPrice ?? Math.round(v.dailyPrice * 1.2 / 24))}/hr</strong></span><span className={v.halfDayEnabled === false ? "opacity-40" : ""}>6 hours<br/><strong className="text-ink">{ugx(v.halfDayPrice ?? Math.round(v.dailyPrice * 0.6))}</strong></span><span className={v.fullDayEnabled === false ? "opacity-40" : ""}>24 hours<br/><strong className="text-ink">{ugx(v.dailyPrice)}</strong></span></div>
          <p className="text-sm text-ink">Selected {periodType.replace("_", " ")} = <strong>{ugx(rentalQuote(v, periodType, hourCount))}</strong></p>
          <p className="text-xs text-ink-500">Plus a refundable deposit of {ugx(v.deposit)}. Both are taken from your wallet and held; the deposit comes back when the car is returned undamaged.</p>
          <button disabled={busy === v.id || (periodType === "hourly" && v.hourlyEnabled === false) || (periodType === "half_day" && v.halfDayEnabled === false) || (periodType === "full_day" && v.fullDayEnabled === false)} onClick={() => request(v)} className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-60">{busy === v.id ? "Please wait…" : `Request · ${ugx(rentalQuote(v, periodType, hourCount) + v.deposit)} held`}</button>
        </section>
      ))}

      {mine.length > 0 && <h2 className="pt-2 text-lg font-bold text-ink">My rentals</h2>}
      {mine.map((r) => (
        <section key={r.id} className="home-card space-y-1">
          <p className="text-sm font-bold text-ink">{r.vehicle ?? r.plate} <span className="font-normal text-ink-500">· {r.status}</span></p>
          <p className="text-xs text-ink-500">{when(r.starts_at)} → {when(r.ends_at)} · owner {r.owner_name} · {r.period_type?.replace("_", " ") ?? "full day"}</p>
          {r.handed_over_at && r.status === "active" && <p className="text-xs font-semibold text-ink">Timer: {Math.max(0, Math.floor((now - new Date(r.handed_over_at).getTime()) / 3_600_000))} hours elapsed since handover at {when(r.handed_over_at)}. Due {when(r.ends_at)}; the configured grace period applies{r.hourly_price ? `, then ${ugx(r.hourly_price)} per started hour.` : "."}</p>}
          {r.status === "active" && (r.vehicle_id.startsWith("demo-rent-") || r.vehicle_id.startsWith("practice-rent-")) && <button type="button" onClick={() => finishDemo(r.id)} className="min-h-10 w-full rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">Return demo car and settle rental</button>}
          <p className="text-xs text-ink-500">Rent {ugx(r.rent_amount)} · deposit {ugx(r.deposit_amount)}</p>
          {r.status === "completed" && r.refund_amount != null && <p className="text-xs font-semibold text-ink">Deposit returned: {ugx(r.refund_amount)}</p>}
          {r.status === "completed" && Number(r.overtime_amount ?? 0) > 0 && <p className="text-xs text-ink-500">Overtime fee settled: {ugx(Number(r.overtime_amount))}</p>}
          {r.status === "disputed" && <p className="text-xs text-ink-500">The owner reported damage. Peebee is reviewing it before your deposit is settled.</p>}
          {(r.status === "requested" || r.status === "approved") && (
            <button type="button" onClick={() => cancel(r.id)} className="text-sm font-bold text-gold">Cancel and get my money back</button>
          )}
        </section>
      ))}
    </div>
  );
}
