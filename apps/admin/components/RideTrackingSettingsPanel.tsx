"use client";
import { DEFAULT_RIDE_TRACKING_SETTINGS, type RideTrackingSettings } from "@peebee/shared";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";

export function RideTrackingSettingsPanel() {
  const [config, setConfig] = useState<RideTrackingSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => { api.getSettings().then(({ settings }) => setConfig(settings.rideTracking ?? DEFAULT_RIDE_TRACKING_SETTINGS)).catch((error) => setMessage(errorMessage(error))); }, []);
  async function save() {
    if (!config) return;
    setBusy(true); setMessage("");
    try {
      const { settings } = await api.adminUpdateSettings({ rideTracking: config });
      setConfig(settings.rideTracking ?? config); setMessage("Tracking settings saved.");
    } catch (error) { setMessage(errorMessage(error)); }
    finally { setBusy(false); }
  }
  if (!config) return <p className="text-sm text-ink-500">{message || "Loading tracking settings…"}</p>;
  return <section className="home-card space-y-4">
    <h2 className="font-semibold">Live journey tracking and estimates</h2>
    <p className="text-xs text-ink-500">Location sharing starts for assigned journeys while the rider app is open. Road estimates currently exclude live traffic.</p>
    {([ ["enabled", "Share live rider location"], ["showEstimates", "Show ride time estimates"] ] as const).map(([key, label]) => <label key={key} className="flex items-center gap-3 text-sm"><input type="checkbox" checked={config[key]} onChange={(event) => setConfig({ ...config, [key]: event.target.checked })} />{label}</label>)}
    {([ ["locationIntervalSeconds", "Location update interval (seconds)", 3, 60], ["staleAfterSeconds", "Location becomes stale after (seconds)", 15, 300], ["routeRefreshSeconds", "Route estimate refresh (seconds)", 15, 300] ] as const).map(([key, label, min, max]) => <label key={key} className="block space-y-1 text-sm"><span>{label}</span><input type="number" min={min} max={max} value={config[key]} onChange={(event) => setConfig({ ...config, [key]: Number(event.target.value) })} className="w-full rounded-xl px-3 py-2.5" /></label>)}
    {message && <p role="status" className="text-sm text-ink-500">{message}</p>}
    <button type="button" disabled={busy} onClick={() => void save()} className="min-h-11 w-full rounded-full bg-gold px-4 font-semibold text-ink-gold disabled:opacity-50">{busy ? "Saving…" : "Save tracking settings"}</button>
  </section>;
}
