"use client";

import { DEFAULT_MODULE_NOTICE, MODULES, syncedFlag, getModule, MODULE_CLUSTERS, MODULE_NOTICE_MESSAGE_MAX, MODULE_NOTICE_REASONS, MODULE_OFFLINE_DISPLAYS, type ModuleOfflineDisplay, childrenOf, cleanModuleNotice, resolveModuleAvailability, WEBSITE_SECTIONS, type ModuleDef, type ModuleFlags, type ModuleNotice, type ModuleNotices, type ModuleWorld } from "@peebee/shared";
import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { Select } from "../../../components/ui/Select";
import { Switch } from "../../../components/ui/Switch";
import { api, errorMessage } from "../../../lib/api";

const WORLDS: Array<{ id: ModuleWorld; label: string; blurb: string }> = [
  { id: "live", label: "Live", blurb: "What real people get. Off stops new orders; work in progress finishes." },
  { id: "practice", label: "Practice", blurb: "The practice world. Try a module here before switching Live on." },
];

export default function ServicesPage() {
  const [saved, setSaved] = useState<ModuleFlags | null>(null);
  const [flags, setFlags] = useState<ModuleFlags | null>(null);
  const [savedNotices, setSavedNotices] = useState<ModuleNotices>({});
  const [notices, setNotices] = useState<ModuleNotices>({});
  const [world, setWorld] = useState<ModuleWorld>("live");
  const [savedSync, setSavedSync] = useState(false);
  const [sync, setSync] = useState(false);
  const [savedDisplay, setSavedDisplay] = useState<ModuleOfflineDisplay>("hide");
  const [display, setDisplay] = useState<ModuleOfflineDisplay>("hide");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    api.adminGetModules()
      .then(({ modules }) => { setSavedSync(!!modules.sync); setSync(!!modules.sync); setSavedDisplay(modules.display ?? "hide"); setDisplay(modules.display ?? "hide"); setSaved(modules.flags); setFlags(structuredClone(modules.flags)); setSavedNotices(modules.notices ?? {}); setNotices(structuredClone(modules.notices ?? {})); })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  const available = useMemo(() => (flags ? resolveModuleAvailability(flags, sync) : null), [flags, sync]);
  const changes = useMemo(() => {
    const out: { live: Record<string, boolean>; practice: Record<string, boolean>; notices: Record<string, ModuleNotice | null>; sync?: boolean; display?: ModuleOfflineDisplay } = { live: {}, practice: {}, notices: {} };
    if (sync !== savedSync) out.sync = sync;
    if (display !== savedDisplay) out.display = display;
    if (!flags || !saved) return out;
    for (const def of MODULES) for (const w of ["live", "practice"] as const) if (flags[def.key]![w] !== saved[def.key]![w]) out[w][def.key] = flags[def.key]![w];
    for (const key of new Set([...Object.keys(notices), ...Object.keys(savedNotices)])) {
      if (JSON.stringify(notices[key] ?? null) !== JSON.stringify(savedNotices[key] ?? null)) out.notices[key] = notices[key] ?? null;
    }
    return out;
  }, [flags, saved, notices, savedNotices, sync, savedSync, display, savedDisplay]);
  const dirty = (changes.sync === undefined ? 0 : 1) + (changes.display === undefined ? 0 : 1) + Object.keys(changes.live).length + Object.keys(changes.practice).length + Object.keys(changes.notices).length;

  function setNotice(key: string, notice: ModuleNotice | null) {
    setDone(false);
    setNotices((n) => { const next = { ...n }; if (notice) next[key] = notice; else delete next[key]; return next; });
  }

  function toggle(key: string, w: ModuleWorld, on: boolean) {
    setDone(false);
    // Kept the same: a switch in either world sets both (Channels has no Practice, so it only has Live).
    const both = sync && getModule(key)?.practice.coverage !== "none";
    setFlags((f) => (f ? { ...f, [key]: both ? { live: on, practice: on } : { ...f[key]!, [w]: on } } : f));
  }

  function setKeepSame(on: boolean) {
    setDone(false);
    setSync(on);
    // Switching it on makes the worlds agree at once: off in one is off in the other.
    if (on) setFlags((f) => (f ? Object.fromEntries(MODULES.map((m) => [m.key, syncedFlag(m, f[m.key]!, true)])) : f));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true); setError(null); setDone(false);
    try {
      const { modules } = await api.adminUpdateModules(changes);
      setSavedSync(!!modules.sync); setSync(!!modules.sync); setSavedDisplay(modules.display ?? "hide"); setDisplay(modules.display ?? "hide"); setSaved(modules.flags); setFlags(structuredClone(modules.flags)); setSavedNotices(modules.notices ?? {}); setNotices(structuredClone(modules.notices ?? {})); setDone(true);
    } catch (err) { setError(errorMessage(err)); }
    finally { setBusy(false); }
  }

  // Kept the same: one list, shown as Live (Practice is identical, except Channels which has no Practice).
  const shown: ModuleWorld = sync ? "live" : world;
  const current = WORLDS.find((w) => w.id === shown)!;

  return (
    <SettingsPageShell title="Services" description="Switch a whole service, or one thing inside it, on or off." loading={loading}>
      {flags && available && (
        <form onSubmit={onSubmit} className="space-y-5">
          <div className="home-card flex items-start gap-3">
            <Switch aria-label="Keep Live and Practice the same" checked={sync} onChange={(e) => setKeepSame(e.target.checked)} className="mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-ink">Keep Live and Practice the same</p>
              <p className="text-xs text-ink-500">
                {sync ? "One list controls Live and Practice together." : "Live and Practice have their own switches."}
              </p>
            </div>
          </div>
          <div className="home-card space-y-3">
            <div>
              <p className="text-sm font-bold text-ink">When a module is off</p>
            </div>
            <div role="radiogroup" aria-label="When a module is off" className="grid grid-cols-2 gap-1 rounded-full bg-[rgb(var(--surface-muted))] p-1 sm:inline-grid sm:min-w-[22rem]">
              {MODULE_OFFLINE_DISPLAYS.map((d) => (
                <button key={d.id} type="button" role="radio" aria-checked={display === d.id} onClick={() => { setDisplay(d.id); setDone(false); }}
                  className={`min-h-10 rounded-full px-4 text-sm font-bold transition ${display === d.id ? "bg-[rgb(var(--surface-card))] text-ink shadow-sm" : "text-ink-500"}`}>
                  {d.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-ink-500">{MODULE_OFFLINE_DISPLAYS.find((d) => d.id === display)?.hint}</p>
          </div>
          {!sync && <div role="tablist" aria-label="World" className="grid grid-cols-2 gap-1 rounded-full bg-[rgb(var(--surface-muted))] p-1 sm:inline-grid sm:min-w-[22rem]">
            {WORLDS.map((w) => (
              <button key={w.id} type="button" role="tab" aria-selected={world === w.id} onClick={() => setWorld(w.id)}
                className={`min-h-10 rounded-full px-4 text-sm font-bold transition ${world === w.id ? "bg-[rgb(var(--surface-card))] text-ink shadow-sm" : "text-ink-500"}`}>
                {w.label}
              </button>
            ))}
          </div>}
          {!sync && <p className="max-w-2xl text-sm text-ink-500">{current.blurb}</p>}
          {!sync && world === "practice" && (
            <p className="text-xs text-ink-500">Practice as a whole, and what each module&rsquo;s practice world contains, is managed in <Link href="/practice" className="font-bold text-ink underline">Practice</Link>.</p>
          )}

          {MODULE_CLUSTERS.map((cluster) => (
            <ClusterCard key={cluster.id} cluster={cluster} world={shown} flags={flags} available={available} onToggle={toggle} notices={notices} onNotice={setNotice} />
          ))}
          <SettingsSaveBar busy={busy} error={error} saved={done} />
        </form>
      )}
      {!flags && error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    </SettingsPageShell>
  );
}

type Available = ReturnType<typeof resolveModuleAvailability>;
type Toggle = (key: string, world: ModuleWorld, on: boolean) => void;
type NoticeProps = { notices: ModuleNotices; onNotice: (key: string, notice: ModuleNotice | null) => void };

/** A cluster (Ride, Buy, Learn...): its own switch in the header, and everything inside it listed below. */
function ClusterCard({ cluster, world, flags, available, onToggle, notices, onNotice }: {
  cluster: (typeof MODULE_CLUSTERS)[number]; world: ModuleWorld; flags: ModuleFlags; available: Available; onToggle: Toggle;
} & NoticeProps) {
  const [open, setOpen] = useState(false);
  const root = MODULES.find((m) => m.key === cluster.id);
  const inside = MODULES.filter((m) => m.cluster === cluster.id && m.key !== cluster.id);
  const on = inside.filter((m) => available[m.key]![world]).length;
  const rootOn = root ? flags[root.key]![world] : true;
  const liveOnly = root?.practice.coverage === "none";
  return (
    <section className="home-card space-y-3">
      <header className="flex items-start gap-3">
        {root && !(world === "practice" && liveOnly) ? (
          <Switch aria-label={`${cluster.label} in ${world}`} checked={rootOn} onChange={(e) => onToggle(root.key, world, e.target.checked)} className="mt-1 shrink-0" />
        ) : null}
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-extrabold text-ink">
            {cluster.label}{" "}
            <span className="text-sm font-normal text-ink-500">
              {world === "practice" && liveOnly ? "Not part of Practice" : !rootOn ? "Off — everything inside is offline" : `${on} of ${inside.length} on`}
            </span>
          </h2>
          {open && <p className="text-sm text-ink-500">{cluster.description}</p>}
        </div>
        {inside.length > 0 && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} what is inside ${cluster.label}`} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500">
            <ChevronDown className={`h-6 w-6 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
          </button>
        )}
      </header>
      {root && !rootOn && !(world === "practice" && liveOnly) && <NoticeEditor def={root} notice={notices[root.key]} onChange={(n) => onNotice(root.key, n)} />}
      {open && rootOn && !(world === "practice" && liveOnly) && root && childrenOf(root.key).length > 0 && (
        <ul className="space-y-1 border-t border-[var(--border-faint)] pt-2">
          {childrenOf(root.key).map((c) => <ModuleRow key={c.key} def={c} depth={0} world={world} flags={flags} available={available} onToggle={onToggle} notices={notices} onNotice={onNotice} />)}
        </ul>
      )}
    </section>
  );
}

function ModuleRow({ def, depth, world, flags, available, onToggle, notices, onNotice }: {
  def: ModuleDef; depth: number; world: ModuleWorld; flags: ModuleFlags;
  available: Available;
  onToggle: Toggle;
} & NoticeProps) {
  const own = flags[def.key]![world];
  const practiceOnly = world === "live" && flags[def.key]!.practice && !flags[def.key]!.live;
  return (
    <li>
      <div className="flex items-start gap-3 rounded-xl px-2 py-2" style={{ marginLeft: depth * 20 }}>
        <Switch aria-label={`${def.label} in ${world}`} checked={own} onChange={(e) => onToggle(def.key, world, e.target.checked)} className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-ink">
            {def.label}{" "}
            <span className="font-normal text-ink-500">— {own ? "on" : "off"}</span>
          </p>
          <p className="text-xs text-ink-500">{def.description}</p>
          {world === "live" && <WebsiteReach moduleKey={def.key} />}
          {practiceOnly && <p className="mt-0.5 text-xs font-semibold text-ink">On in Practice only. Switch it on here to make it live.</p>}
          {!own && childrenOf(def.key).length > 0 && <p className="mt-0.5 text-xs text-ink-500">{countInside(def.key)} inside are offline while this is off.</p>}
          {!own && <NoticeEditor def={def} notice={notices[def.key]} onChange={(n) => onNotice(def.key, n)} />}
        </div>
      </div>
      {own && childrenOf(def.key).length > 0 && (
        <ul className="space-y-1">
          {childrenOf(def.key).map((c) => <ModuleRow key={c.key} def={c} depth={depth + 1} world={world} flags={flags} available={available} onToggle={onToggle} notices={notices} onNotice={onNotice} />)}
        </ul>
      )}
    </li>
  );
}

/** What people see on the screens of a module that is off: why, an optional message, and an optional launch or return date. */
function NoticeEditor({ def, notice, onChange }: { def: ModuleDef; notice: ModuleNotice | undefined; onChange: (notice: ModuleNotice | null) => void }) {
  const current = notice ?? DEFAULT_MODULE_NOTICE;
  const reason = MODULE_NOTICE_REASONS.find((r) => r.id === current.reason)!;
  // An untouched "Not available" with no words is the default, so it is stored as nothing.
  const update = (patch: Partial<ModuleNotice>) => {
    const merged = { ...current, ...patch };
    // Keep the message as typed (a trailing space is how the next word starts); the server trims what it stores.
    const next: ModuleNotice = { reason: merged.reason, ...(merged.message?.trim() ? { message: merged.message } : {}), ...(merged.returnAt && cleanModuleNotice({ reason: merged.reason, returnAt: merged.returnAt })?.returnAt ? { returnAt: merged.returnAt } : {}) };
    onChange(next.reason === "unavailable" && !next.message && !next.returnAt ? null : next);
  };
  return (
    <div className="mt-2 space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
      <p className="text-xs font-bold text-ink">What people see for {def.label}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        <Select aria-label={`Why ${def.label} is off`} value={current.reason} onValueChange={(v) => update({ reason: v as ModuleNotice["reason"] })}>
          {MODULE_NOTICE_REASONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </Select>
        <input type="date" aria-label={`${reason.dateLabel} date for ${def.label}`} value={(current.returnAt ?? "").slice(0, 10)} onChange={(e) => update({ returnAt: e.target.value })} />
      </div>
      <input type="text" maxLength={MODULE_NOTICE_MESSAGE_MAX} placeholder="Optional message, for example: We are adding more taxis" aria-label={`Message for ${def.label}`} value={current.message ?? ""} onChange={(e) => update({ message: e.target.value })} className="w-full" />
      <p className="text-xs text-ink-500">{reason.hint} Shown on every screen of this module and everything under it.</p>
    </div>
  );
}

/** How many modules sit anywhere under this one. */
function countInside(key: string): number {
  return childrenOf(key).reduce((n, c) => n + 1 + countInside(c.key), 0);
}

/** What the Live switch also reaches on the website, so staff know a switch is not only about the apps. */
function WebsiteReach({ moduleKey }: { moduleKey: string }) {
  const sections = WEBSITE_SECTIONS[moduleKey];
  if (!sections?.length) return null;
  const shown = sections.slice(0, 5).join(", ");
  return (
    <p className="mt-0.5 text-xs text-ink-500" title={sections.join(", ")}>
      Also on the website: {shown}{sections.length > 5 ? ` and ${sections.length - 5} more` : ""}.
    </p>
  );
}
