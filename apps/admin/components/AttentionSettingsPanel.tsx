"use client";
import { useEffect, useState } from "react";
import { DEFAULT_ATTENTION_SETTINGS } from "@peebee/shared";
import { api, errorMessage } from "../lib/api";
import { Switch } from "./ui/Switch";
export function AttentionSettingsPanel() {
  const [settings, setSettings] = useState(DEFAULT_ATTENTION_SETTINGS), [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { api.getAttentionSettings().then((r) => { setSettings(r.settings); setReady(true); }).catch((e) => setMessage(errorMessage(e))); }, []);
  return <section className="home-card space-y-4"><h2 className="font-bold">Order follow-up calls</h2>
    <label className="flex items-center gap-3"><Switch disabled={!ready} checked={settings.enabled} onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })} />Enable attention calls</label>
    <label className="flex items-center gap-3"><Switch disabled={!ready} checked={settings.arrivalEnabled} onChange={(e) => setSettings({ ...settings, arrivalEnabled: e.target.checked })} />Notify customer once on rider arrival</label>
    {([ ["arrivalRadiusMeters", "Arrival radius (metres)", 10, 500], ["holdDelayMilliseconds", "Hold gesture delay (milliseconds)", 100, 1000], ["maxHoldSeconds", "Maximum hold (seconds)", 1, 60], ["cooldownSeconds", "Time between calls (seconds)", 1, 120], ["pollMilliseconds", "Attention refresh (milliseconds)", 250, 2000], ["leaseMilliseconds", "Lost connection timeout (milliseconds)", 1000, 5000] ] as const).map(([key, label, min, max]) => <label key={key} className="block space-y-1 text-sm"><span>{label}</span><input disabled={!ready} type="number" min={min} max={max} value={settings[key]} onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })} className="min-h-11 w-full rounded-xl px-3" /></label>)}
    {message && <p role="status" className="text-sm">{message}</p>}
    <button type="button" disabled={!ready || busy} onClick={async () => { setBusy(true); setMessage(""); try { const r = await api.adminSetAttention(settings); setSettings(r.settings); setMessage("Follow-up settings saved."); } catch (e) { setMessage(errorMessage(e)); } finally { setBusy(false); } }} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Saving…" : "Save follow-up settings"}</button>
  </section>;
}
