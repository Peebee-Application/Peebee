"use client";

import type { StageContribution } from "@peebee/shared";
import { Camera, MessageCircle, Phone } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { formatUgx } from "../../../../lib/order-display";
import { useCalls } from "../../../../lib/calls-context";

function hoursSince(iso: string): number {
  return (Date.now() - new Date(iso.replace(" ", "T") + "Z").getTime()) / 3_600_000;
}

export default function ContributePage() {
  const params = useParams<{ id: string }>();
  const stageId = params.id;
  const router = useRouter();
  const { startCall } = useCalls();
  const [shares, setShares] = useState("");
  const [sharePrice, setSharePrice] = useState(1000);
  const [method, setMethod] = useState<"cash" | "momo">("cash");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<StageContribution[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const [treasurerId, setTreasurerId] = useState<string | null>(null);
  const [escalationHours, setEscalationHours] = useState(6);

  async function loadPending() {
    const [contributions, stage, settings] = await Promise.all([
      api.getStageContributions(stageId),
      api.getStage(stageId).catch(() => null),
      api.getSettings().catch(() => null),
    ]);
    setPending(contributions.contributions.filter((c) => c.status === "pending"));
    const treasurer = stage?.members.find((m) => m.role === "treasurer");
    setTreasurerId(treasurer?.rider_id ?? null);
    if (stage?.cycle) setSharePrice(stage.cycle.share_price);
    if (settings) setEscalationHours(settings.settings.vslaUnconfirmedIntentEscalationHours);
  }

  useEffect(() => {
    loadPending().catch(() => {});
  }, [stageId]);

  const shareCount = Number(shares);
  const previewAmount = shareCount > 0 ? Math.round(shareCount * sharePrice) : 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!shareCount || shareCount <= 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.createStageContribution(stageId, { shares: shareCount, method });
      setShares("");
      if (method === "momo" && res.momoRecipientMsisdn) {
        window.location.href = `tel:*165*3*${res.momoRecipientMsisdn}*${res.amount}%23`;
      }
      await loadPending();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(id: string) {
    await api.cancelStageContribution(id).catch((err) => setError(errorMessage(err)));
    await loadPending();
  }

  function onPickProof(id: string) {
    setUploadTargetId(id);
    fileInputRef.current?.click();
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uploadTargetId) return;
    try {
      await api.uploadStageContributionProof(uploadTargetId, file);
      await loadPending();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Log a contribution</h1>

      <form onSubmit={submit} className="home-card space-y-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500" htmlFor="shares">
            Shares to save ({formatUgx(sharePrice)} per share)
          </label>
          <input
            id="shares"
            inputMode="numeric"
            value={shares}
            onChange={(e) => setShares(e.target.value.replace(/[^\d]/g, ""))}
            placeholder="e.g. 2"
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-lg font-bold text-ink outline-none focus:border-gold"
          />
          {previewAmount > 0 && <p className="text-xs font-semibold text-ink-500">= {formatUgx(previewAmount)}</p>}
        </div>
        <div className="flex gap-2">
          {(["cash", "momo"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMethod(m)}
              className={`flex-1 rounded-xl border px-3 py-2.5 text-sm font-semibold ${
                method === m ? "border-gold bg-gold/10 text-ink" : "border-[var(--border-faint)] text-ink-500"
              }`}
            >
              {m === "cash" ? "Cash" : "Mobile money"}
            </button>
          ))}
        </div>
        <p className="rounded-lg bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs text-ink-500">
          This is a record only — no money moves through the app. The cash or MoMo transfer goes straight to your
          treasurer.
        </p>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button
          type="submit"
          disabled={busy || !shares}
          className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60"
        >
          {busy ? "Saving…" : method === "momo" ? "Continue to mobile money" : "Save intent"}
        </button>
      </form>

      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChosen} />

      {pending.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-500">Waiting on your treasurer</p>
          {pending.map((c) => {
            const overdue = hoursSince(c.created_at) >= escalationHours;
            return (
              <div key={c.id} className="home-card space-y-2 !py-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-ink">
                    {formatUgx(c.amount)}
                    {c.shares != null && <span className="ml-1 font-normal text-ink-500">({c.shares} sh)</span>}
                  </span>
                  <span className="rounded-full bg-[rgb(var(--surface-muted))] px-2 py-0.5 text-xs font-semibold text-ink-500">
                    {c.method === "momo" ? "Mobile money" : "Cash"}
                  </span>
                </div>
                {overdue && (
                  <div className="space-y-1.5 rounded-lg bg-gold/10 px-2.5 py-2">
                    <span className="block text-xs font-semibold text-ink">
                      Still not confirmed after {escalationHours}h — check in with your treasurer
                    </span>
                    {treasurerId && (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => startCall({ calleeId: treasurerId })}
                          className="flex flex-1 items-center justify-center gap-1 rounded-full bg-gold px-2.5 py-1.5 text-xs font-bold text-ink-gold"
                        >
                          <Phone className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                          Call
                        </button>
                        <a
                          href={`/savings/${stageId}/chat?with=${treasurerId}`}
                          className="flex flex-1 items-center justify-center gap-1 rounded-full border border-gold/50 px-2.5 py-1.5 text-xs font-bold text-ink"
                        >
                          <MessageCircle className="h-3 w-3" strokeWidth={2.5} aria-hidden />
                          Message
                        </a>
                      </div>
                    )}
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onPickProof(c.id)}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--border-faint)] py-2 text-xs font-bold text-ink"
                  >
                    <Camera className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    {c.proof_photo_key ? "Replace proof" : "Add proof"}
                  </button>
                  <button
                    type="button"
                    onClick={() => cancel(c.id)}
                    className="rounded-full border border-[var(--border-faint)] px-3 py-2 text-xs font-bold text-ink-500"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <button type="button" onClick={() => router.back()} className="w-full py-2 text-center text-xs font-semibold text-ink-500">
        Back
      </button>
    </div>
  );
}
