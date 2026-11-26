"use client";

import { hasPermission } from "@peebee/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

const FIELDS = [
  ["walletMaxAccounts", "Accounts per customer, including Main", "number"],
  ["walletSuggestedNames", "Suggested account names, comma-separated", "text"],
  ["walletTransferPerHour", "Sends per hour", "number"],
  ["walletLookupPerHour", "Name checks per hour", "number"],
  ["walletShareInvitePerHour", "Share invites per hour", "number"],
  ["walletContactsMax", "Saved contacts", "number"],
  ["walletRequestExpiryHours", "Request expiry (hours)", "number"],
  ["walletRequestMaxOpen", "Open requests at once", "number"],
  ["walletRequestLaterHours", "Later snooze (hours)", "number"],
  ["walletRequestPerHour", "Requests created per hour", "number"],
  ["walletIdempotencyHours", "How long a successful send key is kept (hours)", "number"],
] as const;

const ALERTS = [
  ["walletAlertEmail", "Email"],
  ["walletAlertSms", "SMS"],
  ["walletAlertChat", "Peebee chat"],
  ["walletAlertNotifications", "Notifications"],
  ["walletAlertPush", "Web push"],
] as const;

const SWITCHES = [
  ["providerWalletTransfersEnabled", "Provider owners may move available work-wallet funds to their activated personal wallet. Rider reserves and merchant settlement freezes still apply."],
  ["walletFreezeEnabled", "Customers can freeze an account. A freeze still blocks money going out after this is turned off, until they unfreeze."],
  ["walletSendFromShared", "A shared account can be the source of a send. Off: shared accounts are for orders only."],
  ["walletContactNicknames", "Saved contacts can have a nickname."],
  ["walletIncludeFrozenInTotal", "The home total includes the customer's own frozen accounts."],
  ["walletRequestsEnabled", "Customers can request money."],
  ["walletRequestContactsOnly", "Requests can only go to saved contacts."],
  ["walletRequestAllowCancel", "The requester can cancel an open request."],
  ["walletRequestDeclinesVisible", "The requester can see that a request was declined."],
  ["walletRequestNotify", "Highlight incoming requests in the wallet. There is no separate push service."],
] as const;

