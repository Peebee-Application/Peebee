"use client";

import type { CallCredentialFieldStatus, CallProviderIdentity, CallsAdminSettings } from "@peebee/shared";
import { Phone } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";

const PROVIDER_LABELS: Record<CallProviderIdentity, string> = {
  mock: "Mock (no real audio)",
  cloudflare: "Cloudflare Realtime",
  webrtc_p2p: "Free P2P (direct WebRTC)",
  twilio: "Twilio Voice",
  agora: "Agora",
};

const PROVIDER_DESCRIPTIONS: Record<CallProviderIdentity, string> = {
  mock: "Runs the full ring/accept/decline flow with no real audio — safe default, useful for testing.",
  cloudflare: "WebRTC voice relayed through Cloudflare Realtime SFU.",
  webrtc_p2p:
    "Real audio, directly between the two phones — no relay service, no per-minute cost. Works out of the box via free public STUN; an optional TURN server below improves connection odds on restrictive mobile networks.",
  twilio: "Not wired to a real SDK yet — credentials can be saved in advance, but calls will fail until it's implemented.",
  agora: "Not wired to a real SDK yet — credentials can be saved in advance, but calls will fail until it's implemented.",
};

function CallCredentialFieldsForm({
  provider,
  displayName,
  fields,
  onSaved,
}: {
  provider: Exclude<CallProviderIdentity, "mock">;
  displayName: string;
  fields: CallCredentialFieldStatus[];
  onSaved: () => Promise<void> | void;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSave() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const nonBlank = Object.fromEntries(Object.entries(values).filter(([, v]) => v.trim().length > 0));
      await api.adminSaveCallCredentials(provider, nonBlank);
      setValues({});
      setSaved(true);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onClear(field: string) {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await api.adminClearCallCredential(provider, field);
      await onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2.5 border-t border-[var(--border-faint)] pt-2.5">
      <button type="button" onClick={() => setOpen((v) => !v)} className="text-xs font-semibold text-gold">
        {open ? "Hide" : "Set"} {displayName} credentials
      </button>
      {open && (
        <div className="mt-2 space-y-2.5">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold text-ink-500" htmlFor={`${provider}-${field.key}`}>
                  {field.label}
                  {field.required && <span className="text-gold"> *</span>}
                </label>
                {field.set && (
                  <button
                    type="button"
                    onClick={() => onClear(field.key)}
                    disabled={busy}
                    className="text-[11px] font-semibold text-ink-500 underline disabled:opacity-60"
                  >
                    Clear
                  </button>
                )}
              </div>
              <input
                id={`${provider}-${field.key}`}
                type={field.secret ? "password" : "text"}
                value={values[field.key] ?? ""}
                onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                placeholder={field.set ? "•••••••• (already set — leave blank to keep)" : field.placeholder}
                autoComplete="off"
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
              {field.helpText && <p className="text-xs text-ink-500">{field.helpText}</p>}
            </div>
          ))}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
          {saved && <p className="text-xs font-medium text-green">Saved.</p>}
          <button
            type="button"
            onClick={onSave}
            disabled={busy || Object.values(values).every((v) => !v.trim())}
            className="min-h-9 w-full rounded-full border border-gold px-4 text-xs font-bold text-gold disabled:opacity-60"
          >
            {busy ? "Saving…" : `Save ${displayName} credentials`}
          </button>
        </div>
      )}
    </div>
  );
}

/** Which voice-calling backend "call" buttons across the customer, rider,
 * and restaurant apps actually use — see apps/api/src/calls/. Switching
 * takes effect immediately for every new call; calls already in progress
 * aren't affected. */
export function CallsSettingsPanel() {
  const [settings, setSettings] = useState<CallsAdminSettings | null>(null);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api
      .adminGetCallsSettings()
      .then(setSettings)
      .catch((err) => setError(errorMessage(err)));
  };

  useEffect(load, []);

  async function switchTo(provider: CallProviderIdentity) {
    setSwitching(true);
    setError(null);
    try {
      await api.adminSetCallsProvider(provider);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSwitching(false);
    }
  }

  if (!settings) {
    return error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p> : null;
  }

  return (
    <section className="home-card space-y-3">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <Phone className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
        </span>
        <h2 className="text-sm font-semibold text-ink">Voice calls</h2>
      </div>
      <p className="text-xs text-ink-500">
        Riders, customers, and restaurants can call each other from chat. Pick which backend actually carries the
        audio — switch any time as credentials become available.
      </p>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      <div className="space-y-2.5">
        {(["mock", "cloudflare", "webrtc_p2p", "twilio", "agora"] as const).map((provider) => {
          const isActive = settings.activeProvider === provider;
          const info = provider === "mock" ? null : settings.providers[provider];
          return (
            <div key={provider} className={`rounded-xl border p-3 ${isActive ? "border-gold bg-gold/5" : "border-[var(--border-faint)]"}`}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="radio"
                  name="callsProvider"
                  checked={isActive}
                  disabled={switching}
                  onChange={() => switchTo(provider)}
                  className="mt-0.5 h-4 w-4 accent-gold"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{PROVIDER_LABELS[provider]}</span>
                    {info && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          info.configured ? "bg-green/15 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"
                        }`}
                      >
                        {info.configured ? "Configured" : "Not configured"}
                      </span>
                    )}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-500">{PROVIDER_DESCRIPTIONS[provider]}</span>
                </span>
              </label>
              {info && info.fields.length > 0 && (
                <CallCredentialFieldsForm
                  provider={provider as Exclude<CallProviderIdentity, "mock">}
                  displayName={PROVIDER_LABELS[provider]}
                  fields={info.fields}
                  onSaved={load}
                />
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
