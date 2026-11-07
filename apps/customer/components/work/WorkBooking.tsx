"use client";

import type { SavedLocation, WorkMatchingMode, WorkPublicSettings, WorkService, WorkServiceType } from "@peebee/shared";
import { Clock, LocateFixed, MapPin, Minus, Plus, ShieldCheck, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api";
import { schedulePresets } from "../../lib/hive-home";
import { useRegisterNavBack, useRegisterNavPrimaryAction } from "../../lib/nav-primary-action";
import { cardClass, Notice, primaryBtn, Spinner, UnavailablePanel, WorkPage } from "./WorkUI";
import { WorkTopUp } from "./WorkTopUp";
import {
  formatUgx,
  hoursLabel,
  newIdempotencyKey,
  toLocalInput,
  WORK_TYPES,
  workFailure,
  type WorkFailure,
} from "./work-utils";

const fieldClass = "w-full rounded-2xl border border-[var(--border-faint)] px-4 py-3 text-sm text-ink placeholder:text-ink-500";

const MATCHING_COPY: Record<WorkMatchingMode, { title: string; body: string }> = {
  broadcast: { title: "First to accept", body: "Nearby providers are notified and the first one to accept gets the job." },
  customer_picks: { title: "I'll choose", body: "Providers send you offers and you pick the one you like." },
  admin_assigns: { title: "Peebee assigns", body: "Our team picks a provider for you." },
};

type Catalog = { services: WorkService[]; settings: WorkPublicSettings };
type LoadState = { kind: "loading" } | { kind: "ready"; data: Catalog } | { kind: "error"; failure: WorkFailure };

/** Choices carried over from the Hive home sheet (?matching=…&when=later). */
function hivePrefill(): { matching?: WorkMatchingMode; later: boolean; at?: string } {
  if (typeof window === "undefined") return { later: false };
  const q = new URLSearchParams(window.location.search);
  const m = q.get("matching");
  return { matching: m === "broadcast" || m === "customer_picks" || m === "admin_assigns" ? m : undefined, later: q.get("when") === "later", at: /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(q.get("at") ?? "") ? (q.get("at") as string) : undefined };
}

export function WorkBooking({ type }: { type: WorkServiceType }) {
  const meta = WORK_TYPES[type];
  const router = useRouter();
  // Inside a Hive flow the nav's Home button becomes Back to the Hive map.
  useRegisterNavBack(true, () => router.push("/services"));
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    api
      .workCatalog(type)
      .then((data) => setState({ kind: "ready", data }))
      .catch((err) => setState({ kind: "error", failure: workFailure(err) }));
  }, [type]);

  useEffect(load, [load]);

  let body;
  if (state.kind === "loading") {
    body = <Spinner label="Loading services" />;
  } else if (state.kind === "error") {
    body = state.failure.disabled || state.failure.upgradePending ? (
      <UnavailablePanel title={`${meta.title} isn't available yet`} message={state.failure.upgradePending ? state.failure.message : "This service isn't open right now. Please check back soon."} />
    ) : (
      <div className="space-y-3">
        <Notice failure={state.failure} />
        <button type="button" onClick={load} className={primaryBtn}>
          Try again
        </button>
      </div>
    );
  } else if (!state.data.settings.enabled || !state.data.settings.serviceTypes.includes(type)) {
    body = <UnavailablePanel title={`${meta.title} isn't available yet`} message="We're not taking bookings for this service just yet. Please check back soon." />;
  } else if (state.data.services.length === 0) {
    body = <UnavailablePanel title="No services listed yet" message={`There are no ${meta.title.toLowerCase()} services to book right now. Please check back soon.`} />;
  } else {
    body = <BookingForm type={type} services={state.data.services} settings={state.data.settings} />;
  }

  return (
    <WorkPage eyebrow={meta.eyebrow} title={meta.title} backHref="/services" backLabel="Back to Services">
      {body}
      <Link href="/services/work" className="flex min-h-[44px] items-center justify-center text-sm font-semibold text-gold underline">
        My jobs
      </Link>
    </WorkPage>
  );
}

