"use client";

import { Switch } from "../../../components/ui/Switch";
import {
  hasPermission,
  type PlatformEnvironment,
  type PaymentCredentialFieldStatus,
  type PaymentProviderIdentity,
  type PaymentProviderInfo,
} from "@peebee/shared";
import { AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

const ALL_PROVIDERS: PaymentProviderIdentity[] = ["yo", "flutterwave", "mtn", "airtel"];

export default function PaymentsSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");
  const [activeProviders, setActiveProviders] = useState<PaymentProviderIdentity[]>(["yo"]);
  const [paymentsDemoMode, setPaymentsDemoMode] = useState(false);
  const [directMobileMoney, setDirectMobileMoney] = useState(true);
  const [directCard, setDirectCard] = useState(false);
  const [pendingTimeout, setPendingTimeout] = useState("10");
  const [lateWatchHours, setLateWatchHours] = useState("24");
  const [verifyNumbers, setVerifyNumbers] = useState(false);
  const [platformEnvironment, setPlatformEnvironment] = useState<PlatformEnvironment>("live");
  const [providerInfo, setProviderInfo] = useState<PaymentProviderInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function refreshIntegrations() {
    return api.adminIntegrations().then((res) => setProviderInfo(res.integrations.mobileMoney.providers));
  }

  useEffect(() => {
    Promise.all([api.getSettings(), api.adminIntegrations()])
      .then(([settingsRes, integrationsRes]) => {
        setActiveProviders(settingsRes.settings.paymentsActiveProviders);
        setPaymentsDemoMode(settingsRes.settings.paymentsDemoMode);
        setDirectMobileMoney(settingsRes.settings.paymentsFlutterwaveDirectMobileMoney);
        setDirectCard(settingsRes.settings.paymentsFlutterwaveDirectCard);
        setPendingTimeout(String(settingsRes.settings.paymentsPendingTimeoutMinutes ?? 10));
        setLateWatchHours(String(settingsRes.settings.paymentsLateWatchHours ?? 24));
        setVerifyNumbers(!!settingsRes.settings.withdrawalNumbersRequireVerification);
        setPlatformEnvironment(settingsRes.settings.platformEnvironment);
        setProviderInfo(integrationsRes.integrations.mobileMoney.providers);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  function toggleProvider(provider: PaymentProviderIdentity) {
    setActiveProviders((prev) => (prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]));
  }

  function makePrimary(provider: PaymentProviderIdentity) {
    setActiveProviders((prev) => [provider, ...prev.filter((p) => p !== provider)]);
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.adminUpdateSettings({
        paymentsActiveProviders: activeProviders.length > 0 ? activeProviders : (["yo"] as PaymentProviderIdentity[]),
        paymentsDemoMode,
        paymentsFlutterwaveDirectMobileMoney: directMobileMoney,
        paymentsFlutterwaveDirectCard: directCard,
        paymentsPendingTimeoutMinutes: Math.min(1440, Math.max(0, Math.floor(Number(pendingTimeout)) || 0)),
        paymentsLateWatchHours: Math.min(168, Math.max(0, Math.floor(Number(lateWatchHours)) || 0)),
        withdrawalNumbersRequireVerification: verifyNumbers,
      });
      setActiveProviders(res.settings.paymentsActiveProviders);
      setPaymentsDemoMode(res.settings.paymentsDemoMode);
      setDirectMobileMoney(res.settings.paymentsFlutterwaveDirectMobileMoney);
      setDirectCard(res.settings.paymentsFlutterwaveDirectCard);
      setPendingTimeout(String(res.settings.paymentsPendingTimeoutMinutes ?? 10));
      setLateWatchHours(String(res.settings.paymentsLateWatchHours ?? 24));
      setVerifyNumbers(!!res.settings.withdrawalNumbersRequireVerification);
      await refreshIntegrations();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !canManagePayments) {
    return (
      <SettingsPageShell title="Payments" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage payments.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Payments" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        {platformEnvironment === "sandbox" && (
          <section className="rounded-xl border border-gold/50 bg-gold/10 p-3">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" strokeWidth={2} aria-hidden />
              <div className="min-w-0 space-y-1.5">
                <p className="text-sm font-semibold text-ink">Live payments are blocked by Sandbox platform state</p>
                <p className="text-xs text-ink-500">
                  Turning Demo mode off is not enough while the whole platform is in Sandbox. Every payment will
                  still use a simulator and no real Flutterwave checkout will open.
                </p>
                <Link href="/settings/platform" className="inline-block text-xs font-bold text-gold underline">
                  Review Platform state
                </Link>
              </div>
            </div>
          </section>
        )}
        {platformEnvironment === "live" &&
          providerInfo.some((p) => p.testMode && activeProviders.includes(p.key)) && (
            <section className="rounded-xl border border-gold/50 bg-gold/10 p-3">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-gold" strokeWidth={2} aria-hidden />
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-ink">Test keys are active on a live platform</p>
                  <p className="text-xs text-ink-500">
                    {providerInfo
                      .filter((p) => p.testMode && activeProviders.includes(p.key))
                      .map((p) => p.displayName)
                      .join(", ")}{" "}
                    is using test keys. No real money moves and customers never get a real phone prompt, so their
                    payments will sit on &quot;Waiting for payment&quot;. Save the provider&apos;s live keys, or turn
                    it off.
                  </p>
                </div>
              </div>
            </section>
          )}
        <section className="home-card space-y-3">
          <p className="text-xs text-ink-500">
            Turn on one or both aggregators. With both on, the first is used until it has no working API keys,
            then the second takes over automatically — a switch never happens mid-payment.
          </p>

          <label
            className={`flex items-start gap-2.5 rounded-xl border p-3 ${
              paymentsDemoMode ? "border-gold/40 bg-gold/5" : "border-[var(--border-faint)]"
            }`}
          >
            <Switch
              checked={paymentsDemoMode}
              onChange={(e) => setPaymentsDemoMode(e.target.checked)}
            />
            <span>
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-sm font-semibold text-ink">Demo mode</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                    paymentsDemoMode ? "bg-gold/15 text-gold" : "bg-[rgb(var(--surface-muted))] text-ink-500"
                  }`}
                >
                  {paymentsDemoMode
                    ? "On — payments simulated"
                    : platformEnvironment === "sandbox"
                      ? "Off — Sandbox still simulates"
                      : "Off — live"}
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-ink-500">
                Every payment runs through the simulator instead of a real aggregator, even if API credentials are
                saved below and an aggregator is turned on. Use this to test the app, do a demo, or pull the whole
                platform back to sandbox instantly without touching or deleting any saved credentials.
              </span>
            </span>
          </label>

          <div className="space-y-2">
            {ALL_PROVIDERS.map((provider) => {
              const info = providerInfo.find((p) => p.key === provider);
              const isActive = activeProviders.includes(provider);
              const isPrimary = isActive && activeProviders[0] === provider;
              return (
                <div key={provider} className="rounded-xl border border-[var(--border-faint)] p-3">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={isActive}
                      onChange={() => toggleProvider(provider)}
                      className="pb-check"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-semibold text-ink">{info?.displayName ?? provider}</span>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            info?.configured ? "bg-green/15 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"
                          }`}
                        >
                          {info?.configured ? "API keys set" : "No API keys yet"}
                        </span>
                        {info?.configured && info.testMode && (
                          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">
                            Test keys
                          </span>
                        )}
                        {isPrimary && (
                          <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[11px] font-semibold text-gold">
                            Primary
                          </span>
                        )}
                      </span>
                      {!info?.configured && (
                        <span className="mt-0.5 block text-xs text-ink-500">
                          Turning this on won&apos;t take effect until its secret keys are added.
                        </span>
                      )}
                      {isActive && !isPrimary && (
                        <button
                          type="button"
                          onClick={() => makePrimary(provider)}
                          className="mt-1 text-xs font-semibold text-gold"
                        >
                          Make primary
                        </button>
                      )}
                    </span>
                  </label>
                  {info && info.credentialFields.length > 0 && (
                    <CredentialFieldsForm
                      provider={provider}
                      displayName={info.displayName}
                      fields={info.credentialFields}
                      onSaved={refreshIntegrations}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="home-card space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Flutterwave checkout</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              How customers pay through Flutterwave. Each switch picks between Peebee&apos;s own in-app screen and
              Flutterwave&apos;s hosted payment page. Switching off is instant and safe: payments simply go to the
              hosted page instead.
            </p>
          </div>
          <label
            className={`flex items-start gap-2.5 rounded-xl border p-3 ${directMobileMoney ? "border-gold/40 bg-gold/5" : "border-[var(--border-faint)]"}`}
          >
            <Switch checked={directMobileMoney} onChange={(e) => setDirectMobileMoney(e.target.checked)} />
            <span>
              <span className="text-sm font-semibold text-ink">Direct mobile money</span>
              <span className="mt-0.5 block text-xs text-ink-500">
                On: the MTN / Airtel approval prompt goes straight to the customer&apos;s phone and they never leave
                the app. Off: customers pay on Flutterwave&apos;s mobile money page.
              </span>
            </span>
          </label>
          <label
            className={`flex items-start gap-2.5 rounded-xl border p-3 ${directCard ? "border-gold/40 bg-gold/5" : "border-[var(--border-faint)]"}`}
          >
            <Switch checked={directCard} onChange={(e) => setDirectCard(e.target.checked)} />
            <span>
              <span className="text-sm font-semibold text-ink">Direct card payments</span>
              <span className="mt-0.5 block text-xs text-ink-500">
                On: customers type their card into Peebee&apos;s own form. Card details pass through Peebee&apos;s
                server, so turn this on only once PCI DSS accreditation is verified, and after saving
                Flutterwave&apos;s Encryption key above. Off (default): customers pay on Flutterwave&apos;s hosted
                card page.
              </span>
              {directCard && !providerInfo.find((p) => p.key === "flutterwave")?.credentialFields.find((f) => f.key === "encryptionKey")?.set && (
                <span className="mt-1 block text-xs font-semibold text-gold">
                  No Flutterwave Encryption key saved yet — cards will keep using the hosted page until you add it.
                </span>
              )}
            </span>
          </label>
        </section>
        <section className="home-card space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Pending payments</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              If a customer&apos;s mobile money or card payment is still unconfirmed after this many minutes, Peebee
              stops waiting and marks it failed so they can try again and the order isn&apos;t held. Payouts never time
              out. 0 waits indefinitely.
            </p>
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-ink-500">Minutes before a pending payment fails</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={1440}
              value={pendingTimeout}
              onChange={(e) => setPendingTimeout(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-semibold text-ink-500">Hours to keep watching for a late approval</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={168}
              value={lateWatchHours}
              onChange={(e) => setLateWatchHours(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <span className="block text-xs text-ink-500">
              A customer can still approve the prompt after it timed out. For this long Peebee keeps asking the provider,
              and if the payment did go through, the amount is added to the customer&apos;s Peebee wallet and they are told.
              0 stops watching the moment a payment times out.
            </span>
          </label>
        </section>
        <section className="home-card space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Withdrawal numbers</h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Cash-outs by riders, car drivers and customers can only go to a mobile money number the owner has proved
              is theirs with a code texted to that number. Riders and customers verify under their saved withdrawal
              numbers. Needs the SMS provider to be set up and the number-verification database update applied; until
              then this can&apos;t be switched on.
            </p>
          </div>
          <label
            className={`flex items-start gap-2.5 rounded-xl border p-3 ${verifyNumbers ? "border-gold/40 bg-gold/5" : "border-[var(--border-faint)]"}`}
          >
            <Switch checked={verifyNumbers} onChange={(e) => setVerifyNumbers(e.target.checked)} />
            <span>
              <span className="text-sm font-semibold text-ink">Require a verified number to withdraw</span>
              <span className="mt-0.5 block text-xs text-ink-500">
                On: a withdrawal to an unverified or unsaved number is refused with a message that says how to verify it.
                Off: any saved number works, as before.
              </span>
            </span>
          </label>
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}

/**
 * Per-provider API credential inputs, saved independently of the main
 * "Save settings" button below — these hit their own endpoint immediately
 * (see api.adminSavePaymentCredentials) rather than riding along with the
 * rest of the form, since a wrong key here should fail loudly on its own,
 * not get silently bundled into an otherwise-successful settings save.
 */
function CredentialFieldsForm({
  provider,
  displayName,
  fields,
  onSaved,
}: {
  provider: PaymentProviderIdentity;
  displayName: string;
  fields: PaymentCredentialFieldStatus[];
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
      await api.adminSavePaymentCredentials(provider, nonBlank);
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
      await api.adminClearPaymentCredential(provider, field);
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
        {open ? "Hide" : "Set"} {displayName} API credentials
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
