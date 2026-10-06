"use client";

import {
  foodOrderStatus,
  type FoodSellerOrder,
  type FoodSellerOrders,
} from "@peebee/shared";
import {
  ClipboardList,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OpenStatusCard } from "../components/OpenStatusCard";
import { useAuth } from "../lib/auth-context";
import { api, errorMessage } from "../lib/api";

const money = (amount: number) => `UGX ${amount.toLocaleString("en-UG")}`;
function orderTime(value: string) {
  const date = new Date(
    value.includes("T") ? value : value.replace(" ", "T") + "Z",
  );
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function OrderCard({
  order,
  history,
}: {
  order: FoodSellerOrder;
  history: boolean;
}) {
  const awaiting = order.stage === "Create" || order.stage === "Match";
  return (
    <article className="rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-ink-500" title={order.id}>
            #{order.id.slice(-8).toUpperCase()}
          </p>
          <h2 className="mt-1 font-bold">{order.customerName}</h2>
        </div>
        <span className="max-w-[55%] rounded-xl bg-gold/10 px-3 py-2 text-right text-xs font-bold">
          {foodOrderStatus(order.stage)}
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-500">{orderTime(order.createdAt)}</p>
      {awaiting && (
        <p className="mt-3 rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-xs text-ink-500">
          Awaiting customer/rider confirmation. Do not prepare this order yet.
        </p>
      )}
      <details open={!history} className="mt-3">
        <summary className="min-h-11 cursor-pointer py-3 text-sm font-bold">
          Order details ·{" "}
          {order.items.reduce((sum, item) => sum + item.quantity, 0)} items
        </summary>
        <ul className="space-y-2 border-t border-[var(--border-faint)] pt-3">
          {order.items.map((item, index) => (
            <li
              key={index}
              className="flex items-start justify-between gap-3 text-sm"
            >
              <span className="min-w-0 break-words">
                <strong>{item.quantity} ×</strong> {item.name}
              </span>
              <span className="shrink-0 text-xs text-ink-500">
                {item.unitPrice == null
                  ? "Price pending"
                  : money(item.quantity * item.unitPrice)}
              </span>
            </li>
          ))}
        </ul>
        {!order.items.length && (
          <p className="text-sm text-ink-500">Item details are unavailable.</p>
        )}
        <div className="mt-3 flex justify-between border-t border-[var(--border-faint)] pt-3 text-sm font-bold">
          <span>Food total</span>
          <span>
            {order.itemsTotal == null ? "Pending" : money(order.itemsTotal)}
          </span>
        </div>
        <p className="mt-2 break-all text-[10px] text-ink-500">
          Order reference: {order.id}
        </p>
      </details>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-faint)] pt-3">
        <p className="text-xs text-ink-500">
          {order.riderName ? `Rider: ${order.riderName}` : "Rider not assigned"}
        </p>
        <Link
          href={`/chat/${encodeURIComponent(order.customerId)}`}
          className="flex min-h-11 items-center gap-2 text-xs font-bold text-gold"
        >
          <MessageCircle size={15} />
          Chat with customer
        </Link>
      </div>
    </article>
  );
}