export default function CustomerWalletSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");
  const [walletUnverifiedCap, setWalletUnverifiedCap] = useState("");
  const [walletVerifiedCap, setWalletVerifiedCap] = useState("");
  const [walletMaxTopup, setWalletMaxTopup] = useState("");
  const [text, setText] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.getSettings().then(({ settings }) => {
      setWalletUnverifiedCap(String(settings.walletUnverifiedCap));
      setWalletVerifiedCap(String(settings.walletVerifiedCap));
      setWalletMaxTopup(String(settings.walletMaxTopup));
      const next: Record<string, string> = {};
      for (const [key] of FIELDS) next[key] = String(settings[key] ?? "");
      setText(next);
      const on: Record<string, boolean> = {};
      for (const [key] of SWITCHES) on[key] = Boolean(settings[key]);
      for (const [key] of ALERTS) {
        on[`${key}Sent`] = Boolean(settings[`${key}Sent` as keyof typeof settings]);
        on[`${key}Received`] = Boolean(settings[`${key}Received` as keyof typeof settings]);
      }
      setFlags(on);
    }).catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.adminUpdateSettings({
        walletUnverifiedCap: Number(walletUnverifiedCap),
        walletVerifiedCap: Number(walletVerifiedCap),
        walletMaxTopup: Number(walletMaxTopup),
        walletMaxAccounts: Number(text.walletMaxAccounts),
        walletSuggestedNames: text.walletSuggestedNames,
        walletTransferPerHour: Number(text.walletTransferPerHour),
        walletLookupPerHour: Number(text.walletLookupPerHour),
        walletShareInvitePerHour: Number(text.walletShareInvitePerHour),
        walletContactsMax: Number(text.walletContactsMax),
        walletRequestExpiryHours: Number(text.walletRequestExpiryHours),
        walletRequestMaxOpen: Number(text.walletRequestMaxOpen),
        walletRequestLaterHours: Number(text.walletRequestLaterHours),
        walletRequestPerHour: Number(text.walletRequestPerHour),
        walletIdempotencyHours: Number(text.walletIdempotencyHours),
        walletFreezeEnabled: !!flags.walletFreezeEnabled,
        providerWalletTransfersEnabled: !!flags.providerWalletTransfersEnabled,
        walletSendFromShared: !!flags.walletSendFromShared,
        walletContactNicknames: !!flags.walletContactNicknames,
        walletIncludeFrozenInTotal: !!flags.walletIncludeFrozenInTotal,
        walletRequestsEnabled: !!flags.walletRequestsEnabled,
        walletRequestContactsOnly: !!flags.walletRequestContactsOnly,
        walletRequestAllowCancel: !!flags.walletRequestAllowCancel,
        walletRequestDeclinesVisible: !!flags.walletRequestDeclinesVisible,
        walletRequestNotify: !!flags.walletRequestNotify,
        walletAlertEmailSent: !!flags.walletAlertEmailSent,
        walletAlertEmailReceived: !!flags.walletAlertEmailReceived,
        walletAlertSmsSent: !!flags.walletAlertSmsSent,
        walletAlertSmsReceived: !!flags.walletAlertSmsReceived,
        walletAlertChatSent: !!flags.walletAlertChatSent,
        walletAlertChatReceived: !!flags.walletAlertChatReceived,
        walletAlertNotificationsSent: !!flags.walletAlertNotificationsSent,
        walletAlertNotificationsReceived: !!flags.walletAlertNotificationsReceived,
        walletAlertPushSent: !!flags.walletAlertPushSent,
        walletAlertPushReceived: !!flags.walletAlertPushReceived,
      });
      setWalletUnverifiedCap(String(res.settings.walletUnverifiedCap));
      setWalletVerifiedCap(String(res.settings.walletVerifiedCap));
      setWalletMaxTopup(String(res.settings.walletMaxTopup));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !canManagePayments) {
    return (
      <SettingsPageShell title="Customer wallet limits" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Customer wallet limits" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <p className="text-xs text-ink-500">
            Closed-loop store credit. Customers top up and spend it on orders. Cash-out stays on the wallet credit page.
            Named accounts, freeze, contacts and requests are controlled here.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Field id="walletUnverified" label="Unverified cap (UGX)" value={walletUnverifiedCap} onChange={setWalletUnverifiedCap} />
            <Field id="walletVerified" label="Verified cap (UGX)" value={walletVerifiedCap} onChange={setWalletVerifiedCap} />
            <div className="col-span-2"><Field id="walletMaxTopup" label="Max amount per top-up (UGX)" value={walletMaxTopup} onChange={setWalletMaxTopup} /></div>
            {FIELDS.map(([key, label, kind]) => (
              <div key={key} className={kind === "text" ? "col-span-2" : ""}>
                <Field id={key} label={label} value={text[key] ?? ""} numeric={kind === "number"} onChange={(value) => setText((cur) => ({ ...cur, [key]: value }))} />
              </div>
            ))}
          </div>
        </section>
        <section className="home-card space-y-3">
          {SWITCHES.map(([key, label]) => (
            <label key={key} className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1" checked={!!flags[key]} onChange={(e) => setFlags((cur) => ({ ...cur, [key]: e.target.checked }))} />
              <span>{label}</span>
            </label>
          ))}
          <p className="text-xs text-ink-500">Apply migration 0161_wallet_accounts.sql by hand before freeze, contacts, requests or the duplicate-send key can be stored. Until then those actions say they are not available yet, and existing top-ups and sends keep working.</p>
        </section>
        <section className="home-card space-y-3">
          <h2 className="text-sm font-bold text-ink">Money alerts</h2>
          <p className="text-xs text-ink-500">After money moves between two people, Peebee can tell the sender and the person who received it. SMS stays off until you turn it on, because each text is charged. A failed alert never stops the transfer.</p>
          <div className="grid grid-cols-[1fr_auto_auto] items-center gap-x-4 gap-y-2 text-sm">
            <span />
            <span className="text-xs font-semibold text-ink-500">Money sent</span>
            <span className="text-xs font-semibold text-ink-500">Money received</span>
            {ALERTS.map(([key, label]) => (
              <div key={key} className="contents">
                <span>{label}</span>
                <input type="checkbox" aria-label={`${label} when money is sent`} checked={!!flags[`${key}Sent`]} onChange={(e) => setFlags((cur) => ({ ...cur, [`${key}Sent`]: e.target.checked }))} />
                <input type="checkbox" aria-label={`${label} when money is received`} checked={!!flags[`${key}Received`]} onChange={(e) => setFlags((cur) => ({ ...cur, [`${key}Received`]: e.target.checked }))} />
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-500">Apply migration 0166_wallet_alerts.sql by hand so the notifications list and the once-only send record can be stored. Until then the transfer still completes, and email, SMS, chat and push still try.</p>
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}

function Field({ id, label, value, onChange, numeric = true }: { id: string; label: string; value: string; onChange: (value: string) => void; numeric?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-ink-500" htmlFor={id}>{label}</label>
      <input id={id} value={value} onChange={(e) => onChange(numeric ? e.target.value.replace(/[^\d]/g, "") : e.target.value)} className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold" />
    </div>
  );
}
