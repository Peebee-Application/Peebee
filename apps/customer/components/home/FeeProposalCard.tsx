"use client";

import type { FeeProposal, OrderRow } from "@peebee/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { isFeeProposalSeen, markFeeProposalSeen } from "../../lib/fee-proposal-seen";
import { useTranslate } from "../../lib/i18n";
import { formatUgx } from "../../lib/order-display";

/**
 * A minimal, dismissible reminder for a pending rider fee proposal — shown
 * above the wallet cards so it can't be missed, without duplicating the
 * full accept/reject card already on the order's own page (see
 * app/orders/[id]/page.tsx). Disappears the moment the customer acts here,
 * or the moment they've opened that order and seen it there — see
 * lib/fee-proposal-seen.
 */
export function FeeProposalCard() {
  const t = useTranslate();
  const [order, setOrder] = useState<OrderRow | null>(null);
  const [proposal, setProposal] = useState<FeeProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getActiveOrder()
      .then((res) => {
        if (cancelled) return;
        setOrder(res.activeOrder);
        setProposal(res.pendingFeeProposal);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!order || !proposal || dismissed || isFeeProposalSeen(proposal.id)) return null;

  async function decide(approve: boolean) {
    if (!order || !proposal) return;
    setBusy(true);
    try {
      await api.decideFeeProposal(order.id, proposal.id, approve);
      markFeeProposalSeen(proposal.id);
      setDismissed(true);
    } catch {
      setBusy(false);
    }
  }

  const currentItemsTotal = (order.final_total ?? order.estimated_total ?? 0) - (order.delivery_fee ?? 0);

  return (
    <section className="home-card space-y-2.5 !border-l-4 !border-l-gold">
      <p className="text-sm text-ink">
        {t("fee_proposal_suggests")} <strong>{formatUgx(proposal.proposed_total - currentItemsTotal)}</strong>{" "}
        <span className="text-ink-500">
          ({t("fee_proposal_was")} {formatUgx(order.delivery_fee ?? 0)})
        </span>
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(true)}
          className="flex-1 rounded-full bg-green px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
        >
          {t("accept")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => decide(false)}
          className="flex-1 rounded-full bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs font-bold text-ink disabled:opacity-60"
        >
          {t("reject")}
        </button>
        <Link
          href={`/orders/${order.id}`}
          onClick={() => markFeeProposalSeen(proposal.id)}
          className="flex items-center px-2 text-xs font-semibold text-ink-500"
        >
          {t("view")}
        </Link>
      </div>
    </section>
  );
}
