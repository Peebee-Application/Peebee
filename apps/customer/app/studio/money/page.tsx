"use client";

import type { EarningsSummary, RewardsSummary } from "@peebee/shared";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Notice, Stat, TextField } from "../../../components/studio/ui";
import { useMyChannel } from "../../../components/studio/useMyChannel";
import { api, errorMessage } from "../../../lib/api";
import { timeAgo, ugx } from "../../../lib/channels";

const KIND: Record<string, string> = { membership: "Membership", pay_per_view: "Paid post", tip: "Tip", gift: "Gift", ad_share: "Ad share", reward: "Rewards cash-out", cause_release: "Cause funds" };

export default function MoneyPage() {
  const { channel, config, loading } = useMyChannel();
  const [earn, setEarn] = useState<EarningsSummary | null>(null);
  const [rewards, setRewards] = useState<RewardsSummary | null>(null);
  const [move, setMove] = useState(0);
  const [personalWalletActive, setPersonalWalletActive] = useState(false);
  const [personalWalletActivationAvailable, setPersonalWalletActivationAvailable] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const load = useCallback(() => {
    api.creatorEarnings().then(setEarn).catch((e) => setMsg({ ok: false, text: errorMessage(e) }));
    api.creatorRewards().then(setRewards).catch(() => setRewards(null));
    api.getPersonalWalletStatus().then((status) => {
      setPersonalWalletActive(status.active);
      setPersonalWalletActivationAvailable(status.activationAvailable);
    }).catch(() => undefined);
  }, []);
  useEffect(() => { if (channel) load(); }, [channel, load]);

  if (loading) return <div className="p-8 text-center text-sm text-ink-500" aria-busy="true">Loading…</div>;
  if (!channel) return <Notice tone="info">Open a channel to start earning.</Notice>;

  async function run(key: string, fn: () => Promise<string>) {
    setBusy(key);
    setMsg(null);
    try {
      setMsg({ ok: true, text: await fn() });
      load();
    } catch (err) {
      setMsg({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-extrabold text-ink">Money</h1>
      {msg && <Notice tone={msg.ok ? "ok" : "error"}>{msg.text}</Notice>}
      <Card>
        <p className="text-xs text-ink-500">Available to use</p>
        <p className="text-3xl font-extrabold text-ink">{ugx(earn?.availableUgx ?? 0)}</p>
        <p className="text-xs text-ink-500">Earned so far: {ugx(earn?.lifetimeUgx ?? 0)}</p>
        <div className="flex flex-wrap gap-2 pt-2">
          <Link href="/studio/withdraw" className="flex min-h-12 items-center rounded-full bg-gold px-6 text-sm font-bold text-ink-gold">Withdraw cash</Link>
        </div>
        <p className="text-xs text-ink-500">Cash withdrawals need a one-time ID check. Everything you earn adds up while you wait.</p>
      </Card>

      {config?.monetization?.earningsToWalletEnabled && (earn?.availableUgx ?? 0) > 0 && (
        <Card title="Spend it on Peebee" hint="Creator earnings stay in your creator balance. Move them to your personal wallet only when you choose.">
          {personalWalletActive ? <>
            <TextField id="mv-amt" label="Amount (UGX)" type="number" inputMode="numeric" value={move || ""} onChange={(v) => setMove(Number(v))} max={earn?.availableUgx} />
            <div className="flex gap-2">
              <Button variant="plain" onClick={() => setMove(earn?.availableUgx ?? 0)} className="!min-h-10 !text-xs">All of it</Button>
              <Button disabled={busy !== null || move < 1 || move > (earn?.availableUgx ?? 0)} onClick={() => run("move", async () => { const r = await api.moveEarningsToWallet(move); setMove(0); return `Moved ${ugx(r.movedUgx)} to your personal wallet.`; })} className="flex-1">{busy === "move" ? "Moving…" : "Move to personal wallet"}</Button>
            </div>
          </> : <>
            <Notice tone="info">Your creator balance is separate. Activate a personal wallet before moving earnings into it.</Notice>
            <Button disabled={busy !== null || !personalWalletActivationAvailable} onClick={() => run("activate", async () => { await api.activatePersonalWallet(); setPersonalWalletActive(true); return "Your personal Peebee wallet is active."; })} className="w-full">{busy === "activate" ? "Activating…" : "Activate personal wallet"}</Button>
          </>}
        </Card>
      )}

      {earn && earn.last30Days.length > 0 && (
        <Card title="Last 30 days">
          <div className="grid grid-cols-2 gap-2">{earn.last30Days.map((k) => <Stat key={k.kind} label={`${KIND[k.kind] ?? k.kind} (${k.count})`} value={ugx(k.netUgx)} />)}</div>
        </Card>
      )}

      {rewards?.enabled && (
        <Card title="Rewards" hint="You earn points when people watch your posts. Turn them into money whenever you like.">
          <div className="grid grid-cols-2 gap-2"><Stat label="Points" value={rewards.points.toLocaleString()} /><Stat label="Worth about" value={ugx(rewards.estimatedValueUgx)} /></div>
          <p className="text-xs text-ink-500">Right now {ugx(rewards.currentRateUgxPer1000)} for every 1,000 points. {rewards.rateBasis === "at_earn" ? "Points keep the rate they were earned at." : "Points use the rate on the day you cash out."}</p>
          {rewards.nextCashoutAt && <Notice tone="info">You can cash out again on {new Date(rewards.nextCashoutAt).toLocaleDateString()}.</Notice>}
          <Button disabled={busy !== null || rewards.points < rewards.minCashoutPoints || !!rewards.nextCashoutAt} onClick={() => run("cash", async () => { const r = await api.cashOutRewards(); return `${r.points.toLocaleString()} points became ${ugx(r.paidUgx)}${r.scalePercent < 100 ? ` (${r.scalePercent}% of full value this month)` : ""}.`; })} className="w-full">
            {busy === "cash" ? "Working…" : rewards.points < rewards.minCashoutPoints ? `Cash out at ${rewards.minCashoutPoints.toLocaleString()} points` : "Turn points into money"}
          </Button>
          {rewards.history.length > 0 && <ul className="space-y-1 text-xs text-ink-500">{rewards.history.slice(0, 5).map((h) => <li key={h.id}>{new Date(h.createdAt.replace(" ", "T") + "Z").toLocaleDateString()}: {h.points.toLocaleString()} points → {ugx(h.paidUgx)}</li>)}</ul>}
        </Card>
      )}

      {earn && earn.recent.length > 0 && (
        <Card title="Recent earnings">
          <ul className="divide-y divide-[var(--border-faint)]">
            {earn.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <span className="min-w-0"><span className="block font-semibold text-ink">{KIND[r.kind] ?? r.kind}</span><span className="block truncate text-xs text-ink-500">{r.note ?? ""} · {timeAgo(r.createdAt)} ago{r.feeUgx > 0 ? ` · Peebee's cut ${ugx(r.feeUgx)}` : ""}</span></span>
                <span className="shrink-0 font-bold text-green">+{ugx(r.netUgx)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
