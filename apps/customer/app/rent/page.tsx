"use client";

import type { Rental, RentalVehicle, SelfDriveResidenceMethod, SelfDriveRenterKycProfile } from "@peebee/shared";
import { ChevronLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import type { PlaceResult } from "../../components/PlaceFlow";
import { useRoadRoute } from "../../lib/useRoadRoute";
import { RentalVehicleGallery } from "../../components/RentalVehicleGallery";
import { RentalCarDetails } from "../../components/RentalCarDetails";
import { loadSelfDriveRoute } from "../../lib/selfdrive-route";

const ugx = (n: number | null) => `UGX ${Number(n ?? 0).toLocaleString("en-UG")}`;
const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold";
const when = (iso: string) => new Date(iso).toLocaleString("en-UG", { dateStyle: "medium", timeStyle: "short" });
const rentalQuote = (v: RentalVehicle, period: "hourly" | "half_day" | "full_day", hours: number) => period === "hourly" ? (v.hourlyPrice ?? Math.round(v.dailyPrice * 1.2 / 24)) * hours : period === "half_day" ? v.halfDayPrice ?? Math.round(v.dailyPrice * 0.6) : v.dailyPrice;
const defaultPickup = () => {
  const pickup = new Date(Date.now() + 30 * 60_000);
  pickup.setMinutes(Math.ceil(pickup.getMinutes() / 30) * 30, 0, 0);
  const local = new Date(pickup.getTime() - pickup.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
};
const rentalEndAt = (startsAt: string, period: "hourly" | "half_day" | "full_day", hours: number) => {
  const start = new Date(startsAt);
  return new Date(start.getTime() + (period === "hourly" ? hours : period === "half_day" ? 6 : 24) * 3_600_000);
};

export default function RentPage() {
  const router = useRouter();
  const [initialPickup] = useState(defaultPickup);
  const [startsAt, setStartsAt] = useState(initialPickup);
  const [licence, setLicence] = useState("");
  const [expiry, setExpiry] = useState("");
  const [vehicles, setVehicles] = useState<RentalVehicle[] | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<RentalVehicle | null>(null);
  const [bookingStep, setBookingStep] = useState<"details" | "payment" | null>(null);
  const [periodType, setPeriodType] = useState<"hourly" | "half_day" | "full_day">("full_day");
  const [hourCount, setHourCount] = useState(1);
  const [mine, setMine] = useState<Rental[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(Date.now());
  const [route, setRoute] = useState<PlaceResult | null>(null);
  const [fuelPrice, setFuelPrice] = useState(6900);
  const [fuelUseOverrides, setFuelUseOverrides] = useState<Record<string, number | null>>({});
  const [tripDistanceOverrides, setTripDistanceOverrides] = useState<Record<string, number | null>>({});
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
  const rentalEnd = () => rentalEndAt(startsAt, periodType, hourCount);

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
  useEffect(() => {
    let current = true;
    setBusy("search");
    api.rentalSearch(new Date(initialPickup).toISOString(), rentalEndAt(initialPickup, "full_day", 1).toISOString())
      .then((res) => { if (current) setVehicles(res.vehicles.filter((vehicle) => vehicle.hourlyEnabled !== false || vehicle.halfDayEnabled !== false || vehicle.fullDayEnabled !== false)); })
      .catch((err) => { if (current) setError(errorMessage(err)); })
      .finally(() => { if (current) setBusy(null); });
    return () => { current = false; };
  }, [initialPickup]);

  async function continueToPayment(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    if (!selectedVehicle || !startsAt) return;
    const end = rentalEnd();
    if (expiry && new Date(`${expiry}T23:59:59Z`).getTime() < end.getTime()) {
      setError("Your driving licence must remain valid through the rental return time.");
      return;
    }
    setBusy("availability");
    try {
      const res = await api.rentalSearch(new Date(startsAt).toISOString(), end.toISOString());
      const available = res.vehicles.filter((vehicle) => vehicle.hourlyEnabled !== false || vehicle.halfDayEnabled !== false || vehicle.fullDayEnabled !== false);
      setVehicles(available);
      const refreshedSelection = available.find((vehicle) => vehicle.id === selectedVehicle.id);
      if (!refreshedSelection) {
        setSelectedVehicle(null);
        setBookingStep(null);
        setError("That car is no longer available for the selected dates. Choose another available car.");
        return;
      }
      setSelectedVehicle(refreshedSelection);
      let profile = renterProfile;
      if (!profile) {
        profile = await api.selfDriveRenterProfile();
        setRenterProfile(profile);
      }
      if (profile.status !== "approved") {
        setKycOpen(true);
        setNotice(profile.status === "pending"
          ? "Your renter documents are awaiting review. Payment becomes available after approval."
          : "Complete renter identity and residence checks before payment.");
        return;
      }
      setBookingStep("payment");
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
      setNotice(created.status === "active" ? "Rental confirmed. The demo owner has handed over the car and the rental clock is running." : "Payment held. Your rental request is with the vehicle owner for approval.");
      setVehicles((current) => current?.filter((vehicle) => vehicle.id !== v.id) ?? current);
      setSelectedVehicle(null);
      setBookingStep(null);
      loadMine();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function request(v: RentalVehicle) {
    setError("");
    setNotice("");
    setSelectedVehicle(v);
    setPendingVehicle(v);
    setBookingStep("details");
    setKycOpen(false);
    setStartsAt(initialPickup);
    setPeriodType(v.fullDayEnabled !== false ? "full_day" : v.halfDayEnabled !== false ? "half_day" : "hourly");
    setHourCount(1);
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
      setNotice(result.status === "approved" ? "Verification approved. Review your rental and payment details to continue." : "Your documents were submitted privately for review. Payment will be available after approval.");
      if (updated.status === "approved" && pendingVehicle) setBookingStep("payment");
    } catch (err) { setError(errorMessage(err)); }
    finally { setKycBusy(false); }
  }

  async function refreshRenterProfile() {
    try {
      const updated = await api.selfDriveRenterProfile();
      setRenterProfile(updated);
      if (updated.status === "approved" && pendingVehicle) { setKycOpen(false); setBookingStep("payment"); setNotice("Your profile is approved. Review the rental total to continue to payment."); }
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
    <div className="space-y-4 px-4 pt-4">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => router.back()} aria-label="Back" className="-ml-1.5 flex h-8 w-8 items-center justify-center rounded-full text-ink-500">
          <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
        </button>
        <h1 className="text-xl font-bold text-ink">Selfdrive</h1>
      </div>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && <p className="text-sm font-medium text-green">{notice}</p>}
      {renterProfile?.isSimulated && <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-ink-500">Sandbox/Practice: renter verification is simulated. Do not upload real identity documents here.</p>}

      {bookingStep && selectedVehicle ? (
        <>
          <button type="button" onClick={() => { setSelectedVehicle(null); setPendingVehicle(null); setBookingStep(null); setKycOpen(false); setError(""); setNotice(""); }} className="min-h-9 rounded-full bg-[rgb(var(--surface-muted))] px-3 text-sm font-semibold text-ink">‹ Available cars</button>
          <section className="overflow-hidden rounded-[28px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-[var(--shadow-card)]">
            <RentalVehicleGallery vehicleId={selectedVehicle.id} photoIds={selectedVehicle.photos ?? []} name={selectedVehicle.name} />
            <div className="space-y-3 p-4">
              <h2 className="text-lg font-bold text-ink">{selectedVehicle.name}</h2>
              <p className="text-sm text-ink-500">{selectedVehicle.category}{selectedVehicle.seats ? ` · ${selectedVehicle.seats} seats` : ""} · {selectedVehicle.serviceClass === "comfort" ? "Comfort" : "Convenient"}</p>
              <details className="group rounded-2xl border border-[var(--border-faint)] px-3">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink marker:hidden [&::-webkit-details-marker]:hidden"><span>Fuel estimate & vehicle details</span><span className="text-xs text-ink-500 group-open:rotate-180">⌄</span></summary>
                <div className="pb-3"><RentalCarDetails vehicle={selectedVehicle} roundTripKm={roundTripKm} routeLabel={route ? `${route.pickup?.label ?? "Pickup"} → ${route.destination.label}` : null} fuelPrice={fuelPrice} onFuelPriceChange={setFuelPrice} fuelUsePer100Km={Object.hasOwn(fuelUseOverrides, selectedVehicle.id) ? fuelUseOverrides[selectedVehicle.id] : selectedVehicle.fuelLitresPerKm != null ? selectedVehicle.fuelLitresPerKm * 100 : null} onFuelUseChange={(value) => setFuelUseOverrides((current) => ({ ...current, [selectedVehicle.id]: value }))} tripDistanceKm={Object.hasOwn(tripDistanceOverrides, selectedVehicle.id) ? tripDistanceOverrides[selectedVehicle.id] : roundTripKm} onTripDistanceChange={(value) => setTripDistanceOverrides((current) => ({ ...current, [selectedVehicle.id]: value }))} /></div>
              </details>
            </div>
          </section>

          {bookingStep === "details" ? (
            <form onSubmit={continueToPayment} className="home-card space-y-4">
              <div><p className="text-xs font-bold uppercase tracking-wide text-gold">Booking details</p><h2 className="mt-1 text-lg font-bold text-ink">When do you need it?</h2></div>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Pickup time<input required type="datetime-local" min={defaultPickup()} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={field} /></label>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-ink-500">Rental period</label>
                <select value={periodType} onChange={(e) => setPeriodType(e.target.value as typeof periodType)} className={field}>
                  <option value="hourly" disabled={selectedVehicle.hourlyEnabled === false}>Hourly</option><option value="half_day" disabled={selectedVehicle.halfDayEnabled === false}>Half-day · 6 hours</option><option value="full_day" disabled={selectedVehicle.fullDayEnabled === false}>Full day · 24 hours</option>
                </select>
                {periodType === "hourly" && <label className="block space-y-1 text-xs font-semibold text-ink-500">Number of hours<input aria-label="Number of rental hours" type="number" min={1} max={24} value={hourCount} onChange={(e) => setHourCount(Math.min(24, Math.max(1, Number(e.target.value) || 1)))} className={field} /></label>}
                <p className="text-xs text-ink-500">Return by {when(rentalEnd().toISOString())}. Rental time starts when the owner hands over the car.</p>
              </div>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Driving licence number<input required minLength={4} maxLength={30} value={licence} onChange={(e) => setLicence(e.target.value)} placeholder="Enter your licence number" className={field} /></label>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Licence expiry date<input required type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className={field} /></label>
              <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-sm">
                <div className="flex justify-between gap-3"><span className="text-ink-500">Rental</span><b className="text-ink">{ugx(rentalQuote(selectedVehicle, periodType, hourCount))}</b></div>
                <div className="mt-1 flex justify-between gap-3"><span className="text-ink-500">Refundable deposit</span><b className="text-ink">{ugx(selectedVehicle.deposit)}</b></div>
              </div>
              <button disabled={busy === "availability" || (periodType === "hourly" && selectedVehicle.hourlyEnabled === false) || (periodType === "half_day" && selectedVehicle.halfDayEnabled === false) || (periodType === "full_day" && selectedVehicle.fullDayEnabled === false)} className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60">{busy === "availability" ? "Checking availability…" : "Continue to verification and payment"}</button>
            </form>
          ) : (
            <section className="home-card space-y-4">
              <div><p className="text-xs font-bold uppercase tracking-wide text-gold">Payment</p><h2 className="mt-1 text-lg font-bold text-ink">Review your rental</h2></div>
              <div className="space-y-2 rounded-2xl bg-[rgb(var(--surface-muted))] p-4 text-sm">
                <div className="flex justify-between gap-3"><span className="text-ink-500">Pickup</span><b className="text-right text-ink">{when(new Date(startsAt).toISOString())}</b></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Return</span><b className="text-right text-ink">{when(rentalEnd().toISOString())}</b></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Rental ({periodType.replace("_", " ")})</span><b className="text-ink">{ugx(rentalQuote(selectedVehicle, periodType, hourCount))}</b></div>
                <div className="flex justify-between gap-3"><span className="text-ink-500">Refundable deposit</span><b className="text-ink">{ugx(selectedVehicle.deposit)}</b></div>
                <div className="border-t border-[var(--border-faint)] pt-2"><div className="flex justify-between gap-3 text-base"><b className="text-ink">Total due now</b><b className="text-ink">{ugx(rentalQuote(selectedVehicle, periodType, hourCount) + selectedVehicle.deposit)}</b></div></div>
              </div>
              <p className="text-xs text-ink-500">Payment uses your Peebee wallet. Rent and the refundable deposit are held while the vehicle owner responds. The deposit is returned when the car is returned undamaged.</p>
              <button type="button" onClick={() => setBookingStep("details")} className="min-h-10 w-full rounded-full border border-[var(--border-faint)] px-4 text-sm font-semibold text-ink">Edit booking details</button>
              <button type="button" disabled={busy === selectedVehicle.id} onClick={() => placeRental(selectedVehicle)} className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60">{busy === selectedVehicle.id ? "Processing payment…" : `Pay ${ugx(rentalQuote(selectedVehicle, periodType, hourCount) + selectedVehicle.deposit)} from wallet`}</button>
            </section>
          )}

          {renterProfile?.status !== "approved" && (
            <section className="home-card space-y-2">
              <h2 className="text-sm font-bold text-ink">Renter identity and residence verification</h2>
              <p className="text-xs text-ink-500">Self-drive rentals require your 14-character NIN, a National ID scan and proof of current residence. Documents are reviewed by authorised Peebee staff and are not shared with vehicle owners.</p>
              {renterProfile?.status === "pending" && <><p className="text-xs font-semibold text-ink">Your documents are awaiting review. {renterProfile.ninMasked ?? "NIN received"}.</p><button type="button" onClick={refreshRenterProfile} className="min-h-9 rounded-full bg-gold/15 px-3 text-xs font-bold text-ink">Check review status</button></>}
              {renterProfile?.status === "rejected" && <p className="text-xs font-semibold text-ink">Please correct and resubmit: {renterProfile.reviewNotes ?? "The documents need an update."}</p>}
              {renterProfile?.status !== "pending" && <button type="button" onClick={() => setKycOpen((value) => !value)} className="min-h-9 rounded-full bg-gold px-3 text-xs font-bold text-ink-gold">{kycOpen ? "Close verification form" : renterProfile?.status === "rejected" ? "Update verification profile" : "Complete renter verification"}</button>}
            </section>
          )}
          {kycOpen && renterProfile?.status !== "approved" && (
            <form onSubmit={submitRenterProfile} className="home-card space-y-3">
              <h2 className="text-sm font-bold text-ink">Identity and residence checks</h2>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">National Identification Number (NIN)<input required value={nin} onChange={(e) => setNin(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14))} maxLength={14} minLength={14} autoComplete="off" placeholder="14-character NIN" className={field} /></label>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Current residential address<input required minLength={5} maxLength={250} value={residentialAddress} onChange={(e) => setResidentialAddress(e.target.value)} placeholder="Area, street or village, house number or landmark" className={field} /></label>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Scanned National ID (photo or PDF)<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setNationalIdFile(e.target.files?.[0] ?? null)} className={field} /></label>
              <label className="block space-y-1 text-xs font-semibold text-ink-500">Proof of residence<select value={residenceMethod} onChange={(e) => setResidenceMethod(e.target.value as SelfDriveResidenceMethod)} className={field}><option value="rent_and_landlord_letter">Recent rent receipt + landlord/landlady letter</option><option value="bill">Utility or service bill in my name</option></select></label>
              {residenceMethod === "rent_and_landlord_letter" ? <>
                <p className="text-xs text-ink-500">The letter should confirm that you are a tenant and state the tenancy period.</p>
                <label className="block space-y-1 text-xs font-semibold text-ink-500">Recent rent payment receipt<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setRentReceiptFile(e.target.files?.[0] ?? null)} className={field} /></label>
                <label className="block space-y-1 text-xs font-semibold text-ink-500">Landlord/landlady tenancy letter<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setLandlordLetterFile(e.target.files?.[0] ?? null)} className={field} /></label>
                <div className="grid grid-cols-2 gap-3"><label className="space-y-1 text-xs font-semibold text-ink-500">Agreement starts<input required type="date" value={tenancyStart} onChange={(e) => setTenancyStart(e.target.value)} className={field} /></label><label className="space-y-1 text-xs font-semibold text-ink-500">Agreement ends<input required type="date" value={tenancyEnd} onChange={(e) => setTenancyEnd(e.target.value)} className={field} /></label></div>
              </> : <label className="block space-y-1 text-xs font-semibold text-ink-500">Bill in your name<input required type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setResidenceBillFile(e.target.files?.[0] ?? null)} className={field} /></label>}
              <p className="text-xs text-ink-500">Accepted: JPG, PNG, WebP or PDF, up to 8 MB each. Documents are submitted privately for manual review.</p>
              <button disabled={kycBusy} className="min-h-11 w-full rounded-full bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-60">{kycBusy ? "Submitting…" : "Submit for verification"}</button>
            </form>
          )}
        </>
      ) : (
        <>
          <section className="space-y-1"><h2 className="text-lg font-bold text-ink">Available cars</h2><p className="text-sm text-ink-500">Choose a car first. You’ll confirm dates, licence and renter checks before payment.</p></section>
          {vehicles === null && <div className="home-card text-sm text-ink-500">{busy === "search" ? "Finding cars available for the next 24 hours…" : "Car listings are loading…"}</div>}
          {vehicles?.length === 0 && <div className="home-card space-y-1"><p className="font-semibold text-ink">No cars are available right now.</p><p className="text-sm text-ink-500">Please check again shortly or return later.</p></div>}
          {vehicles?.map((v) => (
            <section key={v.id} className="overflow-hidden rounded-[28px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-[var(--shadow-card)]">
              <RentalVehicleGallery vehicleId={v.id} photoIds={v.photos ?? []} name={v.name} />
              <div className="space-y-3 p-4">
                <div><p className="text-base font-bold text-ink">{v.name}</p><p className="mt-1 text-sm text-ink-500">{v.category}{v.seats ? ` · ${v.seats} seats` : ""} · {v.serviceClass === "comfort" ? "Comfort" : "Convenient"}</p></div>
                <div className="flex items-end justify-between gap-3 rounded-2xl bg-[rgb(var(--surface-muted))] p-3"><div><p className="text-xs text-ink-500">From</p><p className="text-lg font-bold text-ink">{ugx(v.hourlyPrice ?? Math.round(v.dailyPrice * 1.2 / 24))}<span className="text-xs font-medium text-ink-500"> / hour</span></p><p className="text-xs text-ink-500">or {ugx(v.dailyPrice)} per day</p></div><p className="text-right text-xs text-ink-500">Refundable deposit<br/><b className="text-sm text-ink">{ugx(v.deposit)}</b></p></div>
                <button type="button" onClick={() => request(v)} className="min-h-12 w-full rounded-full bg-gold px-4 font-bold text-ink-gold">Book this car</button>
              </div>
            </section>
          ))}
        </>
      )}

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
