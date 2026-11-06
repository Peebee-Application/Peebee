"use client";

import { Fold } from "../../../components/Fold";import { Switch } from "../../../components/ui/Switch";
import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { DEFAULT_HOME_MENU, HOME_CLUSTER_IDS, resolveHomeMenu, type HomeClusterId, type HomeMenuSettings } from "@peebee/shared";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold";
const CLUSTER_NOTE: Record<HomeClusterId, string> = {
  ride: "Boda, Car, Rideshare, Selfdrive, Move, Luxury, Parcel, Taxipress, Ambulance",
  shopping: "List, Groceries, Stores, Pharma, Spotlight",
  food: "Restaurants, Kitchens, Streetfood, Juices, Bakeries",
  learn: "Opens the Learn home directly",
  hive: "Clean, Laundry, Fix, Workers, Hire",
};
const SHORTCUT_NOTE = { clean: "Cleaning for homes, offices and cars", laundry: "Laundry pickup and care", fix: "Repairs and servicing", workers: "Quick odd jobs: find a worker nearby (shows only while Peebee Hire and worker search are on)", hire: "A project or longer contract (shows only while Peebee Hire is switched on)" } as const;

export default function HomeMenuSettingsPage() {
  const [menu, setMenu] = useState<HomeMenuSettings>(() => structuredClone(DEFAULT_HOME_MENU));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings().then(({ settings }) => setMenu(resolveHomeMenu(settings.homeMenu))).catch((e) => setError(errorMessage(e))).finally(() => setLoading(false));
  }, []);

  function change(next: HomeMenuSettings) { setMenu(next); setSaved(false); }
  function move(index: number, by: -1 | 1) {
    const shortcuts = [...menu.hive.shortcuts];
    const to = index + by;
    if (to < 0 || to >= shortcuts.length) return;
    [shortcuts[index], shortcuts[to]] = [shortcuts[to]!, shortcuts[index]!];
    change({ ...menu, hive: { ...menu.hive, shortcuts } });
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setSaved(false);
    try {
      const { settings } = await api.adminUpdateSettings({ homeMenu: menu });
      setMenu(resolveHomeMenu(settings.homeMenu)); setSaved(true);
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }

  return <SettingsPageShell title="Home menu" loading={loading}>
    <form onSubmit={save} className="space-y-5">
      <Fold head={<div><h2 className="font-bold">Main buttons</h2><p className="text-xs text-ink-500">The five buttons customers see along the bottom of the app. Change a name here and it updates for everyone, with no new release.</p></div>}>
        {HOME_CLUSTER_IDS.map((id) => (
          <label key={id} className="block space-y-1 text-xs font-semibold text-ink-500">
            <span>{CLUSTER_NOTE[id]}</span>
            <input required maxLength={20} value={menu.clusters[id].label} onChange={(e) => change({ ...menu, clusters: { ...menu.clusters, [id]: { label: e.target.value } } })} className={field} />
          </label>
        ))}
      </Fold>

      <Fold head={<div><h2 className="font-bold">Top bar</h2><p className="text-xs text-ink-500">The bar at the top of the customer app.</p></div>}>
        <label className="flex items-center gap-3 text-sm"><Switch checked={menu.header.chatEnabled} onChange={(e) => change({ ...menu, header: { ...menu.header, chatEnabled: e.target.checked } })} />Show the chat icon (opens conversations in a side drawer)</label>
      </Fold>

      <Fold head={<div><h2 className="font-bold">{menu.clusters.hive.label} page</h2><p className="text-xs text-ink-500">What the {menu.clusters.hive.label} button opens: Peebee-delivered services at a clear price.</p></div>}>
        <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Small heading</span><input required maxLength={60} value={menu.hive.eyebrow} onChange={(e) => change({ ...menu, hive: { ...menu.hive, eyebrow: e.target.value } })} className={field} /></label>
        <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Second name for the {menu.clusters.hive.label} button (swaps with the first; leave empty for one fixed name)</span><input maxLength={20} value={menu.hive.altLabel} onChange={(e) => change({ ...menu, hive: { ...menu.hive, altLabel: e.target.value } })} className={field} /></label>
        <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Swap every (seconds, 2 to 30)</span><input type="number" min={2} max={30} step={1} value={menu.hive.labelSeconds} onChange={(e) => change({ ...menu, hive: { ...menu.hive, labelSeconds: Math.min(30, Math.max(2, Math.round(Number(e.target.value)) || 4)) } })} className={field} /></label>
        <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Description</span><textarea required maxLength={200} rows={3} value={menu.hive.description} onChange={(e) => change({ ...menu, hive: { ...menu.hive, description: e.target.value } })} className={field} /></label>
      </Fold>

      <Fold head={<div><h2 className="font-bold">Shortcuts</h2><p className="text-xs text-ink-500">Order, name and on/off. Switched-off shortcuts disappear for customers.</p></div>}>
        {menu.hive.shortcuts.map((item, index) => (
          <div key={item.id} className="space-y-2 rounded-xl border border-[var(--border-faint)] p-3">
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-sm font-semibold"><Switch checked={item.enabled} onChange={(e) => change({ ...menu, hive: { ...menu.hive, shortcuts: menu.hive.shortcuts.map((s) => s.id === item.id ? { ...s, enabled: e.target.checked } : s) } })} />On</label>
              <div className="flex gap-1">
                <button type="button" aria-label={`Move ${item.label} up`} disabled={index === 0} onClick={() => move(index, -1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-faint)] disabled:opacity-40"><ArrowUp className="h-4 w-4" aria-hidden /></button>
                <button type="button" aria-label={`Move ${item.label} down`} disabled={index === menu.hive.shortcuts.length - 1} onClick={() => move(index, 1)} className="flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border-faint)] disabled:opacity-40"><ArrowDown className="h-4 w-4" aria-hidden /></button>
              </div>
            </div>
            <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>{SHORTCUT_NOTE[item.id]}</span><input required maxLength={20} value={item.label} onChange={(e) => change({ ...menu, hive: { ...menu.hive, shortcuts: menu.hive.shortcuts.map((s) => s.id === item.id ? { ...s, label: e.target.value } : s) } })} className={field} /></label>
          </div>
        ))}
      </Fold>

      <Fold head={<div><h2 className="font-bold">Need-a-person section</h2><p className="text-xs text-ink-500">The section under the {menu.clusters.hive.label} cards that holds the Workers and Hire shortcuts, kept apart because finding a person is different from a service Peebee delivers. It shows only while Peebee Hire is switched on.</p></div>}>
        <label className="flex items-center gap-3 text-sm"><Switch checked={menu.hive.hireBanner.enabled} onChange={(e) => change({ ...menu, hive: { ...menu.hive, hireBanner: { ...menu.hive.hireBanner, enabled: e.target.checked } } })} />Show this section</label>
        <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Title</span><input required maxLength={60} value={menu.hive.hireBanner.title} onChange={(e) => change({ ...menu, hive: { ...menu.hive, hireBanner: { ...menu.hive.hireBanner, title: e.target.value } } })} className={field} /></label>
        <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Text</span><input required maxLength={160} value={menu.hive.hireBanner.text} onChange={(e) => change({ ...menu, hive: { ...menu.hive, hireBanner: { ...menu.hive.hireBanner, text: e.target.value } } })} className={field} /></label>
      </Fold>

      <button type="button" onClick={() => change(structuredClone(DEFAULT_HOME_MENU))} className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] text-sm font-semibold">Reset to the built-in names</button>
      <SettingsSaveBar busy={busy} error={error} saved={saved} />
    </form>
  </SettingsPageShell>;
}
