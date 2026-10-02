"use client";

import type { ListDetail } from "@tuma/shared";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { useTranslate } from "../../../../lib/i18n";
import { formatUgx } from "../../../../lib/order-display";

export default function ListDetailPage() {
  const params = useParams<{ id: string }>();
  const listId = params.id;
  const [detail, setDetail] = useState<ListDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const router = useRouter();
  const t = useTranslate();

  async function resend(orderId: string) {
    setResending(true);
    setError(null);
    try {
      const { order } = await api.resendOrder(orderId);
      router.push(`/orders/${order.id}/pay`);
    } catch (err) {
      setError(errorMessage(err));
      setResending(false);
    }
  }

  useEffect(() => {
    api
      .getList(listId)
      .then(setDetail)
      .catch((err) => setError(errorMessage(err)));
  }, [listId]);

  if (error && !detail) {
    return <p className="p-4 text-sm text-red-700">{error}</p>;
  }
  if (!detail) {
    return <div className="p-4 text-sm text-ink-500">Loading list…</div>;
  }

  const { list, items } = detail;
  const hasPricing = items.some((it) => it.unit_price != null);
  const total = items.reduce((sum, it) => sum + (it.unit_price ?? 0) * it.quantity, 0);

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <header className="space-y-1">
        <h1 className="text-xl font-bold text-ink">{list.title}</h1>
        <p className={`text-sm font-semibold capitalize ${detail.resendOrderId ? "text-gold" : "text-green"}`}>
          {detail.resendOrderId ? t("list_expired") : list.status}
        </p>
      </header>

      {detail.resendOrderId && (
        <section className="home-card space-y-3 !border-l-4 !border-l-gold">
          <p className="text-sm text-ink-500">{t("list_expired_hint")}</p>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button
            type="button"
            onClick={() => void resend(detail.resendOrderId as string)}
            disabled={resending}
            className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold disabled:opacity-60"
          >
            {resending ? t("list_resending") : t("list_resend")}
          </button>
        </section>
      )}

      <section className="home-card space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-500">Items as sent</h2>
        {items.length === 0 && <p className="text-sm text-ink-500">No items on this list.</p>}
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-start justify-between gap-3 text-sm text-ink">
              <span className="min-w-0">
                <span className="block font-medium">
                  {item.quantity}× {item.name}
                </span>
                {item.unit_price != null && (
                  <span className="block text-xs text-ink-500">Est. {formatUgx(item.unit_price)} each</span>
                )}
                {item.note && <span className="block text-xs text-ink-500">{item.note}</span>}
              </span>
              {item.unit_price != null && (
                <span className="shrink-0 font-semibold">{formatUgx(item.unit_price * item.quantity)}</span>
              )}
            </li>
          ))}
        </ul>
        {hasPricing && (
          <div className="flex justify-between border-t border-[var(--border-faint)] pt-2 text-sm font-semibold">
            <span>Estimated total</span>
            <span>{formatUgx(total)}</span>
          </div>
        )}
      </section>
    </div>
  );
}
