"use client";

import { hasPermission, type PlatformEnvironment } from "@peebee/shared";
import { FlaskConical, GraduationCap } from "lucide-react";
import { useEffect, useState } from "react";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

export default function PlatformStateSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");
  const [platformEnvironment, setPlatformEnvironment] = useState<PlatformEnvironment>("live");
  const [practiceModeEnabled, setPracticeModeEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setPlatformEnvironment(settings.platformEnvironment);
        setPracticeModeEnabled(settings.practiceModeEnabled);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  if (!loading && !canManagePayments) {
    return (
      <SettingsPageShell title="Platform state" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Platform state" loading={loading}>
      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <PlatformEnvironmentToggle current={platformEnvironment} onChanged={setPlatformEnvironment} />
      <PracticeModeAvailability current={practiceModeEnabled} onChanged={setPracticeModeEnabled} />
    </SettingsPageShell>
  );
}

function PracticeModeAvailability({ current, onChanged }: { current: boolean; onChanged: (enabled: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const response = await api.adminUpdateSettings({ practiceModeEnabled: !current });
      onChanged(response.settings.practiceModeEnabled);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`home-card space-y-3 border-2 ${current ? "border-sky-400 bg-sky-50/60 dark:bg-sky-950/30" : "border-[var(--border-faint)]"}`}>
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-200">
          <GraduationCap className="h-5 w-5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">User Practice Mode</span>
          <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${current ? "bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-200" : "bg-[rgb(var(--surface-muted))] text-ink-500"}`}>
            {current ? "Available to users" : "Unavailable"}
          </span>
        </span>
      </div>
      <p className="text-xs text-ink-500">
        Lets customers, riders, restaurants and merchants practise inside their real app screens using isolated sample data.
        New or incomplete users are reminded every seven days unless they finish or choose not to be reminded again.
        Practice never creates live orders, changes balances, notifies other users or calls a payment provider.
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className="min-h-9 w-full rounded-full border border-sky-500 px-4 text-xs font-bold text-sky-700 disabled:opacity-60 dark:text-sky-200"
      >
        {busy ? "Saving…" : current ? "Disable user practice" : "Enable user practice"}
      </button>
    </section>
  );
}

/**
 * The whole-platform live/sandbox switch — deliberately its own component
 * with its own immediate save and an explicit confirmation step, since
 * this is the single most consequential toggle in the app: every customer
 * and rider sees a different dataset the instant it flips. See
 * api.adminSetPlatformEnvironment.
 */
function PlatformEnvironmentToggle({
  current,
  onChanged,
}: {
  current: PlatformEnvironment;
  onChanged: (env: PlatformEnvironment) => void;
}) {
  const [confirming, setConfirming] = useState<PlatformEnvironment | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmSwitch(target: PlatformEnvironment) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.adminSetPlatformEnvironment(target);
      onChanged(res.platformEnvironment);
      setConfirming(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const isSandbox = current === "sandbox";

  return (
    <section
      className={`home-card space-y-3 border-2 ${isSandbox ? "border-gold bg-gold/5" : "border-[var(--border-faint)]"}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${isSandbox ? "bg-gold/20 text-gold" : "bg-gold/15 text-gold"}`}
        >
          <FlaskConical className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${isSandbox ? "bg-gold text-ink-gold" : "bg-green/15 text-green"}`}
            >
              {isSandbox ? "SANDBOX — demo data" : "LIVE — real orders & money"}
            </span>
          </span>
        </span>
      </div>
      <p className="text-xs text-ink-500">
        Switches what every customer, rider, and this dashboard sees — orders, lists, and wallet balances are fully
        separate between the two. Nothing is deleted when you switch; you&apos;re just changing which dataset is
        active. Sandbox activity can never send or receive real money, even if live payment credentials are
        configured.
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {confirming ? (
        <div className="space-y-2 rounded-xl border border-gold/40 bg-gold/10 p-3">
          <p className="text-sm font-semibold text-ink">
            Switch the whole platform to {confirming === "sandbox" ? "SANDBOX" : "LIVE"}?
          </p>
          <p className="text-xs text-ink-500">
            Every customer and rider using the app right now will immediately start seeing{" "}
            {confirming === "sandbox" ? "demo" : "real"} data instead.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => confirmSwitch(confirming)}
              disabled={busy}
              className="min-h-9 flex-1 rounded-full bg-gold px-4 text-xs font-bold text-ink-gold disabled:opacity-60"
            >
              {busy ? "Switching…" : `Yes, switch to ${confirming}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(null)}
              disabled={busy}
              className="min-h-9 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-xs font-bold text-ink disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(isSandbox ? "live" : "sandbox")}
          className="min-h-9 w-full rounded-full border border-gold px-4 text-xs font-bold text-gold"
        >
          Switch to {isSandbox ? "Live" : "Sandbox"}
        </button>
      )}
    </section>
  );
}
