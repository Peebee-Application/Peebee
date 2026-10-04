"use client";

import type { EmailKeySettings, EmailKeysOverview } from "@tuma/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";

const field = "w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-sm outline-none focus:border-gold";
const button = "min-h-10 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold text-ink disabled:opacity-50";
const defaults: EmailKeySettings = { mode: "live", rotationSeconds: 300, windowRequests: 0, windowSeconds: 86400, quotaRetrySeconds: 3600 };
const when = (value: string | null) => value ? new Date(value).toLocaleString() : "—";

export default function EmailKeysPage() {
  const [data, setData] = useState<EmailKeysOverview | null>(null);
  const [settings, setSettings] = useState<EmailKeySettings>(defaults);
  const [label, setLabel] = useState("");
  const [key, setKey] = useState("");
  const [accountTag, setAccountTag] = useState("default");
  const [fromAddress, setFromAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let stopped = false;
    api.adminEmailKeys().then((result) => {
      if (stopped) return;
      setData(result);
      setSettings(result);
    }).catch((err) => { if (!stopped) setError(errorMessage(err)); })
      .finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; };
  }, []);

  async function run<T extends EmailKeysOverview>(action: () => Promise<T>, after?: (result: T) => void) {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const result = await action();
      setData(result);
      after?.(result);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const ready = data?.tableReady && data.encryptionConfigured;
  const active = data?.keys.find((k) => k.id === data.activeKeyId);

  return (
    <SettingsPageShell title="Email API keys" loading={loading}>
      {error && <p role="alert" className="rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-sm text-ink">{error}</p>}
      {note && <p role="status" className="text-sm text-ink">{note}</p>}
      {data && <div className="space-y-5">
        {!ready && <p className="rounded-xl bg-gold/15 p-3 text-sm text-ink">Key management setup is pending. Contact your operator to enable encrypted key storage.</p>}
        <section className="home-card space-y-3">
          <h2 className="font-bold text-ink">Live or testing</h2>
          <p className="text-xs text-ink-500">Email API mode is separate from the platform&apos;s live/sandbox setting. Both modes send real emails; charges and quotas follow the Resend account.</p>
          <div role="tablist" aria-label="Email API mode" className="grid grid-cols-2 gap-2">
            {(["live", "test"] as const).map((mode) => <button key={mode} type="button" role="tab" aria-selected={settings.mode === mode} disabled={busy || !ready}
              onClick={() => setSettings({ ...settings, mode })}
              className={`min-h-11 rounded-full text-sm font-bold ${settings.mode === mode ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`}>
              {mode === "live" ? "Live" : "Testing"}
            </button>)}
          </div>
          <p className="text-sm text-ink">Active: {data.mode === "live" ? "Live" : "Testing"} · {active?.label ?? (data.mode === "live" && data.envKeyPresent && !data.keys.some((k) => k.isLive) ? "Existing server key" : "No key ready")}</p>
          {data.nextRotationAt && <p className="text-xs text-ink-500">Next scheduled switch: {when(data.nextRotationAt)}. The next request uses the scheduled key, skipping paused keys.</p>}
          <label className="block text-xs font-bold text-ink">Rotate testing keys every (seconds)
            <input type="number" min={1} max={86400} step={1} value={settings.rotationSeconds} onChange={(e) => setSettings({ ...settings, rotationSeconds: Number(e.target.value) })} className={`${field} mt-1`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-xs font-bold text-ink">Testing requests per account window
              <input type="number" min={0} max={1000000} step={1} value={settings.windowRequests} onChange={(e) => setSettings({ ...settings, windowRequests: Number(e.target.value) })} className={`${field} mt-1`} />
            </label>
            <label className="block text-xs font-bold text-ink">Budget window (seconds)
              <input type="number" min={1} max={2678400} step={1} value={settings.windowSeconds} onChange={(e) => setSettings({ ...settings, windowSeconds: Number(e.target.value) })} className={`${field} mt-1`} />
            </label>
          </div>
          <p className="text-xs text-ink-500">Set requests to 0 for no local budget. Attempts share the account&apos;s budget, including failed attempts. Windows align to UTC and include requests made here in live mode; activity outside this app is not counted.</p>
          <label className="block text-xs font-bold text-ink">Retry an unknown or monthly quota after (seconds)
            <input type="number" min={1} max={2678400} step={1} value={settings.quotaRetrySeconds} onChange={(e) => setSettings({ ...settings, quotaRetrySeconds: Number(e.target.value) })} className={`${field} mt-1`} />
          </label>
          <p className="text-xs text-ink-500">Resend&apos;s retry time takes priority. Daily quota resumes at midnight UTC. Live mode uses one selected key and never rotates.</p>
          <button type="button" disabled={busy || !ready} onClick={() => void run(() => api.adminSetEmailKeySettings(settings), (result) => { setSettings(result); setNote("Email API settings saved."); })} className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Saving…" : "Save mode and rotation"}</button>
        </section>

        <section className="home-card space-y-3">
          <h2 className="font-bold text-ink">Add a Resend key</h2>
          <p className="text-xs text-ink-500">New keys join the testing pool. Choose one as the live key below. Keys are stored encrypted and only their last four characters can be shown.</p>
          <label className="block text-xs font-bold text-ink">Key name<input value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} className={`${field} mt-1`} placeholder="Email testing 1" /></label>
          <label className="block text-xs font-bold text-ink">API key<input type="password" value={key} onChange={(e) => setKey(e.target.value)} maxLength={200} spellCheck={false} autoComplete="new-password" className={`${field} mt-1`} placeholder="re_…" /></label>
          <label className="block text-xs font-bold text-ink">Resend account or team name<input value={accountTag} maxLength={60} onChange={(e) => setAccountTag(e.target.value)} className={`${field} mt-1`} /></label>
          <p className="text-xs text-ink-500">Use the same account name for every key in one Resend team. Those keys share rate limits, quotas and cooldowns; adding a key does not add quota.</p>
          <label className="block text-xs font-bold text-ink">Verified sender<input value={fromAddress} maxLength={254} onChange={(e) => setFromAddress(e.target.value)} className={`${field} mt-1`} placeholder="Peebee <hello@yourdomain.com>" /></label>
          <p className="text-xs text-ink-500">Use a sender verified for this key&apos;s account. The key and sender are checked by Resend when an email is sent.</p>
          <button type="button" disabled={busy || !ready || !key.trim() || !label.trim() || !accountTag.trim() || !fromAddress.trim()} onClick={() => void run(() => api.adminAddEmailKeys([{ label, key, accountTag, fromAddress }]), (result) => { setKey(""); setNote(result.results[0]?.status === "duplicate" ? "This key is already saved." : "Key added to the testing pool."); })} className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Saving…" : "Add key"}</button>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between"><h2 className="font-bold text-ink">Saved keys ({data.keys.length})</h2><button type="button" disabled={busy} onClick={() => void run(() => api.adminEmailKeys())} className={button}>Refresh status</button></div>
          {data.keys.length === 0 && <p className="text-sm text-ink-500">No keys added yet. {data.envKeyPresent ? "Live mode uses the existing server key." : "Add a key to get started."}</p>}
          {data.keys.map((k) => <div key={k.id} className="home-card space-y-2">
            <p className="font-bold text-ink">{k.label} <span className="font-normal text-ink-500">{k.hint}</span> · {k.isLive ? "Live key" : "Testing key"}{k.id === data.activeKeyId ? " · Active" : ""}</p>
            <p className="text-xs text-ink-500">Account: {k.accountTag} · Sender: {k.fromAddress}</p>
            <p className="text-xs text-ink-500">{k.status === "ready" ? "Ready" : k.status === "disabled" ? "Off" : `${k.cooldownReason} · resumes ${when(k.cooldownUntil)}`}</p>
            <p className="text-xs text-ink-500">Sent: {k.useCount} · Failed: {k.failCount} · Account window: {k.windowUsed}{data.windowRequests > 0 ? ` / ${data.windowRequests}` : ""} attempts · Last sent: {when(k.lastUsedAt)}</p>
            {k.lastError && <p className="text-xs text-ink-500">{k.lastError}</p>}
            <div className="flex flex-wrap gap-2">
              {!k.isLive && <button type="button" disabled={busy || !k.enabled} onClick={() => void run(() => api.adminSetLiveEmailKey(k.id))} className={button}>Use for live</button>}
              <button type="button" disabled={busy || (k.isLive && data.mode === "live")} onClick={() => void run(() => api.adminEnableEmailKey(k.id, !k.enabled))} className={button}>{k.enabled ? "Turn off" : "Turn on"}</button>
              <button type="button" disabled={busy || (k.isLive && data.mode === "live")} onClick={() => { if (window.confirm(`Remove ${k.label}?`)) void run(() => api.adminDeleteEmailKey(k.id)); }} className={button}>Remove</button>
            </div>
          </div>)}
        </section>
      </div>}
    </SettingsPageShell>
  );
}
