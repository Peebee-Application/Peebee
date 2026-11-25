"use client";

import { TAXIPRESS_VAN_FEATURES, taxipressTown, taxipressVanClassLabel, type TaxipressTaxiProfile } from "@peebee/shared";
import { Star, Ticket, User } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { api, errorMessage } from "../../../../../lib/api";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../../../../../lib/nav-primary-action";
import { clock, journey, ordinal, ugx } from "../../../../../lib/taxipress-draft";
import { useTaxipress } from "../../../../../lib/taxipress";

export default function Page() {
  return <Suspense fallback={null}><TaxiProfile /></Suspense>;
}

/** Optional taxi profile. Only real records are shown; a stat with no data yet is left out, never invented. */
function TaxiProfile() {
  const { queueId } = useParams<{ queueId: string }>();
  const routeParam = useSearchParams().get("route");
  const router = useRouter();
  const taxipress = useTaxipress();
  const [profile, setProfile] = useState<TaxipressTaxiProfile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    api.getTaxipressTaxiProfile(queueId).then((r) => { if (live) setProfile(r.profile); }).catch((err) => { if (live) setError(errorMessage(err)); });
    return () => { live = false; };
  }, [queueId]);

  const routeId = profile?.route.id ?? routeParam;
  const fare = taxipress.routes.find((r) => r.id === routeId)?.farePerSeat;
  useRegisterNavBack(true, () => router.push(routeId ? `/ride/taxipress/book/${routeId}` : "/ride/taxipress"));
  useRegisterNavPrimaryAction(profile?.bookable ? {
    tone: "gold",
    icon: Ticket,
    label: "Book a seat",
    detail: `${profile.seatsLeft} left`,
    sublabel: fare ? `${ugx(fare)} / seat` : undefined,
    onClick: () => router.push(`/ride/taxipress/book/${profile.route.id}?taxi=${profile.queueId}`),
  } : null);

  if (error) return <main className="px-4 pt-4"><p role="alert" className="text-sm text-ink-500">{error}</p></main>;
  if (!profile) return null;

  const since = profile.memberSince ? new Date(profile.memberSince) : null;
  const stats = [
    profile.tripsCount != null ? { value: profile.tripsCount.toLocaleString("en-UG"), label: profile.tripsCount === 1 ? "trip" : "trips" } : null,
    since ? { value: since.toLocaleDateString("en-UG", { month: "short", year: "numeric" }), label: "member since" } : null,
  ].filter(Boolean) as Array<{ value: string; label: string }>;
  const vehicle = [profile.vehicleType ?? (profile.seatLayout === "18" ? "Standard van" : "VIP van"), `${profile.passengerCapacity} passengers`].join(" · ");
  const place = profile.status === "boarding" ? "Boarding now" : profile.position ? `${ordinal(profile.position)} in line` : null;

  return (
    <main className="space-y-4 px-4 pb-8 pt-4">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-gold">Taxi profile · optional</p>
      <section className="home-card flex flex-col items-center gap-2 border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 text-center">
        {profile.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={profile.photoUrl} alt={`${profile.plate}`} className="h-20 w-20 rounded-full object-cover" />
        ) : (
          <span className="flex h-20 w-20 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink-500"><User className="h-9 w-9" aria-hidden /></span>
        )}
        <h1 className="text-2xl font-black text-ink">{profile.driverName ?? profile.plate}</h1>
        <p className="text-sm text-ink-500">TaxiPress driver · {taxipressTown(profile.route.fromName)} → {taxipressTown(profile.route.toName)}</p>
        <p className="rounded-full bg-gold/15 px-3 py-1 text-xs font-bold text-ink">{taxipressVanClassLabel(profile.seatLayout, profile.passengerCapacity)}</p>
        {profile.rating != null && profile.ratingCount != null && (
          <p className="flex items-center gap-1 text-sm font-bold text-ink"><Star className="h-4 w-4 fill-gold text-gold" aria-hidden /> {profile.rating.toFixed(1)} <span className="font-normal text-ink-500">({profile.ratingCount} review{profile.ratingCount === 1 ? "" : "s"})</span></p>
        )}
      </section>

      {stats.length > 0 && (
        <section className={`grid gap-2 ${stats.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
          {stats.map((s) => (
            <div key={s.label} className="home-card min-w-0 border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3 text-center">
              <p className="whitespace-nowrap text-lg font-black text-ink">{s.value}</p>
              <p className="whitespace-nowrap text-xs text-ink-500">{s.label}</p>
            </div>
          ))}
        </section>
      )}

      <section className="home-card space-y-2 border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-sm">
        <Row label="Plate" value={profile.plate} mono />
        <Row label="Vehicle" value={vehicle} />
        {profile.colour && <Row label="Colour" value={profile.colour} />}
        {place && <Row label="Queue" value={`${place}${profile.departsAt ? ` · ~${clock(profile.departsAt)}` : ""}`} />}
      </section>

      {profile.driverBio && (
        <section className="home-card border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-sm">
          <h2 className="mb-1 font-bold text-ink">About the driver</h2>
          <p className="text-ink-500">{profile.driverBio}</p>
        </section>
      )}

      {profile.features.length > 0 && (
        <section className="home-card border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-sm">
          <h2 className="mb-2 font-bold text-ink">Van features</h2>
          <div className="flex flex-wrap gap-2">
            {profile.features.map((feature) => <span key={feature} className="rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1 font-semibold text-ink">{Object.values(TAXIPRESS_VAN_FEATURES).flat().find((item) => item.id === feature)?.label ?? feature}</span>)}
          </div>
        </section>
      )}

      {profile.route.stops.length > 0 && (
        <section className="home-card border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 text-sm">
          <h2 className="mb-1 font-bold text-ink">Stops</h2>
          <p className="text-ink-500">{journey(profile.route.fromName, profile.route.stops, profile.route.toName).join(" → ")}</p>
        </section>
      )}

      {profile.reviews.length > 0 && (
        <section className="space-y-2">
          <h2 className="px-1 text-base font-bold text-ink">Reviews</h2>
          {profile.reviews.map((r, i) => (
            <div key={i} className="home-card border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3 text-sm">
              <p className="flex items-center gap-1 text-xs text-ink-500"><Star className="h-3.5 w-3.5 fill-gold text-gold" aria-hidden /> {r.rating} · {new Date(r.createdAt).toLocaleDateString("en-UG", { day: "numeric", month: "short" })}</p>
              {r.comment && <p className="mt-1 text-ink">{r.comment}</p>}
            </div>
          ))}
        </section>
      )}
      {!profile.bookable && profile.status !== "boarding" && <p className="text-xs text-ink-500">This taxi opens for booking as the line moves up.</p>}
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      <span className={`text-right font-bold text-ink ${mono ? "font-mono tracking-wider" : ""}`}>{value}</span>
    </div>
  );
}
