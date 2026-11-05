"use client";

import { useState } from "react";
import { HOME_SHORTCUTS, HOME_TEMPLATES, pickHomeShortcuts, type HomeShortcutId, type HomeTemplateId, type HomeTemplatesSettings } from "@peebee/shared";
import { HomeTemplateArtwork } from "@peebee/shared/home-artwork";
import "@peebee/shared/home-artwork.css";

/** Sample content only: no customer authentication, navigation or live orders in Admin. */
export function HomeTemplatePreview({ templateId, config }: { templateId: HomeTemplateId; config: HomeTemplatesSettings }) {
  const [sampleIds, setSampleIds] = useState<HomeShortcutId[]>([]);
  const template = HOME_TEMPLATES.find((t) => t.id === templateId)!;
  const eligible = HOME_SHORTCUTS.filter((s) => config.eligibleShortcuts.includes(s.id));
  const ids = [...new Set([...sampleIds, ...config.preferredShortcuts, ...config.eligibleShortcuts])];
  const shortcuts = ids.flatMap((id) => { const s = eligible.find((entry) => entry.id === id); return s ? [s] : []; }).slice(0, config.shortcutCount);
  return <div id="home-template-preview" tabIndex={-1} aria-label={`${template.name} preview`} className="min-w-0 scroll-mt-20 space-y-3 xl:sticky xl:top-24">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold" aria-live="polite">Preview · {templateId} · {template.name}</h3>
      <button type="button" className="min-h-11 rounded-xl border border-[var(--border-faint)] px-3 text-sm font-semibold" onClick={() => setSampleIds(pickHomeShortcuts(eligible, config).map((s) => s.id))}>Shuffle sample shortcuts</button>
    </div>
    <p className="text-xs text-ink-500">{config.templates.includes(templateId) ? "Selected as active" : "Inactive — preview only"}{!config.enabled ? ". Dynamic home is off." : "."} Sample content from your eligible list; customer availability rules still apply.</p>
    <div className="dh mx-auto w-full max-w-[390px] rounded-[28px] border border-[var(--border-faint)] bg-cream p-4">
      <div className="dh-greeting mb-5"><h1 className="text-2xl font-bold tracking-tight">Hello, Sarah</h1><p className="mt-1 text-sm text-ink-500">A little help for your day</p></div>
      <HomeTemplateArtwork templateId={templateId} shortcuts={shortcuts} />
    </div>
    <p className="text-xs text-ink-500">Home content preview. The customer’s existing header and bottom navigation stay unchanged. Previewing and shuffling do not save settings.</p>
  </div>;
}
