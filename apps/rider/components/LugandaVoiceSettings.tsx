"use client";

import type { LugandaVoice, Rider } from "@tuma/shared";
import { Loader2, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";

/** Renders nothing until the admin has both turned the feature on and
 * curated at least one voice — see apps/api/src/lib/settings.ts
 * getLugandaAudioSettings. */
export function LugandaVoiceSettings({ rider, onUpdated }: { rider: Rider | null; onUpdated: (rider: Rider) => void }) {
  const [voices, setVoices] = useState<LugandaVoice[] | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => setVoices(settings.lugandaAudioEnabled ? settings.lugandaAudioVoices : []))
      .catch(() => setVoices([]));
  }, []);

  async function preview(voiceId: string) {
    setPreviewing(voiceId);
    try {
      const blob = await api.voicePreviewBlob(voiceId);
      audioRef.current?.pause();
      const audio = new Audio(URL.createObjectURL(blob));
      audio.onended = () => setPreviewing((current) => (current === voiceId ? null : current));
      audioRef.current = audio;
      await audio.play();
    } catch {
      setPreviewing(null);
    }
  }

  async function choose(voiceId: string) {
    setSaving(voiceId);
    try {
      const res = await api.updateVoicePreference(voiceId);
      onUpdated(res.rider);
    } catch {
      // Silently keep the previous selection — the button just stops spinning.
    } finally {
      setSaving(null);
    }
  }

  if (!voices || voices.length === 0) return null;

  return (
    <section id="luganda-voice" className="home-card space-y-2.5">
      <h2 className="text-sm font-semibold text-ink">Luganda voice</h2>
      <p className="text-xs text-ink-500">Hear your shopping lists read aloud in Luganda, in the voice you pick here.</p>
      <div className="space-y-2">
        {voices.map((voice) => {
          const active = rider?.preferred_lug_voice === voice.id;
          return (
            <div
              key={voice.id}
              className={`flex items-center gap-2 rounded-xl border p-2.5 ${
                active ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"
              }`}
            >
              <button
                type="button"
                onClick={() => preview(voice.id)}
                disabled={previewing === voice.id}
                aria-label={`Preview ${voice.label}`}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink-500"
              >
                {previewing === voice.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} aria-hidden />
                ) : (
                  <Play className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                )}
              </button>
              <button
                type="button"
                onClick={() => choose(voice.id)}
                disabled={saving === voice.id}
                className="flex-1 text-left text-sm font-bold text-ink disabled:opacity-60"
              >
                {voice.label}
              </button>
              {saving === voice.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-ink-500" strokeWidth={2.25} aria-hidden />}
            </div>
          );
        })}
      </div>
    </section>
  );
}