function BookingForm({ type, services, settings }: { type: WorkServiceType; services: WorkService[]; settings: WorkPublicSettings }) {
  const router = useRouter();
  const categories = useMemo(() => {
    const map = new Map<string, WorkService[]>();
    for (const s of services) map.set(s.category, [...(map.get(s.category) ?? []), s]);
    return [...map.entries()];
  }, [services]);

  const [serviceId, setServiceId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [details, setDetails] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [area, setArea] = useState<string | undefined>(undefined);
  const [locStatus, setLocStatus] = useState<"idle" | "locating" | "denied">("idle");
  const [saved, setSaved] = useState<SavedLocation[]>([]);
  const prefill = useMemo(hivePrefill, []);
  const [when, setWhen] = useState<"asap" | "later">(prefill.later ? "later" : "asap");
  const [whenValue, setWhenValue] = useState(prefill.later ? prefill.at ?? "" : "");
  const [matching, setMatching] = useState<WorkMatchingMode>(prefill.matching && settings.matchingModes.includes(prefill.matching) ? prefill.matching : settings.defaultMatching);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<WorkFailure | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const [topUp, setTopUp] = useState<{ needed: number; nonce: number } | null>(null);
  const nonce = useRef(0);

  const service = services.find((s) => s.id === serviceId) ?? null;
  const isQuote = service?.pricingMode === "quote";
  const canChooseQuantity = !!service && !isQuote && service.maxQuantity > service.minQuantity;
  const effectiveQuantity = !service ? 1 : isQuote ? 1 : Math.min(service.maxQuantity, Math.max(service.minQuantity, quantity));
  const modes = settings.matchingModes;
  const chooseMatching = modes.length > 1;
  const effectiveMatching: WorkMatchingMode = chooseMatching && modes.includes(matching) ? matching : settings.defaultMatching;

  useEffect(() => {
    api
      .getLocations()
      .then((r) => setSaved(r.locations))
      .catch(() => {});
  }, []);

  function pickService(s: WorkService) {
    setServiceId(s.id);
    setQuantity(s.minQuantity);
    setFailure(null);
    setLocalError(null);
  }

  function shareMyLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocStatus("denied");
      return;
    }
    setLocStatus("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocStatus("idle");
        setAddress((a) => (a.trim().length >= 3 ? a : "Current location"));
      },
      () => setLocStatus("denied"),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function pickSaved(l: SavedLocation) {
    setAddress(l.address || l.area || l.label);
    setArea(l.area ?? undefined);
    setCoords(l.lat != null && l.lng != null ? { lat: l.lat, lng: l.lng } : null);
  }

  const presets = schedulePresets(settings);
  const minLead = settings.minLeadMinutes;
  const minWhen = toLocalInput(new Date(Date.now() + (minLead + 1) * 60_000));
  const maxWhen = toLocalInput(new Date(Date.now() + settings.maxAdvanceDays * 86_400_000));

  const payLabel = !service ? "" : isQuote ? `Book and hold ${formatUgx(service.calloutFeeUgx)}` : `Book and pay ${formatUgx(service.unitPriceUgx * effectiveQuantity)}`;
  // Steps are driven from the nav: a step button until a service is chosen, then solid gold to pay.
  useRegisterNavPrimaryAction(
    service
      ? { tone: "gold", label: busy ? "Booking..." : payLabel, sublabel: "Held by Peebee until you confirm", icon: Wallet, busy, disabled: busy, onClick: () => void attempt() }
      : { tone: "step", label: "Next: choose a service", sublabel: "Pick one above", disabled: true, onClick: () => {} },
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    void attempt();
  }

  // Also used to retry after a top-up: the payload is unchanged, so the idempotency key is too.
  async function attempt() {
    if (busy || !service) return;
    setFailure(null);
    setLocalError(null);
    const addr = address.trim();
    if (addr.length < 3) return setLocalError("Tell us where the job is. Enter an address or pick a saved place.");
    if (effectiveMatching === "broadcast" && !coords) return setLocalError("Share your location so nearby providers can be found. Tap \"Use my location\" or pick a saved place that has a map pin.");
    let scheduledFor: string | undefined;
    if (when === "later") {
      const d = whenValue ? new Date(whenValue) : null;
      if (!d || Number.isNaN(d.getTime())) return setLocalError("Choose the date and time you want the job done.");
      const ahead = (d.getTime() - Date.now()) / 60_000;
      if (ahead < minLead) return setLocalError(`Please book at least ${minLead} minutes ahead.`);
      if (ahead > settings.maxAdvanceDays * 1440) return setLocalError(`You can book up to ${settings.maxAdvanceDays} days ahead.`);
      scheduledFor = d.toISOString();
    }

    const payload = {
      serviceId: service.id,
      quantity: effectiveQuantity,
      details: details.trim(),
      address: addr,
      area,
      lat: coords?.lat,
      lng: coords?.lng,
      scheduledFor,
      matchingMode: chooseMatching ? effectiveMatching : undefined,
    };
    // The same key for the same booking, so a retry or double tap never charges twice.
    // Changing anything about the booking is a new booking, so it gets a new key.
    const sig = JSON.stringify(payload);
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: newIdempotencyKey() };

    setBusy(true);
    try {
      const res = await api.workBook({ ...payload, idempotencyKey: keyRef.current.key });
      setTopUp(null);
      router.push(`/services/work/${encodeURIComponent(res.job.id)}`);
    } catch (err) {
      const f = workFailure(err);
      setFailure(f);
      if (f.topUp) {
        const needed = service.pricingMode === "fixed" ? service.unitPriceUgx * effectiveQuantity : service.calloutFeeUgx;
        nonce.current += 1;
        setTopUp(needed > 0 ? { needed, nonce: nonce.current } : null);
      } else setTopUp(null);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <section aria-labelledby="svc-heading" className="space-y-3">
        <h2 id="svc-heading" className="text-xs font-bold uppercase tracking-wider">
          1. What do you need?
        </h2>
        {categories.map(([category, list]) => (
          <div key={category} className={`${cardClass} space-y-2`}>
            <h3 className="text-sm font-bold">{category}</h3>
            <div className="space-y-2" role="group" aria-label={category}>
              {list.map((s) => {
                const active = s.id === serviceId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => pickService(s)}
                    className="select-card !flex-row items-center justify-between gap-3 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="select-card__title text-sm text-ink">{s.name}</span>
                      {s.description ? <span className="line-clamp-2 block text-xs leading-snug text-ink-500">{s.description}</span> : null}
                    </span>
                    <span className="shrink-0 text-right text-xs font-bold text-gold">
                      {s.pricingMode === "fixed" ? (
                        <>
                          {formatUgx(s.unitPriceUgx)}
                          <span className="block font-normal text-ink-500">per {s.unitLabel || "job"}</span>
                        </>
                      ) : (
                        <>
                          Quote
                          <span className="block font-normal text-ink-500">{s.calloutFeeUgx > 0 ? `${formatUgx(s.calloutFeeUgx)} call-out` : "no call-out fee"}</span>
                        </>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </section>

      {service ? (
        <>
          {canChooseQuantity ? (
            <section className={`${cardClass} space-y-2`} aria-labelledby="qty-heading">
              <h2 id="qty-heading" className="text-xs font-bold uppercase tracking-wider">
                How many {service.unitLabel ? `(${service.unitLabel})` : ""}?
              </h2>
              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  aria-label="Decrease quantity"
                  disabled={effectiveQuantity <= service.minQuantity}
                  onClick={() => setQuantity(effectiveQuantity - 1)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] disabled:opacity-40"
                >
                  <Minus className="h-5 w-5" aria-hidden />
                </button>
                <output aria-live="polite" className="text-2xl font-bold">
                  {effectiveQuantity}
                </output>
                <button
                  type="button"
                  aria-label="Increase quantity"
                  disabled={effectiveQuantity >= service.maxQuantity}
                  onClick={() => setQuantity(effectiveQuantity + 1)}
                  className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] disabled:opacity-40"
                >
                  <Plus className="h-5 w-5" aria-hidden />
                </button>
              </div>
              <p className="text-center text-xs text-ink-500">
                {service.minQuantity} to {service.maxQuantity}
              </p>
            </section>
          ) : null}

          <section className={`${cardClass} space-y-2`}>
            <label htmlFor="work-details" className="text-xs font-bold uppercase tracking-wider">
              2. Details {isQuote ? "(what needs doing?)" : "(optional)"}
            </label>
            <textarea
              id="work-details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder={type === "fix" ? "Describe the problem so the provider can prepare" : "Anything the provider should know"}
              className={fieldClass}
            />
          </section>

          <section className={`${cardClass} space-y-3`} aria-labelledby="addr-heading">
            <h2 id="addr-heading" className="text-xs font-bold uppercase tracking-wider">
              3. Where?
            </h2>
            {saved.length > 0 ? (
              <div className="flex flex-wrap gap-2" role="group" aria-label="Saved places">
                {saved.map((l) => {
                  const active = address === (l.address || l.area || l.label);
                  return (
                    <button
                      key={l.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => pickSaved(l)}
                      className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3 text-xs font-semibold ${
                        active ? "border-gold bg-gold/15 text-gold" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]"
                      }`}
                    >
                      <MapPin className="h-3.5 w-3.5" aria-hidden />
                      {l.label}
                    </button>
                  );
                })}
              </div>
            ) : null}
            <div>
              <label htmlFor="work-address" className="mb-1 block text-xs text-ink-500">
                Address
              </label>
              <input
                id="work-address"
                type="text"
                value={address}
                onChange={(e) => {
                  setAddress(e.target.value);
                  setArea(undefined);
                }}
                maxLength={200}
                autoComplete="street-address"
                placeholder="Street, building or landmark"
                className={`${fieldClass} min-h-[48px]`}
              />
            </div>
            <button
              type="button"
              onClick={shareMyLocation}
              disabled={locStatus === "locating"}
              className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-sm font-semibold disabled:opacity-60"
            >
              <LocateFixed className="h-4 w-4 text-gold" aria-hidden />
              {locStatus === "locating" ? "Finding you..." : coords ? "Location shared. Tap to update" : "Use my location"}
            </button>
            {locStatus === "denied" ? <p className="text-xs text-ink-500" role="status">We couldn&apos;t get your location. Check your browser permission and try again.</p> : null}
            {effectiveMatching === "broadcast" && !coords ? <p className="text-xs text-ink-500">Sharing your location lets us notify providers near you.</p> : null}
          </section>

          <section className={`${cardClass} space-y-3`} aria-labelledby="when-heading">
            <h2 id="when-heading" className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider">
              <Clock className="h-4 w-4 text-gold" aria-hidden /> 4. When?
            </h2>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="When">
              {(
                [
                  ["asap", "As soon as possible"],
                  ["later", "Pick a time"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={when === id}
                  onClick={() => setWhen(id)}
                  className={`min-h-[48px] rounded-2xl border px-2 text-sm font-semibold ${
                    when === id ? "border-gold bg-gold/15 text-gold" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {when === "later" ? (
              <div className="space-y-3">
                {presets.length > 0 ? (
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Quick times">
                    {presets.map((p) => (
                      <button key={p.id} type="button" aria-pressed={whenValue === p.at} onClick={() => setWhenValue(p.at)} className={`ride-chip ${whenValue === p.at ? "is-on" : ""}`}>
                        {p.label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div>
                <label htmlFor="work-when" className="mb-1 block text-xs text-ink-500">
                  Date and time
                </label>
                <input id="work-when" type="datetime-local" value={whenValue} min={minWhen} max={maxWhen} onChange={(e) => setWhenValue(e.target.value)} className={`${fieldClass} min-h-[48px]`} />
                <p className="mt-1 text-xs text-ink-500">
                  At least {hoursLabelMinutes(minLead)} ahead, and up to {settings.maxAdvanceDays} days in advance.
                </p>
                </div>
              </div>
            ) : null}
          </section>

          {chooseMatching ? (
            <section className={`${cardClass} space-y-2`} aria-labelledby="match-heading">
              <h2 id="match-heading" className="text-xs font-bold uppercase tracking-wider">
                5. How should we find a provider?
              </h2>
              <div className="space-y-2" role="group" aria-label="How to find a provider">
                {modes.map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={effectiveMatching === m}
                    onClick={() => setMatching(m)}
                    className="select-card text-left"
                  >
                    <span className="select-card__title text-sm text-ink">{MATCHING_COPY[m].title}</span>
                    <span className="block text-xs leading-snug text-ink-500">{MATCHING_COPY[m].body}</span>
                  </button>
                ))}
              </div>
            </section>
          ) : null}

          <PriceSummary service={service} quantity={effectiveQuantity} settings={settings} />

          <Notice text={localError ?? undefined} />
          <Notice failure={failure} inlineTopUp={!!topUp} />
          {topUp ? <WorkTopUp key={topUp.nonce} neededUgx={topUp.needed} onCredited={() => void attempt()} /> : null}

          {/* Paying happens from the nav's gold button; this keeps Enter-to-submit working. */}
          <button type="submit" disabled={busy} className="sr-only">
            {busy ? "Booking..." : payLabel}
          </button>
          <p className="flex items-start gap-2 text-xs text-ink-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden />
            {settings.photosEnabled ? "You can add photos of the job right after booking. " : ""}Payment comes from your Peebee wallet. Peebee holds the money and only pays the provider after you confirm the job is done.
          </p>
        </>
      ) : (
        <p className="text-center text-sm text-ink-500">Choose a service above to continue.</p>
      )}
    </form>
  );
}

function hoursLabelMinutes(minutes: number): string {
  if (minutes >= 60 && minutes % 60 === 0) return hoursLabel(minutes / 60);
  return `${minutes} minutes`;
}

function PriceSummary({ service, quantity, settings }: { service: WorkService; quantity: number; settings: WorkPublicSettings }) {
  if (service.pricingMode === "fixed") {
    const total = service.unitPriceUgx * quantity;
    return (
      <section className={`${cardClass} space-y-2`} aria-label="Price">
        <h2 className="text-xs font-bold uppercase tracking-wider">Price</h2>
        <div className="flex justify-between text-sm">
          <span className="text-ink-500">
            {formatUgx(service.unitPriceUgx)} x {quantity}
          </span>
          <span className="font-bold text-gold">{formatUgx(total)}</span>
        </div>
        <p className="text-xs leading-relaxed text-ink-500">The full price is held from your wallet when you book. If nobody takes the job, you are refunded.</p>
      </section>
    );
  }
  return (
    <section className={`${cardClass} space-y-2`} aria-label="Price">
      <h2 className="text-xs font-bold uppercase tracking-wider">Price</h2>
      <div className="flex justify-between text-sm">
        <span className="text-ink-500">Call-out fee held now</span>
        <span className="font-bold text-gold">{service.calloutFeeUgx > 0 ? formatUgx(service.calloutFeeUgx) : "None"}</span>
      </div>
      <p className="text-xs leading-relaxed text-ink-500">
        This job is priced after inspection. The provider comes to look at the work and sends you a quote{settings.quoteValidHours ? `, valid for ${hoursLabel(settings.quoteValidHours)}` : ""}.
        {service.calloutFeeUgx > 0
          ? " If you accept it, the call-out fee counts towards the price and you only pay the difference. If you decline, the call-out fee goes to the provider for the visit."
          : " You only pay if you accept it."}
      </p>
    </section>
  );
}
