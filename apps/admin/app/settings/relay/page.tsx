"use client";

import { Fold } from "../../../components/Fold";
import { ModuleState } from "../../../components/ModuleState";
import { Switch } from "../../../components/ui/Switch";
import { ApiError, hasPermission, type RelayAdminOrder, type RelayDropMode, type RelayOperator, type RelayRoute, type RelayRouteStage, type RelaySettings, type RelayStation } from "@peebee/shared";
import { Select } from "../../../components/ui/Select";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { Badge, ErrorNote, Field, inputCls, label, ugx, when } from "../../../components/work/ui";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

type Tab = "settings" | "routes" | "stations" | "operators" | "orders";
const digits = (v: string) => v.replace(/[^\d]/g, "");
const decimal = (v: string) => v.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1");
const stageCode = (v: string) => v.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 4);
const coord = (v: string) => v.replace(/[^\d.-]/g, "").replace(/(?!^)-/g, "").replace(/(\..*)\./g, "$1");
const smallBtn = "min-h-9 rounded-full px-3 text-xs font-bold";

/** Errors the relay endpoints return with a plain message (503s would otherwise read as "something went wrong"). */
function relayError(err: unknown) {
  if (err instanceof ApiError && err.code === "stations_unavailable") return "Petrol-station drops need database migration 0105.";
  if (err instanceof ApiError && err.code === "relay_unavailable") return "Relay delivery needs database migration 0102.";
  if (err instanceof ApiError && err.code === "stages_unavailable") return "Route stages need database migration 0106.";
  if (err instanceof ApiError && err.code === "codes_unavailable") return "Stage codes need database migration 0107. Apply it first, or leave the codes empty.";
  if (err instanceof ApiError && err.code === "location_required") return "Set this station's map location first.";
  return errorMessage(err);
}

