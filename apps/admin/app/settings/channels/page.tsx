"use client";

import { CHANNELS_FIELDS, CHANNELS_SECTIONS, hasPermission, sanitizeChannelsConfig, type ChannelsConfig, type ChannelsField, type ChannelsSectionId } from "@peebee/shared";
import { AlertCircle, CheckCircle2, ClipboardCheck, Clapperboard } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Field, Pill, SectionHead, SwitchRow, CARD } from "../../../components/channels/ui";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

function getAt(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}
function setAt(obj: ChannelsConfig, path: string, value: unknown): ChannelsConfig {
  const next = JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
  const keys = path.split(".");
  let o = next;
  for (const k of keys.slice(0, -1)) o = o[k] as Record<string, unknown>;
  o[keys[keys.length - 1]!] = value;
  return next as ChannelsConfig;
}

function FieldControl({ field, value, disabled, onChange }: { field: ChannelsField; value: unknown; disabled: boolean; onChange: (v: unknown) => void }) {
  const id = `f-${field.path}`;
  switch (field.kind) {
    case "bool":
      return <SwitchRow title={field.label} hint={field.hint} on={value === true} disabled={disabled} onChange={onChange} />;
    case "int":
      return (
        <Field id={id} label={`${field.label}${field.unit ? ` (${field.unit})` : ""}`} hint={field.hint}>
          <input id={id} type="number" inputMode="numeric" min={field.min} max={field.max} step={field.step ?? 1} disabled={disabled} value={Number(value)} onChange={(e) => onChange(Number(e.target.value))} className="w-full text-sm text-ink outline-none" />
        </Field>
      );
    case "enum":
      return (
        <Field id={id} label={field.label} hint={field.hint}>
          <select id={id} disabled={disabled} value={String(value)} onChange={(e) => onChange(e.target.value)} className="w-full text-sm text-ink outline-none">
            {field.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
      );
    case "text":
      return (
        <Field id={id} label={field.label} hint={field.hint}>
          <input id={id} type="text" disabled={disabled} maxLength={field.maxLength} value={String(value)} onChange={(e) => onChange(e.target.value)} className="w-full text-sm text-ink outline-none" />
        </Field>
      );
    case "multi": {
      const list = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div>
          <p className="mb-2 text-xs font-bold text-ink-500">{field.label}</p>
          {field.hint && <p className="mb-2 text-[10px] text-ink-500">{field.hint}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {field.options.map((o) => {
              const on = list.includes(o.value);
              return (
                <button key={o.value} type="button" disabled={disabled} aria-pressed={on} onClick={() => onChange(on ? list.filter((v) => v !== o.value) : [...list, o.value])}
                  className="select-card text-left">
                  <span className="select-card__title text-sm text-ink">{o.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }
  }
}

export default function ChannelsSettingsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "settings.manage");
  const [config, setConfig] = useState<ChannelsConfig | null>(null);
  const [overview, setOverview] = useState<Awaited<ReturnType<typeof api.adminChannelsOverview>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [c, o] = await Promise.all([api.adminChannelsConfig(), api.adminChannelsOverview()]);
    setConfig(sanitizeChannelsConfig(c.config));
    setOverview(o);
  }, []);

  useEffect(() => {
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!config || !canManage) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await api.adminSaveChannelsConfig(config);
      setConfig(sanitizeChannelsConfig(res.config));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const stats = overview?.stats;
  const masterOn = config?.enabled === true;

  return (
    <SettingsPageShell title="Channels" description="Creator channels, the shared Spotlight, memberships, causes and rewards. Every option here can be switched at will." loading={loading}>
      {config && (
        <>
          {overview && !overview.migrationApplied && (
            <div className="flex items-center gap-3 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              <AlertCircle className="h-5 w-5 shrink-0" />
              <p>The database update for Channels has not been applied yet (0136_channels.sql, after 0135_video_and_ads.sql). Settings can be saved, but nothing works until it is.</p>
            </div>
          )}
          {stats && (
            <section className={CARD}>
              <SectionHead icon={<ClipboardCheck className="h-5 w-5" />} title="At a glance" hint="What needs attention" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {([
                  ["Channels", stats.channels, "/settings/channels/review?tab=channels"],
                  ["Posts to review", stats.postsInReview, "/settings/channels/review?tab=posts"],
                  ["Open reports", stats.openReports, "/settings/channels/review?tab=reports"],
                  ["Verifications waiting", stats.kycPending, "/settings/channels/review?tab=kyc"],
                  ["Causes waiting", stats.causesWaiting, "/settings/channels/review?tab=causes"],
                  ["Live causes", stats.liveCauses, "/settings/channels/review?tab=causes"],
                  ["Payouts pending", stats.withdrawalsPending, "/settings/channels/review?tab=payouts"],
                  ["Owed to creators", `UGX ${stats.creatorBalancesUgx.toLocaleString()}`, "/settings/channels/review?tab=payouts"],
                ] as const).map(([label, value, href]) => (
                  <Link key={label} href={href} className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3 transition active:opacity-70">
                    <p className="text-lg font-extrabold text-ink">{value}</p>
                    <p className="text-xs text-ink-500">{label}</p>
                  </Link>
                ))}
              </div>
              <Link href="/settings/channels/review" className="inline-block text-sm font-bold text-gold">Open the review queues →</Link>
            </section>
          )}

          <form onSubmit={save} className="space-y-6 pb-12">
            {error && <div className="flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300"><AlertCircle className="h-5 w-5 shrink-0" /><p>{error}</p></div>}
            {saved && <div className="flex items-center gap-3 rounded-2xl bg-green/10 p-4 text-sm font-semibold text-green"><CheckCircle2 className="h-5 w-5 shrink-0" /><p>Channels settings saved.</p></div>}

            <section className={CARD}>
              <SectionHead icon={<Clapperboard className="h-5 w-5" />} title="Channels" hint={masterOn ? "On" : "Off. Nothing below is visible to anyone until you turn this on."} />
              {CHANNELS_FIELDS.filter((f) => f.section === "master").map((f) => (
                <FieldControl key={f.path} field={f} value={getAt(config, f.path)} disabled={!canManage} onChange={(v) => setConfig((c) => (c ? setAt(c, f.path, v) : c))} />
              ))}
              <p className="text-xs text-ink-500">
                Money, verification, fundraising and rewards each have their own master switch below and start <strong>off</strong>. Turn them on only when the business holds the licences they need.
              </p>
              <div className="flex flex-wrap gap-2 text-xs">
                <Pill tone={config.monetization.enabled ? "green" : "grey"}>Memberships &amp; tips {config.monetization.enabled ? "on" : "off"}</Pill>
                <Pill tone={config.kyc.withdrawalsEnabled ? "green" : "grey"}>Withdrawals {config.kyc.withdrawalsEnabled ? "on" : "off"}</Pill>
                <Pill tone={config.causes.enabled ? "green" : "grey"}>Causes {config.causes.enabled ? "on" : "off"}</Pill>
                <Pill tone={config.rewards.enabled ? "green" : "grey"}>Rewards {config.rewards.enabled ? "on" : "off"}</Pill>
              </div>
            </section>

            {CHANNELS_SECTIONS.map((section) => (
              <section key={section.id} className={CARD}>
                <SectionHead icon={<Clapperboard className="h-5 w-5" />} title={section.label} hint={section.hint} />
                {CHANNELS_FIELDS.filter((f) => f.section === (section.id as ChannelsSectionId)).map((f) => (
                  <FieldControl key={f.path} field={f} value={getAt(config, f.path)} disabled={!canManage} onChange={(v) => setConfig((c) => (c ? setAt(c, f.path, v) : c))} />
                ))}
                {section.id === "rewards" && (
                  <Link href="/settings/channels/review?tab=rates" className="inline-block text-sm font-bold text-gold">Set the points exchange rate →</Link>
                )}
              </section>
            ))}

            {canManage && <SettingsSaveBar busy={saving} error={null} saved={saved} />}
          </form>
        </>
      )}
    </SettingsPageShell>
  );
}
