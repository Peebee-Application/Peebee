"use client";

import { DEFAULT_SHOPPING_FEATURES, resolveShoppingFeatures, type ShoppingFeatureSettings, type ShoppingHeroSlide } from "@peebee/shared";
import { useEffect, useState } from "react";
import { Switch } from "../../../components/ui/Switch";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold";

export default function ShoppingFeaturesPage() {
  const [config, setConfig] = useState<ShoppingFeatureSettings>(DEFAULT_SHOPPING_FEATURES);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getSettings()
      .then(({ settings }) => setConfig(resolveShoppingFeatures(settings.shoppingFeatures)))
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  function change(patch: Partial<ShoppingFeatureSettings>) {
    setConfig((old) => ({ ...old, ...patch }));
    setSaved(false);
  }
  function updateSlide(index: number, patch: Partial<ShoppingHeroSlide>) {
    change({ heroSlides: config.heroSlides.map((slide, i) => i === index ? { ...slide, ...patch } : slide) });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const next = resolveShoppingFeatures(config);
      const { settings } = await api.adminUpdateSettings({ shoppingFeatures: next });
      setConfig(resolveShoppingFeatures(settings.shoppingFeatures));
      setSaved(true);
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <SettingsPageShell title="Shopping features" loading={loading}>
      <form onSubmit={save} className="space-y-5">
        <p className="text-sm text-ink-500">These stay off until you turn them on. Photo search, the member badge and in-store codes still have no live service, so customers see a coming-soon note rather than made-up results. The banner and hero only show the words you type here.</p>
        <section className="home-card space-y-3">
          <h2 className="font-bold">Photo search</h2>
          <label className="flex items-center gap-3 text-sm"><Switch checked={config.cameraSearchEnabled} onChange={(e) => change({ cameraSearchEnabled: e.target.checked })} />Let customers try searching the catalogue from a photo</label>
        </section>
        <section className="home-card space-y-3">
          <h2 className="font-bold">Member badge</h2>
          <label className="flex items-center gap-3 text-sm"><Switch checked={config.memberBadgeEnabled} onChange={(e) => change({ memberBadgeEnabled: e.target.checked })} />Show a badge once a real membership exists</label>
          <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Badge label</span><input className={field} value={config.memberBadgeLabel} maxLength={40} onChange={(e) => change({ memberBadgeLabel: e.target.value })} /></label>
        </section>
        <section className="home-card space-y-3">
          <h2 className="font-bold">In-store code</h2>
          <label className="flex items-center gap-3 text-sm"><Switch checked={config.inStoreCodeEnabled} onChange={(e) => change({ inStoreCodeEnabled: e.target.checked })} />Show the in-store code button</label>
        </section>
        <section className="home-card space-y-3">
          <h2 className="font-bold">Membership banner</h2>
          <label className="flex items-center gap-3 text-sm"><Switch checked={config.membershipBannerEnabled} onChange={(e) => change({ membershipBannerEnabled: e.target.checked })} />Show a banner</label>
          <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Title</span><input className={field} value={config.membershipBannerTitle} maxLength={80} onChange={(e) => change({ membershipBannerTitle: e.target.value })} /></label>
          <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Detail</span><input className={field} value={config.membershipBannerBody} maxLength={180} onChange={(e) => change({ membershipBannerBody: e.target.value })} /></label>
          <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Link</span><input className={field} value={config.membershipBannerHref} onChange={(e) => change({ membershipBannerHref: e.target.value })} /></label>
        </section>
        <section className="home-card space-y-3">
          <h2 className="font-bold">Featured slides</h2>
          <label className="flex items-center gap-3 text-sm"><Switch checked={config.heroEnabled} onChange={(e) => change({ heroEnabled: e.target.checked })} />Show these slides on Buy</label>
          {config.heroSlides.map((slide, index) => (
            <div key={slide.id} className="space-y-2 rounded-2xl border border-[var(--border-faint)] p-3">
              <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Title</span><input className={field} value={slide.title} maxLength={80} onChange={(e) => updateSlide(index, { title: e.target.value })} /></label>
              <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Subtitle</span><input className={field} value={slide.subtitle} maxLength={120} onChange={(e) => updateSlide(index, { subtitle: e.target.value })} /></label>
              <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Link</span><input className={field} value={slide.href} onChange={(e) => updateSlide(index, { href: e.target.value })} /></label>
              <label className="block space-y-1 text-xs font-semibold text-ink-500"><span>Image URL</span><input className={field} value={slide.imageUrl} onChange={(e) => updateSlide(index, { imageUrl: e.target.value })} /></label>
              <button type="button" className="text-sm font-bold text-ink-500" onClick={() => change({ heroSlides: config.heroSlides.filter((_, i) => i !== index) })}>Remove slide</button>
            </div>
          ))}
          {config.heroSlides.length < 6 && (
            <button type="button" className="min-h-11 text-sm font-bold text-gold" onClick={() => change({ heroSlides: [...config.heroSlides, { id: `slide-${config.heroSlides.length + 1}`, title: "", subtitle: "", href: "/shopping", imageUrl: "" }] })}>Add a slide</button>
          )}
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