export default function RelayDeliveryPage() {
  const { user } = useAuth();
  const role = user?.adminRole ?? null;
  const canSettings = hasPermission(role, "settings.manage");
  const canOperators = hasPermission(role, "riders.view");
  const canVerify = hasPermission(role, "riders.verify");
  const canOrders = hasPermission(role, "orders.view");

  const tabs = ([
    ["settings", "Settings", canSettings],
    ["routes", "Matatu routes", canSettings],
    ["stations", "Stations", canSettings],
    ["operators", "Operators", canOperators],
    ["orders", "Orders", canOrders],
  ] as [Tab, string, boolean][]).filter(([, , show]) => show);

  const [tab, setTab] = useState<Tab | null>(null);
  const active = tab && tabs.some(([id]) => id === tab) ? tab : (tabs[0]?.[0] ?? null);

  if (!user) return <SettingsPageShell title="Relay delivery" loading>{null}</SettingsPageShell>;

  return (
    <SettingsPageShell title="Relay delivery" loading={false}>
      {tabs.length === 0 ? (
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      ) : (
        <>
          <p className="text-xs text-ink-500">
            Long parcels go boda → matatu → boda: a rider takes the parcel to a matatu stage, an approved matatu operator carries it along a
            route, and a second rider delivers it to the door. Station routes leave it at a petrol station near the customer instead.
          </p>
          {tabs.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {tabs.map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setTab(id)}
                  className={`${smallBtn} shrink-0 ${active === id ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
                >
                  {text}
                </button>
              ))}
            </div>
          )}
          {active === "settings" && <SettingsTab />}
          {active === "routes" && <RoutesTab />}
          {active === "stations" && <StationsTab />}
          {active === "operators" && <OperatorsTab canVerify={canVerify} />}
          {active === "orders" && <OrdersTab />}
        </>
      )}
    </SettingsPageShell>
  );
}

function MigrationNotice() {
  return (
    <p className="rounded-xl bg-gold/15 px-3 py-2 text-sm text-ink">
      Relay delivery needs database migration 0102. Until it is applied, relay stays off and nothing here can be saved.
    </p>
  );
}

function StationsNotice() {
  return (
    <p className="rounded-xl bg-gold/15 px-3 py-2 text-sm text-ink">
      Petrol-station drops need database migration 0105. Until it is applied, every route hands over at the stage.
    </p>
  );
}

function StagesNotice() {
  return (
    <p className="rounded-xl bg-gold/15 px-3 py-2 text-sm text-ink">
      Meeting the matatu at a stage needs database migration 0106. Until it is applied, these settings have no effect.
    </p>
  );
}

function SettingsTab() {
  const [enabled, setEnabled] = useState(false);
  const [minDistance, setMinDistance] = useState("");
  const [maxAccess, setMaxAccess] = useState("");
  const [radius, setRadius] = useState("");
  const [perLeg, setPerLeg] = useState(true);
  const [choice, setChoice] = useState<"order" | "arrival">("order");
  const [stationKm, setStationKm] = useState("");
  const [stagePickup, setStagePickup] = useState(false);
  const [stageFallback, setStageFallback] = useState(true);
  const [speed, setSpeed] = useState("");
  const [noticeMin, setNoticeMin] = useState("");
  const [sandboxDemo, setSandboxDemo] = useState(true);
  const [demoStep, setDemoStep] = useState("");
  const [payFirst, setPayFirst] = useState(true);
  const [directHours, setDirectHours] = useState("");
  const [ready, setReady] = useState(true);
  const [stationsReady, setStationsReady] = useState(true);
  const [stagesReady, setStagesReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function load(s: RelaySettings) {
    setEnabled(s.enabled);
    setMinDistance(String(s.minDistanceKm));
    setMaxAccess(String(s.maxAccessKm));
    setRadius(String(s.lastMileRadiusKm));
    setPerLeg(s.releasePerLeg);
    setChoice(s.lastMileChoice ?? "order");
    setStationKm(String(s.stationMaxKm ?? 10));
    setStagePickup(s.stagePickup ?? false);
    setStageFallback(s.stageFallback ?? true);
    setSpeed(String(s.matatuSpeedKmh ?? 30));
    setNoticeMin(String(s.arrivalNoticeMinutes ?? 10));
    setSandboxDemo(s.sandboxDemo ?? true);
    setDemoStep(String(s.sandboxDemoStepSeconds ?? 20));
    setPayFirst(s.payBeforeRider ?? true);
    setDirectHours(String(s.directMaxHours ?? 3));
  }

  useEffect(() => {
    api
      .adminGetRelaySettings()
      .then((res) => {
        load(res.settings);
        setReady(res.ready);
        setStationsReady(res.stationsReady !== false);
        setStagesReady(res.stagesReady !== false);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.adminUpdateRelaySettings({
        enabled,
        minDistanceKm: Number(minDistance),
        maxAccessKm: Number(maxAccess),
        lastMileRadiusKm: Number(radius),
        releasePerLeg: perLeg,
        lastMileChoice: choice,
        stationMaxKm: Number(stationKm),
        stagePickup,
        stageFallback,
        matatuSpeedKmh: Number(speed),
        arrivalNoticeMinutes: Number(noticeMin),
        sandboxDemo,
        sandboxDemoStepSeconds: Number(demoStep),
        payBeforeRider: payFirst,
        directMaxHours: Number(directHours),
      });
      load(res.settings);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {!ready && <MigrationNotice />}
      {ready && !stationsReady && <StationsNotice />}
      {ready && !stagesReady && <StagesNotice />}
      <Fold head={<label className="flex items-center gap-2 text-sm font-bold text-ink">
          <ModuleState on={enabled} />
          Relay delivery is on
        </label>}>
        <p className="text-xs text-ink-500">Off means every parcel goes the whole way by boda, however long.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Relay parcels longer than (km)">
            <input inputMode="decimal" required value={minDistance} disabled={!enabled} onChange={(e) => setMinDistance(decimal(e.target.value))} className={`${inputCls} disabled:opacity-50`} />
          </Field>
          <Field label="Max distance from pickup/door to a stage (km)">
            <input inputMode="decimal" required value={maxAccess} disabled={!enabled} onChange={(e) => setMaxAccess(decimal(e.target.value))} className={`${inputCls} disabled:opacity-50`} />
          </Field>
          <div className="col-span-2">
            <Field label="Notify riders within (km)" hint="Riders this close to the drop-off stage are told when the matatu is near, so one is ready for the last leg.">
              <input inputMode="decimal" required value={radius} disabled={!enabled} onChange={(e) => setRadius(decimal(e.target.value))} className={`${inputCls} disabled:opacity-50`} />
            </Field>
          </div>
        </div>
      </Fold>
      <Fold title="Relay and Direct at checkout">
        <p className="text-xs text-ink-500">
          Customers choose Relay (same day delivery) or Direct (instant delivery).
        </p>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={payFirst} onChange={(e) => setPayFirst(e.target.checked)} />
          Relay orders are paid straight away, before a rider accepts
        </label>
        <p className="text-xs text-ink-500">
          The payment is held in escrow until delivery, as always. Off means relay orders wait for a rider before payment, like Direct.
        </p>
        <Field label="Direct delivery promised in under (hours)" hint={"Customers see \u201cInstant delivery \u00b7 under N hours\u201d. Whole hours, 1 to 24."}>
          <input inputMode="numeric" required value={directHours} onChange={(e) => setDirectHours(digits(e.target.value))} className={inputCls} />
        </Field>
      </Fold>
      <Fold title="When each leg is paid">
        <div className="grid gap-2">
          {([
            [true, "Pay each leg at its handoff", "A rider or operator is paid as soon as the next one confirms they received the parcel."],
            [false, "Pay all legs when the order settles", "Everyone on the relay is paid together once the order is delivered and settled."],
          ] as [boolean, string, string][]).map(([value, title, hint]) => (
            <button
              key={title}
              type="button"
              onClick={() => setPerLeg(value)}
              aria-pressed={perLeg === value}
              className={`rounded-2xl px-3 py-2.5 text-left transition ${perLeg === value ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
            >
              <span className="block text-sm font-bold">{title}</span>
              <span className="block text-xs opacity-80">{hint}</span>
            </button>
          ))}
        </div>
      </Fold>
      <Fold title="Petrol-station drops">
        <p className="text-xs text-ink-500">For routes that drop at a station: the matatu leaves the parcel there, then a rider brings it or the customer collects it.</p>
        <Field label="Drop station within (km) of the customer">
          <input inputMode="decimal" required value={stationKm} onChange={(e) => setStationKm(decimal(e.target.value))} className={inputCls} />
        </Field>
        <p className="text-xs font-bold text-ink-500">Customer chooses door or collection</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["order", "When ordering"],
            ["arrival", "When it reaches the station"],
          ] as ["order" | "arrival", string][]).map(([value, title]) => (
            <button
              key={value}
              type="button"
              onClick={() => setChoice(value)}
              aria-pressed={choice === value}
              className={`rounded-2xl px-3 py-2.5 text-left text-sm font-bold transition ${choice === value ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
            >
              {title}
            </button>
          ))}
        </div>
      </Fold>
      <Fold title="Meeting the matatu">
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={stagePickup} onChange={(e) => setStagePickup(e.target.checked)} />
          Customers can meet the matatu at a stage
        </label>
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={stageFallback} onChange={(e) => setStageFallback(e.target.checked)} />
          If the customer isn&apos;t there, leave it at the petrol station
        </label>
        <p className="text-xs text-ink-500">Off means the operator calls the customer instead.</p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Average matatu speed (km/h)" hint="Used for arrival times.">
            <input inputMode="decimal" required value={speed} onChange={(e) => setSpeed(decimal(e.target.value))} className={inputCls} />
          </Field>
          <Field label="Send 'arriving soon' this many minutes before">
            <input inputMode="numeric" required value={noticeMin} onChange={(e) => setNoticeMin(digits(e.target.value))} className={inputCls} />
          </Field>
        </div>
      </Fold>
      <Fold title="Sandbox demo">
        <label className="flex items-center gap-2 text-sm font-bold text-ink">
          <Switch checked={sandboxDemo} onChange={(e) => setSandboxDemo(e.target.checked)} />
          Demo riders, matatu and petrol stations run sandbox parcels
        </label>
        <p className="text-xs text-ink-500">
          Sandbox only. Each step waits so a real tester can take any role first; whatever is left, the demo does. Live orders are never touched.
        </p>
        <Field label="Each demo step waits (seconds)">
          <input inputMode="numeric" required value={demoStep} onChange={(e) => setDemoStep(digits(e.target.value))} className={inputCls} />
        </Field>
      </Fold>
      <SettingsSaveBar busy={busy} error={error} saved={saved} />
    </form>
  );
}

type RouteForm = {
  name: string;
  stageAName: string;
  stageALat: string;
  stageALng: string;
  stageBName: string;
  stageBLat: string;
  stageBLng: string;
  /** Short ticket-style codes for the two ends ("KLA", "EBB"). */
  stageACode: string;
  stageBCode: string;
  parcelFare: string;
  active: boolean;
  dropMode: RelayDropMode;
};

const EMPTY_ROUTE: RouteForm = { name: "", stageAName: "", stageALat: "", stageALng: "", stageBName: "", stageBLat: "", stageBLng: "", stageACode: "", stageBCode: "", parcelFare: "", active: true, dropMode: "station" };

/** The route both ways, and each direction: "KLA ⇄ EBB", "KLA - EBB" and "EBB - KLA". */
function routeLabels(r: RelayRoute) {
  const a = r.codes?.a ?? r.stage_a_code ?? "A";
  const b = r.codes?.b ?? r.stage_b_code ?? "B";
  return { a, b, both: r.route_code ?? `${a} ⇄ ${b}`, there: r.directions?.[0] ?? `${a} - ${b}`, back: r.directions?.[1] ?? `${b} - ${a}` };
}

function toForm(r: RelayRoute): RouteForm {
  return {
    name: r.name,
    stageAName: r.stage_a_name,
    stageALat: String(r.stage_a_lat),
    stageALng: String(r.stage_a_lng),
    stageBName: r.stage_b_name,
    stageBLat: String(r.stage_b_lat),
    stageBLng: String(r.stage_b_lng),
    stageACode: r.stage_a_code ?? "",
    stageBCode: r.stage_b_code ?? "",
    parcelFare: String(r.parcel_fare),
    active: r.active === 1,
    dropMode: r.drop_mode ?? "stage",
  };
}

function RoutesTab() {
  const [routes, setRoutes] = useState<RelayRoute[]>([]);
  const [ready, setReady] = useState(true);
  const [codesReady, setCodesReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [form, setForm] = useState<RouteForm>(EMPTY_ROUTE);
  const [busy, setBusy] = useState(false);
  const [stagesFor, setStagesFor] = useState<string | null>(null);
  const stagesRoute = routes.find((r) => r.id === stagesFor) ?? null;
  // Opened from TaxiPress settings with ?stops=<route id>: go straight to that route's stops editor.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("stops");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the query string is readable only after mount
    if (id) setStagesFor(id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.adminListRelayRoutes();
      setRoutes(res.routes);
      setReady(res.ready);
      setCodesReady(res.codesReady !== false);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  function startEdit(r: RelayRoute | null) {
    setEditing(r ? r.id : "new");
    setStagesFor(null);
    setForm(r ? toForm(r) : EMPTY_ROUTE);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const nums = [form.stageALat, form.stageALng, form.stageBLat, form.stageBLng].map(Number);
    if (nums.some((n) => !Number.isFinite(n)) || Math.abs(nums[0]!) > 90 || Math.abs(nums[2]!) > 90 || Math.abs(nums[1]!) > 180 || Math.abs(nums[3]!) > 180) {
      setError("Enter a valid latitude and longitude for both stages.");
      return;
    }
    if ([form.stageACode, form.stageBCode].some((code) => code !== "" && !/^[A-Z]{2,4}$/.test(code))) {
      setError("Each stage code is 2 to 4 letters, like KLA or EBB.");
      return;
    }
    const input = {
      name: form.name.trim(),
      stageAName: form.stageAName.trim(),
      stageALat: nums[0]!,
      stageALng: nums[1]!,
      stageBName: form.stageBName.trim(),
      stageBLat: nums[2]!,
      stageBLng: nums[3]!,
      parcelFare: Number(form.parcelFare),
      active: form.active,
      dropMode: form.dropMode,
      // Codes are saved once migration 0107 is applied; until then they're left out.
      ...(codesReady ? { stageACode: form.stageACode, stageBCode: form.stageBCode } : {}),
    };
    setBusy(true);
    setError(null);
    try {
      if (editing === "new") await api.adminCreateRelayRoute(input);
      else if (editing) await api.adminUpdateRelayRoute(editing, input);
      setEditing(null);
      await refresh();
    } catch (err) {
      setError(relayError(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: RelayRoute) {
    try {
      await api.adminUpdateRelayRoute(r.id, { active: r.active !== 1 });
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const set = (key: keyof RouteForm, value: string | boolean) => setForm((f) => ({ ...f, [key]: value }));

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;

  return (
    <div className="space-y-4">
      {!ready && <MigrationNotice />}
      {editing === null && <ErrorNote message={error} />}
      {editing === null ? (
        <button type="button" disabled={!ready} onClick={() => startEdit(null)} className="min-h-11 w-full rounded-[20px] bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-50">
          Add a matatu route
        </button>
      ) : (
        <form onSubmit={onSubmit} className="home-card space-y-3">
          <p className="text-sm font-bold text-ink">{editing === "new" ? "New matatu route" : "Edit route"}</p>
          <Field label="Route name">
            <input required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Kampala – Jinja" className={inputCls} />
          </Field>
          {(["A", "B"] as const).map((s) => (
            <div key={s} className="space-y-2 border-t border-[var(--border-faint)] pt-3">
              <div className="grid grid-cols-[1fr_6rem] gap-3">
                <Field label={`Stage ${s} name`}>
                  <input required value={form[`stage${s}Name`]} onChange={(e) => set(`stage${s}Name`, e.target.value)} placeholder={s === "A" ? "Kampala Old Taxi Park" : "Entebbe Kitoro"} className={inputCls} />
                </Field>
                <Field label="Code">
                  <input
                    value={form[`stage${s}Code`]}
                    onChange={(e) => set(`stage${s}Code`, stageCode(e.target.value))}
                    placeholder={s === "A" ? "KLA" : "EBB"}
                    maxLength={4}
                    autoCapitalize="characters"
                    disabled={!codesReady}
                    aria-label={`Stage ${s} code`}
                    className={`${inputCls} uppercase disabled:opacity-50`}
                  />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitude">
                  <input required inputMode="decimal" value={form[`stage${s}Lat`]} onChange={(e) => set(`stage${s}Lat`, coord(e.target.value))} placeholder="0.3136" className={inputCls} />
                </Field>
                <Field label="Longitude">
                  <input required inputMode="decimal" value={form[`stage${s}Lng`]} onChange={(e) => set(`stage${s}Lng`, coord(e.target.value))} placeholder="32.5811" className={inputCls} />
                </Field>
              </div>
            </div>
          ))}
          <p className="text-xs text-ink-500">
            {codesReady
              ? `Codes are 2 to 4 letters, written like a ticket. The route runs both ways: ${form.stageACode || "KLA"} - ${form.stageBCode || "EBB"} and ${form.stageBCode || "EBB"} - ${form.stageACode || "KLA"}. Left empty, a code is the first three letters of the stage name.`
              : "Stage codes need database migration 0107. Until it is applied, each code is the first three letters of the stage name."}
          </p>
          <div className="border-t border-[var(--border-faint)] pt-3">
            <Field label="Parcel fare (UGX)" hint="What the matatu operator is paid to carry one parcel between the two stages.">
              <input required inputMode="numeric" value={form.parcelFare} onChange={(e) => set("parcelFare", digits(e.target.value))} className={inputCls} />
            </Field>
          </div>
          <div className="space-y-2 border-t border-[var(--border-faint)] pt-3">
            <p className="text-xs font-bold text-ink-500">At the far end</p>
            {([
              ["stage", "Hand to a rider at the stage"],
              ["station", "Drop at the petrol station nearest the customer"],
            ] as [RelayDropMode, string][]).map(([value, title]) => (
              <button
                key={value}
                type="button"
                onClick={() => set("dropMode", value)}
                aria-pressed={form.dropMode === value}
                className={`block w-full rounded-2xl px-3 py-2.5 text-left text-sm font-bold transition ${form.dropMode === value ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
              >
                {title}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Switch checked={form.active} onChange={(e) => set("active", e.target.checked)} />
            Route is active
          </label>
          <ErrorNote message={error} />
          <div className="flex gap-2">
            <button type="button" onClick={() => setEditing(null)} disabled={busy} className="min-h-11 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink">
              Cancel
            </button>
            <button type="submit" disabled={busy} className="min-h-11 flex-1 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-50">
              {busy ? "Saving…" : "Save route"}
            </button>
          </div>
        </form>
      )}

      {editing === null && stagesRoute && <StagesEditor key={stagesRoute.id} route={stagesRoute} onClose={() => setStagesFor(null)} />}

      {routes.length === 0 ? (
        <p className="text-sm text-ink-500">No matatu routes yet.</p>
      ) : (
        <div className="home-card overflow-x-auto p-0">
          <table className="w-full min-w-[600px] text-left text-sm">
            <thead className="text-xs text-ink-500">
              <tr className="border-b border-[var(--border-faint)]">
                <th className="px-3 py-2 font-semibold">Route</th>
                <th className="px-3 py-2 font-semibold">Stages</th>
                <th className="px-3 py-2 font-semibold">Drop</th>
                <th className="px-3 py-2 font-semibold">Parcel fare</th>
                <th className="px-3 py-2 font-semibold">Operators</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-faint)]">
              {routes.map((r) => {
                const labels = routeLabels(r);
                return (
                <tr key={r.id} className="text-ink">
                  <td className="px-3 py-2">
                    <span className="block whitespace-nowrap font-bold">{labels.both}</span>
                    <span className="block whitespace-nowrap text-xs text-ink-500">{labels.there} · {labels.back}</span>
                    <span className="block text-xs text-ink-500">{r.name}</span>
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-500">
                    <span className="block">{labels.a}: {r.stage_a_name}</span>
                    <span className="block">{labels.b}: {r.stage_b_name}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-xs">{r.drop_mode === "station" ? "Petrol station" : "Stage"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{ugx(r.parcel_fare)}</td>
                  <td className="px-3 py-2">{r.operators ?? 0}</td>
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => toggleActive(r)} title={r.active === 1 ? "Turn off" : "Turn on"}>
                      <Badge tone={r.active === 1 ? "good" : "neutral"}>{r.active === 1 ? "active" : "off"}</Badge>
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(null);
                        setStagesFor((id) => (id === r.id ? null : r.id));
                      }}
                      aria-pressed={stagesFor === r.id}
                      className={`${smallBtn} mr-2 ${stagesFor === r.id ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
                    >
                      Stages
                    </button>
                    <button type="button" onClick={() => startEdit(r)} className={`${smallBtn} bg-gold/15 text-ink`}>
                      Edit
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type StageDraft = { name: string; seq: string };

/** The stops between stage A and stage B where a customer can meet the matatu. */
function StagesEditor({ route, onClose }: { route: RelayRoute; onClose: () => void }) {
  const [stages, setStages] = useState<RelayRouteStage[]>([]);
  const [drafts, setDrafts] = useState<Record<string, StageDraft>>({});
  const [stations, setStations] = useState<RelayStation[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<"point" | "station">("point");
  const [add, setAdd] = useState({ name: "", lat: "", lng: "", outletId: "", seq: "" });

  const refresh = useCallback(async () => {
    try {
      const res = await api.adminListRelayRouteStages(route.id);
      const sorted = [...res.stages].sort((a, b) => a.seq - b.seq);
      setStages(sorted);
      setDrafts(Object.fromEntries(sorted.map((st) => [st.id, { name: st.name, seq: String(st.seq) }])));
      setReady(res.ready);
      setError(null);
    } catch (err) {
      setError(relayError(err));
    } finally {
      setLoading(false);
    }
  }, [route.id]);

  useEffect(() => {
    void refresh();
    api
      .adminListRelayStations()
      .then((res) => setStations(res.stations))
      .catch(() => setStations([]));
  }, [refresh]);

  const nextSeq = stages.length ? Math.max(...stages.map((st) => st.seq)) + 1 : 1;

  async function save(st: RelayRouteStage, patch: Partial<{ name: string; seq: number; active: boolean }>) {
    setBusyId(st.id);
    setError(null);
    try {
      await api.adminUpdateRelayRouteStage(st.id, patch);
      await refresh();
    } catch (err) {
      setError(`${st.name}: ${relayError(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    const seq = add.seq ? Number(add.seq) : nextSeq;
    let input: Parameters<typeof api.adminCreateRelayRouteStage>[1];
    if (addMode === "station") {
      if (!add.outletId) {
        setError("Pick a station.");
        return;
      }
      input = { outletId: add.outletId, seq, ...(add.name.trim() ? { name: add.name.trim() } : {}) };
    } else {
      const lat = Number(add.lat);
      const lng = Number(add.lng);
      if (!add.name.trim() || !add.lat || !add.lng || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
        setError("Enter a name and a valid latitude and longitude.");
        return;
      }
      input = { name: add.name.trim(), lat, lng, seq };
    }
    setBusyId("new");
    setError(null);
    try {
      await api.adminCreateRelayRouteStage(route.id, input);
      setAdd({ name: "", lat: "", lng: "", outletId: "", seq: "" });
      await refresh();
    } catch (err) {
      setError(relayError(err));
    } finally {
      setBusyId(null);
    }
  }

  const labels = routeLabels(route);
  const ends = (name: string, tag: string) => (
    <li className="flex items-center justify-between gap-2 rounded-xl bg-[rgb(var(--surface-muted))] px-3 py-2 text-sm">
      <span className="truncate font-semibold text-ink">{name}</span>
      <span className="shrink-0 text-xs text-ink-500">{tag}</span>
    </li>
  );

  return (
    <section className="home-card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-ink">Stages · {labels.both}</p>
        <button type="button" onClick={onClose} className={`${smallBtn} bg-gold/15 text-ink`}>
          Close
        </button>
      </div>
      <p className="text-xs text-ink-500">
        Stops where a customer can meet the matatu, in the order it passes them going {labels.there}. Going {labels.back} the matatu uses the
        same stops in reverse.
      </p>
      {!ready && <StagesNotice />}
      <ErrorNote message={error} />
      {loading ? (
        <p className="text-sm text-ink-500">Loading…</p>
      ) : (
        <ol className="space-y-2">
          {ends(route.stage_a_name, `Stage A · ${labels.a}`)}
          {stages.map((st) => {
            const d = drafts[st.id] ?? { name: st.name, seq: String(st.seq) };
            const changed = d.name.trim() !== st.name || Number(d.seq) !== st.seq;
            const on = st.active === 1;
            return (
              <li key={st.id} className={`space-y-2 rounded-xl border border-[var(--border-faint)] px-3 py-2 ${on ? "" : "opacity-60"}`}>
                <div className="flex items-center gap-2">
                  <input
                    aria-label="Order"
                    inputMode="numeric"
                    value={d.seq}
                    onChange={(e) => setDrafts((all) => ({ ...all, [st.id]: { ...d, seq: digits(e.target.value) } }))}
                    className={`${inputCls} w-16 shrink-0 text-center`}
                  />
                  <input
                    aria-label="Stage name"
                    value={d.name}
                    onChange={(e) => setDrafts((all) => ({ ...all, [st.id]: { ...d, name: e.target.value } }))}
                    className={`${inputCls} min-w-0 flex-1`}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-ink-500">
                    {st.outlet_id ? `Petrol station · ${[st.station_brand, st.outlet_name].filter(Boolean).join(" ")}` : `${st.lat}, ${st.lng}`}
                  </span>
                  <span className="flex gap-2">
                    {changed && (
                      <button
                        type="button"
                        disabled={busyId === st.id || d.name.trim().length < 2 || d.seq === ""}
                        onClick={() => save(st, { name: d.name.trim(), seq: Number(d.seq) })}
                        className={`${smallBtn} bg-gold text-ink-gold disabled:opacity-50`}
                      >
                        Save
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === st.id}
                      onClick={() => save(st, { active: !on })}
                      aria-pressed={on}
                      className={`${smallBtn} disabled:opacity-50 ${on ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
                    >
                      {on ? "Active" : "Off"}
                    </button>
                  </span>
                </div>
              </li>
            );
          })}
          {ends(route.stage_b_name, `Stage B · ${labels.b}`)}
        </ol>
      )}

      <form onSubmit={onAdd} className="space-y-3 border-t border-[var(--border-faint)] pt-3">
        <p className="text-xs font-bold text-ink-500">Add a stage</p>
        <div className="grid grid-cols-2 gap-2">
          {([
            ["point", "Map point"],
            ["station", "Peebee Gas station"],
          ] as ["point" | "station", string][]).map(([value, title]) => (
            <button
              key={value}
              type="button"
              onClick={() => setAddMode(value)}
              aria-pressed={addMode === value}
              className={`rounded-2xl px-3 py-2.5 text-left text-sm font-bold transition ${addMode === value ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
            >
              {title}
            </button>
          ))}
        </div>
        {addMode === "station" ? (
          <Field label="Station">
            <Select
              value={add.outletId}
              onValueChange={(v) => setAdd((a) => ({ ...a, outletId: v }))}
              aria-label="Station"
              sizing="stretch"
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm"
            >
              <option value="">Choose a station…</option>
              {stations.map((st) => (
                <option key={st.id} value={st.id} disabled={st.lat == null || st.lng == null}>
                  {`${st.station_name} · ${st.name}${st.lat == null || st.lng == null ? " (no map location)" : ""}`}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        <Field label={addMode === "station" ? "Name (optional)" : "Name"}>
          <input value={add.name} onChange={(e) => setAdd((a) => ({ ...a, name: e.target.value }))} placeholder="Mukono stage" className={inputCls} />
        </Field>
        {addMode === "point" && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Latitude">
              <input inputMode="decimal" value={add.lat} onChange={(e) => setAdd((a) => ({ ...a, lat: coord(e.target.value) }))} placeholder="0.3533" className={inputCls} />
            </Field>
            <Field label="Longitude">
              <input inputMode="decimal" value={add.lng} onChange={(e) => setAdd((a) => ({ ...a, lng: coord(e.target.value) }))} placeholder="32.7553" className={inputCls} />
            </Field>
          </div>
        )}
        <Field label="Order" hint="Lower numbers are nearer stage A.">
          <input inputMode="numeric" value={add.seq} onChange={(e) => setAdd((a) => ({ ...a, seq: digits(e.target.value) }))} placeholder={String(nextSeq)} className={inputCls} />
        </Field>
        <button type="submit" disabled={!ready || busyId === "new"} className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-50">
          {busyId === "new" ? "Adding…" : "Add stage"}
        </button>
      </form>
    </section>
  );
}

type StationMode = "off" | "sandbox" | "live";
const STATION_MODES: Array<{ mode: StationMode; label: string }> = [
  { mode: "off", label: "Off" },
  { mode: "sandbox", label: "Sandbox" },
  { mode: "live", label: "Live" },
];
const stationMode = (s: RelayStation): StationMode => (s.relay_drop === 1 ? "live" : s.relay_drop === 2 ? "sandbox" : "off");

function StationsTab() {
  const [stations, setStations] = useState<RelayStation[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.adminListRelayStations();
      setStations(res.stations);
      setReady(res.ready);
      setError(null);
    } catch (err) {
      setError(relayError(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  async function setMode(s: RelayStation, mode: StationMode) {
    if (stationMode(s) === mode) return;
    setBusyId(s.id);
    setError(null);
    try {
      await api.adminSetRelayStation(s.id, mode);
      await refresh();
    } catch (err) {
      setError(`${s.name}: ${relayError(err)}`);
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;

  return (
    <div className="space-y-2">
      {!ready && <StationsNotice />}
      <p className="text-xs text-ink-500">
        Stations that accept relay parcels. Relay is rolled out route by route: a station serves a route once it is one of that route&rsquo;s
        stages (Routes tab), and a station-drop route leaves each parcel at its open station nearest the customer. &ldquo;Sandbox&rdquo; stations only take
        parcels while the platform is in sandbox (and in practice), for trialling a station before it goes live.
      </p>
      <ErrorNote message={error} />
      {ready && stations.length === 0 && <p className="text-sm text-ink-500">No Peebee Gas stations yet.</p>}
      <ul className="space-y-2">
        {stations.map((s) => {
          const current = stationMode(s);
          return (
            <li key={s.id} className="home-card flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {s.station_name} · {s.name}
                </p>
                <p className="truncate text-xs text-ink-500">
                  {s.address ?? "No address"}
                  {s.lat == null || s.lng == null ? " · no map location" : ""} · holding {s.holding} parcel{s.holding === 1 ? "" : "s"}
                </p>
                <p className="truncate text-xs text-ink-500">{s.routes ? `Route: ${s.routes}` : "Not on a route yet"}</p>
              </div>
              <div className="flex shrink-0 gap-1" role="group" aria-label={`${s.name} relay parcels`}>
                {STATION_MODES.map(({ mode, label }) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={busyId === s.id}
                    onClick={() => setMode(s, mode)}
                    aria-pressed={current === mode}
                    className={`${smallBtn} disabled:opacity-50 ${current === mode ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function OperatorsTab({ canVerify }: { canVerify: boolean }) {
  const [operators, setOperators] = useState<RelayOperator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.adminListRelayOperators();
      setOperators(res.operators);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void refresh(), [refresh]);

  async function setStatus(userId: string, status: "approved" | "suspended") {
    setBusyId(userId);
    try {
      await api.adminSetRelayOperatorStatus(userId, status);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  }

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;

  return (
    <div className="space-y-2">
      <ErrorNote message={error} />
      {operators.length === 0 && <p className="text-sm text-ink-500">No matatu operators have applied yet.</p>}
      <ul className="space-y-2">
        {operators.map((o) => (
          <li key={o.user_id} className="home-card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold text-ink">
                {o.name ?? "Operator"} <span className="font-normal text-ink-500">· {o.vehicle_plate}</span>
              </p>
              <Badge>{o.status}</Badge>
            </div>
            <p className="text-xs text-ink-500">
              {o.route_code ? `${o.route_code} (${o.route_name ?? "route"})` : o.route_name ?? "No route"} · {o.phone ?? o.account_phone ?? "no phone"} · {o.parcels ?? 0} parcels · applied {when(o.created_at)}
            </p>
            {canVerify && (
              <div className="flex gap-2">
                {o.status !== "approved" && (
                  <button type="button" disabled={busyId === o.user_id} className={`${smallBtn} bg-gold text-ink-gold disabled:opacity-50`} onClick={() => setStatus(o.user_id, "approved")}>
                    Approve
                  </button>
                )}
                {o.status !== "suspended" && (
                  <button type="button" disabled={busyId === o.user_id} className={`${smallBtn} bg-gold/15 text-ink disabled:opacity-50`} onClick={() => setStatus(o.user_id, "suspended")}>
                    Suspend
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState<RelayAdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .adminListRelayOrders()
      .then((res) => setOrders(res.orders))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-ink-500">Loading…</p>;

  return (
    <div className="space-y-2">
      <ErrorNote message={error} />
      {orders.length === 0 && <p className="text-sm text-ink-500">No relayed orders yet.</p>}
      <ul className="space-y-2">
        {orders.map((o) => (
          <li key={o.id} className="home-card space-y-2">
            <div className="flex items-start justify-between gap-2">
              <Link href={`/orders/${o.id}`} className="text-sm font-semibold text-ink underline-offset-2 hover:underline">
                Order {o.id.slice(0, 8)}
              </Link>
              <span className="text-xs text-ink-500">
                {label(o.stage)} · {when(o.createdAt)}
                {o.environment !== "live" ? ` · ${o.environment}` : ""}
              </span>
            </div>
            <ol className="space-y-1.5">
              {o.legs.map((l) => (
                <li key={l.leg} className="rounded-xl bg-[rgb(var(--surface-muted))] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-ink">
                      {l.leg}. {l.kind === "matatu" ? "Matatu" : "Boda"} · {l.fromName} → {l.toName}
                    </p>
                    <Badge>{l.status}</Badge>
                  </div>
                  <p className="text-[11px] text-ink-500">
                    {l.providerName ?? "No provider yet"} · fee {ugx(l.fee)} · handed over {when(l.handedOverAt)} · paid {l.paidAmount == null ? "—" : `${ugx(l.paidAmount)}${l.paidAt ? ` on ${when(l.paidAt)}` : ""}`}
                  </p>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </div>
  );
}
