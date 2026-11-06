"use client";

import { Fold } from "../../../components/Fold";
import { ModuleState } from "../../../components/ModuleState";
import { hasPermission, TAXIPRESS_LUGGAGE_LABELS, TAXIPRESS_LUGGAGE_TYPES, type TaxipressLuggageType, type TaxipressAdminQueueEntry, type TaxipressAdminRoute, type TaxipressRelayRoute, type TaxipressReport, type TaxipressSettings, type TaxipressTaxi } from "@peebee/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { Switch } from "../../../components/ui/Switch";
import { Select } from "../../../components/ui/Select";
import { Badge, ErrorNote, Field, inputCls, ugx } from "../../../components/work/ui";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

type Tab = "settings" | "routes" | "taxis" | "line" | "money";
const digits = (v: string) => v.replace(/[^\d]/g, "");
const decimal = (v: string) => v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const smallBtn = "min-h-9 rounded-full px-3 text-xs font-bold";

function MigrationNotice() {
  return (
    <p className="rounded-2xl bg-gold/15 p-3 text-xs text-ink">
      Taxipress needs database migration <b>0123_taxipress.sql</b> (and the relay migrations before it). Apply it, then come back. Nothing is offered to customers until it is.
    </p>
  );
}

export default function TaxipressPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "settings.manage");
  const [tab, setTab] = useState<Tab>("settings");

  if (!user) return <SettingsPageShell title="Taxipress" loading>{null}</SettingsPageShell>;

  return (
    <SettingsPageShell title="Taxipress" loading={false}>
      {!canManage ? (
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      ) : (
        <>
          <p className="text-xs text-ink-500">
            Seats on the next taxi along a fixed route. Routes are set up in{" "}
            <Link href="/settings/relay" className="font-bold text-gold underline-offset-2 hover:underline">Relay delivery</Link>{" "}
            (stage names, locations and stops), then run here in each direction with a fare per seat. Taxipress and its routes start switched off.
          </p>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {([["settings", "Settings"], ["routes", "Routes"], ["taxis", "Taxis"], ["line", "The line"], ["money", "Money"]] as [Tab, string][]).map(([id, text]) => (
              <button key={id} type="button" onClick={() => setTab(id)} className={`${smallBtn} shrink-0 ${tab === id ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>{text}</button>
            ))}
          </div>
          {tab === "settings" ? <SettingsTab /> : tab === "routes" ? <RoutesTab /> : tab === "taxis" ? <TaxisTab /> : tab === "line" ? <LineTab /> : <MoneyTab />}
        </>
      )}
    </SettingsPageShell>
  );
}

function SettingsTab() {
  const [s, setS] = useState<TaxipressSettings | null>(null);
  const [notAllowed, setNotAllowed] = useState("");
  const [num, setNum] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(true);
  const [newLanguage, setNewLanguage] = useState({ code: "", name: "" });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback((next: TaxipressSettings) => {
    setS(next);
    setNotAllowed(next.parcelNotAllowed.join("\n"));
    setNum({
      commissionDigitalPercent: String(next.commissionDigitalPercent), commissionCashPercent: String(next.commissionCashPercent),
      commissionFlatUgx: String(next.commissionFlatUgx), maxOwedUgx: String(next.maxOwedUgx),
      returnDiscountPercent: String(next.returnDiscountPercent), maxSeatsPerBooking: String(next.maxSeatsPerBooking),
      maxParcels14: String(next.maxParcels14), maxParcels18: String(next.maxParcels18),
      waitMinutes: String(next.waitMinutes), stageRadiusM: String(next.stageRadiusM),
      payWithinMinutes: String(next.payWithinMinutes), maxCashBookings: String(next.maxCashBookings),
      freeCancelMinutes: String(next.freeCancelMinutes), cancelRetentionPercent: String(next.cancelRetentionPercent),
      noShowMinutes: String(next.noShowMinutes), noShowFeePercent: String(next.noShowFeePercent),
      childSeatFarePercent: String(next.childSeatFarePercent), openTicketValidityDays: String(next.openTicketValidityDays), openTicketRefundPercent: String(next.openTicketRefundPercent), luggageOptionsShown: String(next.luggageOptionsShown),
      ...Object.fromEntries(TAXIPRESS_LUGGAGE_TYPES.map((t) => [`luggage_${t}`, next.luggagePrices[t] == null ? "" : String(next.luggagePrices[t])])),
    });
  }, []);

  useEffect(() => {
    api.adminGetTaxipressSettings()
      .then((res) => { load(res.settings); setReady(res.ready); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [load]);

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;
  if (!s) return <ErrorNote message={error} />;

  const set = <K extends keyof TaxipressSettings>(key: K, value: TaxipressSettings[K]) => setS((cur) => (cur ? { ...cur, [key]: value } : cur));
  const field = (key: string, whole: boolean) => (
    <input inputMode={whole ? "numeric" : "decimal"} required value={num[key] ?? ""} onChange={(e) => setNum((n) => ({ ...n, [key]: whole ? digits(e.target.value) : decimal(e.target.value) }))} className={inputCls} />
  );
  const choice = <T extends string>(value: T, current: T, text: string, hint: string, pick: (v: T) => void) => (
    <button key={value} type="button" onClick={() => pick(value)} aria-pressed={current === value} className={`rounded-2xl px-3 py-2.5 text-left transition ${current === value ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>
      <span className="block text-sm font-bold">{text}</span>
      <span className="block text-xs opacity-80">{hint}</span>
    </button>
  );

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!s) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const n = (key: string) => Number(num[key] ?? 0);
      const res = await api.adminUpdateTaxipressSettings({
        enabled: s.enabled, departureRule: s.departureRule, sellFreeSeatsOnRoad: s.sellFreeSeatsOnRoad,
        commissionType: s.commissionType, commissionDigitalPercent: n("commissionDigitalPercent"), commissionCashPercent: n("commissionCashPercent"),
        commissionFlatUgx: n("commissionFlatUgx"), blockWhenOwing: s.blockWhenOwing, maxOwedUgx: n("maxOwedUgx"), cashEnabled: s.cashEnabled,
        returnDiscountPercent: n("returnDiscountPercent"), maxSeatsPerBooking: n("maxSeatsPerBooking"),
        parcelAcceptRule: s.parcelAcceptRule, maxParcels14: n("maxParcels14"), maxParcels18: n("maxParcels18"), parcelFitText: s.parcelFitText,
        waitMinutes: n("waitMinutes"), stageRadiusM: n("stageRadiusM"), payWithinMinutes: n("payWithinMinutes"), maxCashBookings: n("maxCashBookings"),
        freeCancelMinutes: n("freeCancelMinutes"), cancelRetentionPercent: n("cancelRetentionPercent"), feeTo: s.feeTo,
        noShowMinutes: n("noShowMinutes"), noShowFeePercent: n("noShowFeePercent"), rebookOnRemoval: s.rebookOnRemoval,
        bookableTaxis: s.bookableTaxis, maxLapChildren: s.maxLapChildren, childSeatFarePercent: n("childSeatFarePercent"),
        luggageEnabled: s.luggageEnabled, assistanceEnabled: s.assistanceEnabled, languageEnabled: s.languageEnabled,
        luggageOptionsShown: Math.min(TAXIPRESS_LUGGAGE_TYPES.length, Math.max(1, n("luggageOptionsShown"))), languages: s.languages,
        bookForOthersEnabled: s.bookForOthersEnabled, ticketSharingEnabled: s.ticketSharingEnabled, openTicketsEnabled: s.openTicketsEnabled, openTicketValidityDays: n("openTicketValidityDays"), openTicketRefundPercent: n("openTicketRefundPercent"), showStops: s.showStops,
        // A blank luggage price means "priced at the stage".
        luggagePrices: Object.fromEntries(TAXIPRESS_LUGGAGE_TYPES.map((t) => [t, (num[`luggage_${t}`] ?? "") === "" ? null : n(`luggage_${t}`)])) as Record<TaxipressLuggageType, number | null>,
        parcelNotAllowed: notAllowed.split("\n").map((x) => x.trim()).filter(Boolean),
      });
      load(res.settings);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!ready && <MigrationNotice />}
      <Fold head={<label className="flex items-center gap-2 text-sm font-bold text-ink">
          <ModuleState on={s.enabled} />
          Taxipress is on
        </label>}>
        <p className="text-xs text-ink-500">Off hides it from customers entirely. It also stays hidden while no route is running.</p>
      </Fold>

      <Fold title="When a taxi may leave">
        <div className="grid gap-2">
          {choice("full_only", s.departureRule, "Only when every seat is booked", "The driver can tap On Road only once the taxi is fully booked.", (v) => set("departureRule", v))}
          {choice("driver_choice", s.departureRule, "When the driver decides", "The driver may leave with free seats.", (v) => set("departureRule", v))}
          {choice("after_wait", s.departureRule, "After a wait", "The driver may leave with free seats once the wait has passed.", (v) => set("departureRule", v))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Wait before leaving (minutes)" hint="For the “after a wait” rule: minutes boarding before the driver may leave with free seats.">{field("waitMinutes", true)}</Field>
          <Field label="Join the line within (metres)" hint="How close a driver must be to the start stage. 0 turns the check off.">{field("stageRadiusM", true)}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.sellFreeSeatsOnRoad} onChange={(e) => set("sellFreeSeatsOnRoad", e.target.checked)} />
          Sell free seats on a taxi that is already on the road
        </label>
      </Fold>

      <Fold title="Seats and fares">
        <p className="text-xs text-ink-500">The fare per seat is set on each route. Mid-route fares are a per-route switch.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Most seats in one booking">{field("maxSeatsPerBooking", true)}</Field>
          <Field label="Return trip discount (%)">{field("returnDiscountPercent", false)}</Field>
          <Field label="Minutes to pay in the app" hint="Unpaid seats are given back after this.">{field("payWithinMinutes", true)}</Field>
          <Field label="Cash bookings one passenger may hold" hint="Cash can be a no-show, so this is capped.">{field("maxCashBookings", true)}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.cashEnabled} onChange={(e) => set("cashEnabled", e.target.checked)} />
          Passengers may pay cash to the driver
        </label>
      </Fold>

      <Fold title="Booking a taxi">
        <p className="text-xs text-ink-500">The taxi Boarding Now is never bookable. Passengers pick from the next taxis waiting behind it.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Taxis open for booking">
            <Select value={String(s.bookableTaxis)} onValueChange={(v) => set("bookableTaxis", Number(v))} aria-label="Taxis open for booking" sizing="stretch" className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm">
              {[1, 2, 3, 4, 5].map((k) => <option key={k} value={String(k)}>{k === 1 ? "Only the next taxi" : `The next ${k} taxis`}</option>)}
            </Select>
          </Field>
          <Field label="Children free on a lap" hint="Per booking. Each child beyond this needs a seat.">
            <Select value={String(s.maxLapChildren)} onValueChange={(v) => set("maxLapChildren", Number(v))} aria-label="Children free on a lap" sizing="stretch" className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm">
              {[0, 1, 2, 3, 4].map((k) => <option key={k} value={String(k)}>{k === 0 ? "None, every child pays" : `Up to ${k}`}</option>)}
            </Select>
          </Field>
          <Field label="Child seat fare (%)" hint="Share of the adult fare for a child who takes a seat.">{field("childSeatFarePercent", false)}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.bookForOthersEnabled} onChange={(e) => set("bookForOthersEnabled", e.target.checked)} />
          Passengers may book for someone else
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.ticketSharingEnabled} onChange={(e) => set("ticketSharingEnabled", e.target.checked)} />
          Passengers may send a ticket, and a ticket code shows its details
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.openTicketsEnabled} onChange={(e) => set("openTicketsEnabled", e.target.checked)} />
          Passengers may buy an open ticket (normal fare, valid on any taxi on the route)
        </label>
        {s.openTicketsEnabled && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Open ticket valid for (days)" hint="0 means it never expires.">{field("openTicketValidityDays", true)}</Field>
            <Field label="Refund on cancel or expiry (%)" hint="Share of the fare given back when an unused open ticket is cancelled or expires.">{field("openTicketRefundPercent", false)}</Field>
          </div>
        )}
        <p className="text-xs text-ink-500">Open tickets need the database update <span className="font-mono">0145_taxipress_open_tickets.sql</span> to be applied first.</p>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.showStops} onChange={(e) => set("showStops", e.target.checked)} />
          Show each route&apos;s stops to passengers
        </label>
        <p className="text-xs text-ink-500">Stops are the stages set on the route in <Link href="/settings/relay" className="font-semibold text-gold">Relay settings</Link>.</p>
      </Fold>

      <Fold title="Luggage and trip options">
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.luggageEnabled} onChange={(e) => set("luggageEnabled", e.target.checked)} />
          Passengers may add luggage
        </label>
        {s.luggageEnabled && (
          <Field label={`Luggage options shown (1 to ${TAXIPRESS_LUGGAGE_TYPES.length})`} hint={`Passengers see the first ${Math.min(TAXIPRESS_LUGGAGE_TYPES.length, Math.max(1, Number(num.luggageOptionsShown || 1)))} in the list below, in that order.`}>
            {field("luggageOptionsShown", true)}
          </Field>
        )}
        {s.luggageEnabled && (
          <div className="grid grid-cols-2 gap-3">
            {TAXIPRESS_LUGGAGE_TYPES.map((t, i) => (
              <Field key={t} label={`${TAXIPRESS_LUGGAGE_LABELS[t].name} (UGX)${i < Math.max(1, Number(num.luggageOptionsShown || 1)) ? "" : " · hidden"}`} hint={`${TAXIPRESS_LUGGAGE_LABELS[t].note}. Blank: priced at the stage.`}>
                <input inputMode="numeric" value={num[`luggage_${t}`] ?? ""} onChange={(e) => setNum((x) => ({ ...x, [`luggage_${t}`]: digits(e.target.value) }))} className={inputCls} />
              </Field>
            ))}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.assistanceEnabled} onChange={(e) => set("assistanceEnabled", e.target.checked)} />
          Passengers may ask for assistance (boarding help, priority seating, mobility support)
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.languageEnabled} onChange={(e) => set("languageEnabled", e.target.checked)} />
          Passengers may choose a preferred language
        </label>
        {s.languageEnabled && (
          <div className="space-y-2">
            <p className="text-xs text-ink-500">Add or remove languages, and switch off any you don&apos;t want shown. Passengers only see the ones switched on.</p>
            {s.languages.map((l, i) => (
              <div key={l.code} className="flex items-center gap-2">
                <Switch aria-label={`Show ${l.name}`} checked={l.enabled} onChange={(e) => set("languages", s.languages.map((x, j) => (j === i ? { ...x, enabled: e.target.checked } : x)))} />
                <input aria-label={`Name for ${l.code}`} value={l.name} maxLength={40} onChange={(e) => set("languages", s.languages.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className={inputCls} />
                <span className="w-12 shrink-0 text-xs font-bold uppercase text-ink-500">{l.code}</span>
                <button type="button" aria-label={`Remove ${l.name}`} onClick={() => set("languages", s.languages.filter((_, j) => j !== i))} className="min-h-10 shrink-0 rounded-full px-3 text-xs font-bold text-red-600">Remove</button>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input aria-label="New language name" placeholder="Language, e.g. Kinyarwanda" value={newLanguage.name} maxLength={40} onChange={(e) => setNewLanguage((x) => ({ ...x, name: e.target.value }))} className={inputCls} />
              <input aria-label="New language code" placeholder="Code, e.g. rw" value={newLanguage.code} maxLength={8} onChange={(e) => setNewLanguage((x) => ({ ...x, code: e.target.value.toLowerCase().replace(/[^a-z-]/g, "") }))} className={`${inputCls} w-28 shrink-0`} />
              <button type="button" disabled={!newLanguage.name.trim() || !/^[a-z]{2,8}$/.test(newLanguage.code) || s.languages.some((l) => l.code === newLanguage.code)}
                onClick={() => { set("languages", [...s.languages, { code: newLanguage.code, name: newLanguage.name.trim(), enabled: true }]); setNewLanguage({ code: "", name: "" }); }}
                className="min-h-10 shrink-0 rounded-full bg-gold px-4 text-xs font-bold text-ink-gold disabled:opacity-50">Add</button>
            </div>
          </div>
        )}
      </Fold>

      <Fold title="Cancellations and no-shows">
        <p className="text-xs text-ink-500">Money only moves for seats paid in the app. Cash and unpaid seats are simply given back. Refunds go to the passenger&apos;s wallet.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Free cancellation (minutes)" hint="After booking, a passenger gets everything back inside this time.">{field("freeCancelMinutes", true)}</Field>
          <Field label="Kept after that (%)" hint="Share of the fare kept from a paid seat. 0 means always a full refund.">{field("cancelRetentionPercent", false)}</Field>
          <Field label="Mark a no-show after (minutes)" hint="Minutes Boarding Now before a driver may mark an absent passenger.">{field("noShowMinutes", true)}</Field>
          <Field label="Kept on a no-show (%)" hint="Share of the fare kept from a paid seat. 0 means a full refund.">{field("noShowFeePercent", false)}</Field>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {choice("driver", s.feeTo, "Fee goes to the driver", "For the seat they held empty.", (v) => set("feeTo", v))}
          {choice("peebee", s.feeTo, "Fee stays with Peebee", "The driver receives nothing.", (v) => set("feeTo", v))}
        </div>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.rebookOnRemoval} onChange={(e) => set("rebookOnRemoval", e.target.checked)} />
          When a taxi leaves the line, move its passengers to the next taxi with room
        </label>
        <p className="text-xs text-ink-500">If there is no room, or this is off, they are refunded in full with no fee.</p>
      </Fold>

      <Fold title="Peebee&apos;s commission on a seat">
        <div className="grid grid-cols-2 gap-2">
          {choice("percent", s.commissionType, "A percentage", "Digital and cash can differ.", (v) => set("commissionType", v))}
          {choice("flat", s.commissionType, "A flat amount", "The same for every seat.", (v) => set("commissionType", v))}
        </div>
        {s.commissionType === "percent" ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Digital payments (%)">{field("commissionDigitalPercent", false)}</Field>
            <Field label="Cash payments (%)">{field("commissionCashPercent", false)}</Field>
          </div>
        ) : (
          <Field label="Per seat (UGX)">{field("commissionFlatUgx", true)}</Field>
        )}
        <p className="text-xs text-ink-500">On cash the commission is taken from the driver&apos;s wallet, which may go negative and is netted against their next digital payout.</p>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={s.blockWhenOwing} onChange={(e) => set("blockWhenOwing", e.target.checked)} />
          Block a driver from joining the line when they owe too much
        </label>
        <Field label="Owing more than (UGX)">{field("maxOwedUgx", true)}</Field>
      </Fold>

      <Fold title="Parcels in a taxi">
        <p className="text-xs text-ink-500">A parcel is a parcel: if it fits, it goes. Taxipress taxis take no relay parcels until the numbers below are set.</p>
        <div className="grid gap-2">
          {choice("boarding_now", s.parcelAcceptRule, "Only the taxi that is boarding now", "Other taxis in the line do not take parcels yet.", (v) => set("parcelAcceptRule", v))}
          {choice("any_in_line", s.parcelAcceptRule, "Any taxi in the line", "A parcel may go in whichever taxi the rider reaches.", (v) => set("parcelAcceptRule", v))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Most parcels, 14-seater">{field("maxParcels14", true)}</Field>
          <Field label="Most parcels, 18-seater">{field("maxParcels18", true)}</Field>
        </div>
        <Field label="“Does it fit?” line" hint="Shown to customers and drivers.">
          <input value={s.parcelFitText} maxLength={200} onChange={(e) => set("parcelFitText", e.target.value)} className={inputCls} />
        </Field>
        <Field label="Not allowed (one per line)">
          <textarea rows={4} value={notAllowed} onChange={(e) => setNotAllowed(e.target.value)} className={inputCls} />
        </Field>
      </Fold>
      <SettingsSaveBar busy={busy} error={error} saved={saved} />
    </form>
  );
}

function RoutesTab() {
  const [routes, setRoutes] = useState<TaxipressAdminRoute[]>([]);
  const [relay, setRelay] = useState<TaxipressRelayRoute[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState({ relayRouteId: "", direction: "a_to_b" as "a_to_b" | "b_to_a", fare: "" });
  const [busy, setBusy] = useState<string | null>(null);

  // Bumping the version reloads the list after any change.
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  useEffect(() => {
    let live = true;
    api.adminListTaxipressRoutes()
      .then((res) => {
        if (!live) return;
        setRoutes(res.routes);
        setRelay(res.relayRoutes);
        setReady(res.ready);
      })
      .catch((err) => { if (live) setError(errorMessage(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [version]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try { await action(); refresh(); } catch (err) { setError(errorMessage(err)); } finally { setBusy(null); }
  }

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;
  const chosen = relay.find((r) => r.id === adding.relayRouteId);

  return (
    <div className="space-y-4">
      {!ready && <MigrationNotice />}
      <ErrorNote message={error} />
      {ready && routes.length === 0 && <p className="text-sm text-ink-500">No Taxipress routes yet.</p>}
      {routes.map((r) => (
        <section key={r.id} className="home-card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink">{r.fromName} → {r.toName}</p>
              <p className="text-xs text-ink-500">{r.directionLabel} · {ugx(r.farePerSeat)} per seat</p>
            </div>
            <Badge tone={r.active && r.relayActive ? "good" : r.active ? "warn" : "neutral"}>{r.active ? (r.relayActive ? "Running" : "Relay route off") : "Off"}</Badge>
          </div>
          <Link href={`/settings/relay?stops=${encodeURIComponent(r.relayRouteId)}`} className="inline-block text-xs font-semibold text-gold">Edit stops on this route →</Link>
          <FareEditor route={r} busy={busy === r.id} onSave={(fare) => run(r.id, () => api.adminUpdateTaxipressRoute(r.id, { farePerSeat: fare }))} />
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <Switch checked={r.stopPricingEnabled} disabled={busy === r.id} onChange={(e) => run(r.id, () => api.adminUpdateTaxipressRoute(r.id, { stopPricingEnabled: e.target.checked }))} />
            Cheaper fares for boarding mid-route
          </label>
          <button type="button" disabled={busy === r.id} onClick={() => run(r.id, () => api.adminUpdateTaxipressRoute(r.id, { active: !r.active }))} className={`${smallBtn} ${r.active ? "bg-gold/15 text-ink" : "bg-gold text-ink-gold"}`}>
            {r.active ? "Switch off" : "Switch on"}
          </button>
        </section>
      ))}

      {ready && (
        <Fold title="Add a route">
          {relay.length === 0 ? (
            <p className="text-xs text-ink-500">Set up the route first in <Link href="/settings/relay" className="font-bold text-gold">Relay delivery → Matatu routes</Link>.</p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void run("add", () => api.adminCreateTaxipressRoute({ relayRouteId: adding.relayRouteId, direction: adding.direction, farePerSeat: Number(adding.fare) })
                  .then(() => setAdding({ relayRouteId: "", direction: "a_to_b", fare: "" })));
              }}
            >
              <Field label="Route">
                <Select value={adding.relayRouteId} onValueChange={(v) => setAdding((a) => ({ ...a, relayRouteId: v }))} aria-label="Route" sizing="stretch" className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm">
                  <option value="">Choose a route</option>
                  {relay.map((rr) => <option key={rr.id} value={rr.id}>{rr.name}</option>)}
                </Select>
              </Field>
              <Field label="Direction">
                <Select value={adding.direction} onValueChange={(v) => setAdding((a) => ({ ...a, direction: v as "a_to_b" | "b_to_a" }))} aria-label="Direction" sizing="stretch" className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm">
                  <option value="a_to_b">{chosen ? `${chosen.stageAName} → ${chosen.stageBName}` : "Stage A → Stage B"}</option>
                  <option value="b_to_a">{chosen ? `${chosen.stageBName} → ${chosen.stageAName}` : "Stage B → Stage A"}</option>
                </Select>
              </Field>
              <Field label="Fare per seat (UGX)">
                <input inputMode="numeric" required value={adding.fare} onChange={(e) => setAdding((a) => ({ ...a, fare: digits(e.target.value) }))} className={inputCls} />
              </Field>
              <button type="submit" disabled={busy === "add" || !adding.relayRouteId || !adding.fare} className={`${smallBtn} bg-gold text-ink-gold disabled:opacity-50`}>Add route (starts off)</button>
            </form>
          )}
        </Fold>
      )}
    </div>
  );
}

function FareEditor({ route, busy, onSave }: { route: TaxipressAdminRoute; busy: boolean; onSave: (fare: number) => void }) {
  const [fare, setFare] = useState(String(route.farePerSeat));
  const changed = fare !== "" && Number(fare) !== route.farePerSeat;
  return (
    <div className="flex items-end gap-2">
      <div className="min-w-0 flex-1">
        <Field label="Fare per seat (UGX)">
          <input inputMode="numeric" value={fare} onChange={(e) => setFare(digits(e.target.value))} className={inputCls} />
        </Field>
      </div>
      <button type="button" disabled={!changed || busy} onClick={() => onSave(Number(fare))} className={`${smallBtn} bg-gold text-ink-gold disabled:opacity-50`}>Save</button>
    </div>
  );
}

function TaxisTab() {
  const [taxis, setTaxis] = useState<TaxipressTaxi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api.adminListTaxipressTaxis()
      .then((res) => { if (live) setTaxis(res.taxis); })
      .catch((err) => { if (live) setError(errorMessage(err)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [version]);

  async function update(taxi: TaxipressTaxi, patch: Parameters<typeof api.adminUpdateTaxipressTaxi>[1]) {
    setBusy(taxi.id);
    setError(null);
    try { await api.adminUpdateTaxipressTaxi(taxi.id, patch); setVersion((v) => v + 1); } catch (err) { setError(errorMessage(err)); } finally { setBusy(null); }
  }

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">Each taxi has one approval and two switches. <b>Passengers</b>: it may join the line and take seats. <b>Parcels</b>: it may carry relay parcels (this switch is used when the relay link is added).</p>
      <ErrorNote message={error} />
      {taxis.length === 0 && <p className="text-sm text-ink-500">No taxis have applied yet.</p>}
      {taxis.map((t) => (
        <section key={t.id} className="home-card space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink">{t.plate} · {t.seats} seats</p>
              <p className="text-xs text-ink-500">{t.driverName ?? "Driver"}{t.driverPhone ? ` · ${t.driverPhone}` : ""} · {t.routeName ?? "Route"}</p>
            </div>
            <Badge tone={t.status === "approved" ? "good" : t.status === "pending" ? "warn" : "bad"}>{t.status}</Badge>
          </div>
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <Switch checked={t.passengersEnabled} disabled={busy === t.id} onChange={(e) => update(t, { passengersEnabled: e.target.checked })} />
            Passengers
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-ink">
            <Switch checked={t.parcelsEnabled} disabled={busy === t.id} onChange={(e) => update(t, { parcelsEnabled: e.target.checked })} />
            Parcels
          </label>
          <div className="flex gap-2">
            {t.status !== "approved" && <button type="button" disabled={busy === t.id} onClick={() => update(t, { status: "approved" })} className={`${smallBtn} bg-gold text-ink-gold disabled:opacity-50`}>Approve</button>}
            {t.status !== "suspended" && <button type="button" disabled={busy === t.id} onClick={() => update(t, { status: "suspended" })} className={`${smallBtn} bg-gold/15 text-ink disabled:opacity-50`}>Suspend</button>}
          </div>
        </section>
      ))}
    </div>
  );
}

function LineTab() {
  const [queue, setQueue] = useState<TaxipressAdminQueueEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api.adminTaxipressQueue()
      .then((res) => { if (live) setQueue(res.queue); })
      .catch((err) => { if (live) setError(errorMessage(err)); })
      .finally(() => { if (live) setLoading(false); });
    const id = window.setInterval(() => setVersion((v) => v + 1), 15_000);
    return () => { live = false; window.clearInterval(id); };
  }, [version]);

  async function remove(id: string) {
    setBusy(id);
    setError(null);
    try { await api.adminRemoveTaxipressQueueEntry(id); setVersion((v) => v + 1); } catch (err) { setError(errorMessage(err)); } finally { setBusy(null); }
  }

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;
  const label: Record<string, string> = { boarding: "Boarding now", in_line: "In line", on_road: "On the road" };
  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">Every taxi in a line or on the road right now. Removing a taxi takes it out of the line; the ones behind move up.</p>
      <ErrorNote message={error} />
      {queue.length === 0 && <p className="text-sm text-ink-500">No taxi is in a line.</p>}
      {queue.map((q) => (
        <section key={q.id} className="home-card flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-bold text-ink">{q.plate} · {q.seatsTaken}/{q.seatsTotal} seats</p>
            <p className="text-xs text-ink-500">{label[q.status] ?? q.status} · {q.driverName ?? "Driver"}{q.driverPhone ? ` · ${q.driverPhone}` : ""}</p>
          </div>
          <button type="button" disabled={busy === q.id} onClick={() => remove(q.id)} className={`${smallBtn} shrink-0 bg-gold/15 text-ink disabled:opacity-50`}>Remove</button>
        </section>
      ))}
    </div>
  );
}

function MoneyTab() {
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<TaxipressReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.adminTaxipressReport(days)
      .then((res) => { if (live) { setReport(res); setError(null); } })
      .catch((err) => { if (live) setError(errorMessage(err)); });
    return () => { live = false; };
  }, [days]);

  if (!report) return error ? <ErrorNote message={error} /> : <p className="text-sm text-ink-500">Loading…</p>;
  if (!report.ready) return <p className="rounded-2xl bg-gold/15 p-3 text-xs text-ink">Boarding settlement needs database migration <b>0126_taxipress_settlements.sql</b>. Apply it, then come back.</p>;
  const t = report.totals;
  const cell = (title: string, value: string) => (
    <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3"><p className="text-[11px] text-ink-500">{title}</p><p className="text-sm font-bold text-ink">{value}</p></div>
  );

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d} className={`${smallBtn} ${days === d ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>{d} days</button>
        ))}
      </div>
      <ErrorNote message={error} />
      <Fold title="Seats settled at boarding">
        <div className="grid grid-cols-2 gap-2">
          {cell("Passengers boarded", `${t.bookings} bookings · ${t.seats} seats`)}
          {cell("Fares", ugx(t.fare))}
          {cell("Peebee commission", ugx(t.commission))}
          {cell("Other platform fees", ugx(t.platformFees))}
          {cell("Paid in the app", ugx(t.appFare))}
          {cell("Paid in cash", ugx(t.cashFare))}
          {cell("Released to drivers", ugx(t.driverAmount))}
          {cell("Taken from drivers (cash)", ugx(t.takenFromDrivers))}
        </div>
      </Fold>
      <Fold title="Cancellations, no-shows and refunds">
        <div className="grid grid-cols-2 gap-2">
          {cell("Refunded to passengers", ugx(report.refunds.refunded))}
          {cell("Kept as fees", ugx(report.refunds.fees))}
          {cell("Cancelled by passengers", String(report.refunds.cancelled))}
          {cell("No-shows", String(report.refunds.noShows))}
          {cell("Taxi left the line", String(report.refunds.taxiRemoved))}
        </div>
      </Fold>
      <Fold title="Drivers who owe Peebee">
        <p className="text-xs text-ink-500">Cash commission is taken from the driver&apos;s wallet and can take it below zero. The next payment into the wallet nets against it.</p>
        {report.owing.length === 0 && <p className="text-sm text-ink-500">No taxi driver owes anything.</p>}
        {report.owing.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl bg-[rgb(var(--surface-muted))] px-3 py-2">
            <span className="min-w-0"><span className="block truncate text-sm font-bold text-ink">{o.plate} · {o.name ?? "Driver"}</span>{o.phone && <span className="block text-[11px] text-ink-500">{o.phone}</span>}</span>
            <span className="shrink-0 text-sm font-bold text-ink">{ugx(-o.balance)}</span>
          </div>
        ))}
      </Fold>
      <Fold title="Latest settled seats">
        {report.recent.length === 0 && <p className="text-sm text-ink-500">Nothing yet.</p>}
        {report.recent.map((r) => (
          <div key={r.id} className="flex items-center justify-between gap-3 text-xs">
            <span className="min-w-0 truncate text-ink">{r.plate} · {r.seats} seat{r.seats === 1 ? "" : "s"} · {r.paymentMethod === "cash" ? "cash" : "app"}</span>
            <span className="shrink-0 text-ink-500">{ugx(r.fare)} · commission {ugx(r.commission)}</span>
          </div>
        ))}
      </Fold>
    </div>
  );
}
