"use client";

import { Select } from "@peebee/shared/select";

import { GEMINI_TTS_VOICES, type LugandaVoice } from "@peebee/shared";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

export default function LugandaAudioSettingsPage() {
  const [enabled, setEnabled] = useState(false);
  const [requiresPro, setRequiresPro] = useState(false);
  const [translateMode, setTranslateMode] = useState<"per_item" | "whole_list">("per_item");
  const [voices, setVoices] = useState<LugandaVoice[]>([]);
  const [defaultVoice, setDefaultVoice] = useState("");
  const [newId, setNewId] = useState<string>(GEMINI_TTS_VOICES[0]);
  const [newLabel, setNewLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setEnabled(settings.lugandaAudioEnabled);
        setRequiresPro(settings.lugandaAudioRequiresPro);
        setTranslateMode(settings.lugandaTranslateMode ?? "per_item");
        setVoices(settings.lugandaAudioVoices);
        setDefaultVoice(settings.lugandaAudioDefaultVoice);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  function addVoice() {
    const id = newId.trim();
    const label = newLabel.trim();
    if (!id || !label || voices.some((v) => v.id === id)) return;
    setVoices([...voices, { id, label }]);
    setNewLabel("");
  }

  function removeVoice(id: string) {
    setVoices(voices.filter((v) => v.id !== id));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.adminUpdateSettings({
        lugandaAudioEnabled: enabled,
        lugandaAudioRequiresPro: requiresPro,
        lugandaTranslateMode: translateMode,
        lugandaAudioVoices: voices,
        lugandaAudioDefaultVoice: defaultVoice,
      });
      setEnabled(res.settings.lugandaAudioEnabled);
      setRequiresPro(res.settings.lugandaAudioRequiresPro);
      setTranslateMode(res.settings.lugandaTranslateMode ?? "per_item");
      setVoices(res.settings.lugandaAudioVoices);
      setDefaultVoice(res.settings.lugandaAudioDefaultVoice);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingsPageShell title="Luganda list reading" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Let riders listen to their shopping lists in Luganda
          </label>
          <p className="text-xs text-ink-500">
            Uses Google AI Studio. Needs at least one key — add them (and choose test or paid mode) under Settings → Google AI keys. The GEMINI_API_KEY secret still works until you add keys there.
          </p>
          <label className="flex items-center gap-2 text-sm font-semibold text-ink">
            <input type="checkbox" checked={requiresPro} onChange={(e) => setRequiresPro(e.target.checked)} />
            Require a Pro subscription
          </label>
          <p className="text-xs text-ink-500">
            Set the Pro price under Settings → Monetization. Off by default — nothing changes until you turn this on.
          </p>
        </section>

        <section className="home-card space-y-3">
          <div>
            <h2 className="text-sm font-bold text-ink">How the list is translated</h2>
            <p className="mt-1 text-xs text-ink-500">Changes how the shopping list is turned into Luganda before it is read aloud.</p>
          </div>
          <div role="tablist" aria-label="Translation mode" className="grid grid-cols-2 gap-2">
            {([
              ["per_item", "Item by item"],
              ["whole_list", "Whole list"],
            ] as const).map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={translateMode === value}
                onClick={() => setTranslateMode(value)}
                className={`min-h-11 rounded-full text-sm font-bold ${translateMode === value ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-500">
            {translateMode === "per_item"
              ? "Each item is sent to Google as its own request. The original behaviour; uses one request per item, so a long list can use up a free key quickly."
              : "The whole list is sent to Google in one request, then read out item by item. Far fewer requests, so free daily limits last much longer. If Google's answer doesn't line up with the list, it quietly falls back to item by item."}
          </p>
        </section>

        <section className="home-card space-y-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Voice catalog</h2>
            <p className="mt-1 text-xs text-ink-500">
              Each rider picks one of these in their own account settings. Pick a Google AI Studio
              voice for each; the label is what the rider sees. Riders can preview a voice before choosing it.
            </p>
          </div>
          <div className="space-y-2">
            {voices.map((voice) => (
              <div key={voice.id} className="flex items-center gap-2 rounded-xl border border-[var(--border-faint)] p-2.5">
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink">{voice.label}</span>
                  <span className="block truncate text-xs text-ink-500">
                    {voice.id}
                    {!(GEMINI_TTS_VOICES as readonly string[]).includes(voice.id) && " — old voice id: remove it and add a Google voice"}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => removeVoice(voice.id)}
                  aria-label={`Remove ${voice.label}`}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-red-600"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={newId}
              onValueChange={(value) => setNewId(value)}
              aria-label="Google voice"
              className="rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm"
            >
              {GEMINI_TTS_VOICES.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </Select>
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Voice 2"
              className="rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold"
            />
          </div>
          <button
            type="button"
            onClick={addVoice}
            className="min-h-9 w-full rounded-full border border-[var(--border-faint)] text-xs font-bold text-ink"
          >
            Add voice
          </button>
        </section>

        <section className="home-card space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="default-voice">
            Default voice
          </label>
          <Select
            id="default-voice"
            value={defaultVoice}
            onValueChange={(value) => setDefaultVoice(value)}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm"
          >
            {voices.map((voice) => (
              <option key={voice.id} value={voice.id}>
                {voice.label}
              </option>
            ))}
          </Select>
          <p className="text-xs text-ink-500">Used for a rider who hasn&apos;t picked their own voice yet.</p>
        </section>

        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