function OrdersInbox() {
  const [view, setView] = useState<"active" | "history">("active");
  const [feed, setFeed] = useState<FoodSellerOrders | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const request = useRef(0);
  const inFlight = useRef(false);
  const latestFeed = useRef(feed);
  latestFeed.current = feed;
  const load = useCallback(
    async (cursor?: string, quiet = false) => {
      if ((cursor || quiet) && inFlight.current) return;
      const sequence = ++request.current;
      inFlight.current = true;
      if (!quiet) setBusy(true);
      try {
        const result = await api.myFoodOrders(view, cursor);
        if (sequence !== request.current) return;
        setFeed((previous) =>
          cursor && previous
            ? {
                ...result,
                orders: [
                  ...previous.orders,
                  ...result.orders.filter(
                    (order) =>
                      !previous.orders.some(
                        (existing) => existing.id === order.id,
                      ),
                  ),
                ],
              }
            : result,
        );
        setError(null);
        setUpdated(
          new Date().toLocaleTimeString(undefined, {
            hour: "numeric",
            minute: "2-digit",
          }),
        );
      } catch (err) {
        if (sequence === request.current) setError(errorMessage(err));
      } finally {
        if (sequence === request.current) {
          inFlight.current = false;
          setBusy(false);
        }
      }
    },
    [view],
  );
  useEffect(() => {
    setFeed(null);
    setUpdated(null);
    setError(null);
    void load();
    const refresh = () => {
      if (
        document.visibilityState === "visible" &&
        (!latestFeed.current || latestFeed.current.orders.length <= 50)
      )
        void load(undefined, true);
    };
    const interval =
      view === "active" ? setInterval(refresh, 30000) : undefined;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      // This ref is a request generation counter, not a captured DOM node.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      request.current++;
      inFlight.current = false;
      if (interval) clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [view, load]);
  return (
    <section className="space-y-4" aria-label="Food orders">
      <div className="flex items-center gap-2">
        {(["active", "history"] as const).map((tab) => (
          <button
            type="button"
            key={tab}
            aria-pressed={view === tab}
            onClick={() => setView(tab)}
            className={`min-h-12 flex-1 rounded-2xl border px-4 text-sm font-bold ${view === tab ? "border-gold bg-gold/15" : "border-[var(--border-faint)] text-ink-500"}`}
          >
            {tab === "active" ? "Active orders" : "History"}
            {feed ? ` · ${feed.counts[tab]}` : ""}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-ink-500">
          {updated ? `Updated ${updated}` : "Checking orders…"}
          {feed && feed.orders.length > 50 ? " · Viewing older orders" : ""}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="flex min-h-11 items-center gap-2 text-xs font-bold text-gold disabled:opacity-50"
        >
          <RefreshCw size={15} className={busy ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>
      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-[var(--border-faint)] p-3 text-sm"
        >
          Orders could not refresh. {error} Use Refresh to try again.
        </p>
      )}
      {!feed && busy && (
        <p role="status" className="py-8 text-center text-sm text-ink-500">
          Loading your orders…
        </p>
      )}
      {feed && !feed.orders.length && (
        <div className="space-y-3 rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6">
          <ClipboardList size={30} className="text-gold" />
          <h2 className="text-lg font-bold">
            {view === "active"
              ? "No active orders yet."
              : "No order history yet."}
          </h2>
          <p className="text-sm text-ink-500">
            {view === "active"
              ? "New food orders will appear here. Keep your business open when you are ready to serve."
              : "Delivered and cancelled orders will appear here."}
          </p>
          {view === "active" && (
            <Link
              href="/menu"
              className="inline-flex min-h-11 items-center text-sm font-bold text-gold"
            >
              Check your menu →
            </Link>
          )}
        </div>
      )}
      {feed?.orders.map((order) => (
        <OrderCard key={order.id} order={order} history={view === "history"} />
      ))}
      {feed?.nextCursor && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void load(feed.nextCursor ?? undefined)}
          className="min-h-12 w-full rounded-full border border-[var(--border-faint)] text-sm font-bold disabled:opacity-50"
        >
          {busy ? "Loading…" : "Load more orders"}
        </button>
      )}
    </section>
  );
}

export default function HomePage() {
  const { restaurant, restaurantReady, refreshRestaurant } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (restaurantReady && !restaurant) router.replace("/account");
  }, [restaurantReady, restaurant, router]);
  if (!restaurantReady)
    return (
      <p className="p-8 text-center text-sm text-ink-500">
        Loading your food business…
      </p>
    );
  if (!restaurant) return null;
  return (
    <div className="space-y-4 px-4 pb-8 pt-4">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-ink-500">{restaurant.name}</p>
          <h1 className="mt-1 text-2xl font-bold">Orders</h1>
        </div>
        {restaurant.status === "active" ? (
          <OpenStatusCard
            compact
            restaurant={restaurant}
            onUpdated={refreshRestaurant}
          />
        ) : (
          <button
            type="button"
            role="switch"
            aria-checked={false}
            aria-label={`${restaurant.name} accepting new orders`}
            disabled
            className="min-h-12 shrink-0 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold text-ink-500 opacity-60"
          >
            Closed
          </button>
        )}
      </header>
      {restaurant.status !== "active" ? (
        <section
          role="status"
          className="rounded-2xl border border-[var(--border-faint)] p-4"
        >
          <h2 className="text-sm font-bold">
            {restaurant.status === "pending_approval"
              ? "Awaiting admin approval"
              : "Business suspended"}
          </h2>
          <p className="mt-1 text-xs text-ink-500">
            {restaurant.status === "pending_approval"
              ? "You can prepare your menu while your business is reviewed. Customers can order after approval."
              : "New ordering is unavailable. Your existing order records remain below."}
          </p>
          <Link
            href="/menu"
            className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-gold"
          >
            Manage menu →
          </Link>
        </section>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Link
          href="/payments"
          className="flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold"
        >
          <ShieldCheck size={15} />
          Rider payment
        </Link>
        <Link
          href="/wallet"
          className="flex min-h-11 items-center gap-2 rounded-full border border-[var(--border-faint)] px-3 text-xs font-bold"
        >
          <WalletCards size={15} />
          Business balance
        </Link>
      </div>
      <OrdersInbox key={restaurant.id} />
    </div>
  );
}
