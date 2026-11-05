"use client";

import {
  foodOrderStatus,
  type FoodSellerOrder,
  type FoodSellerOrders,
} from "@peebee/shared";
import {
  Bike,
  ChevronDown,
  ClipboardList,
  Clock,
  History,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { OpenStatusCard } from "../components/OpenStatusCard";
import { TabBar } from "../components/TabBar";
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
  const count = order.items.reduce((sum, item) => sum + item.quantity, 0);
  return (
    <article className="home-card space-y-3 !rounded-3xl !p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-xl font-extrabold">{order.customerName}</h2>
          <p className="text-base text-ink-500" title={order.id}>
            #{order.id.slice(-6).toUpperCase()} · {orderTime(order.createdAt)}
          </p>
        </div>
        <span className="max-w-[45%] shrink-0 rounded-xl bg-gold/15 px-3 py-2 text-right text-base font-bold">
          {foodOrderStatus(order.stage)}
        </span>
      </div>
      {awaiting && (
        <p className="flex items-center gap-2 rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-base text-ink-500">
          <Clock className="h-5 w-5 shrink-0" aria-hidden /> Do not prepare yet: waiting for confirmation.
        </p>
      )}
      <details open={!history && !awaiting}>
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 text-lg font-bold">
          <span>{count} item{count === 1 ? "" : "s"}</span>
          <span className="flex items-center gap-2">
            {order.itemsTotal == null ? "Pending" : money(order.itemsTotal)}
            <ChevronDown className="h-5 w-5 text-ink-500" aria-hidden />
          </span>
        </summary>
        <ul className="space-y-2 border-t border-[var(--border-faint)] pt-3">
          {order.items.map((item, index) => (
            <li key={index} className="flex items-start justify-between gap-3 text-lg">
              <span className="min-w-0 break-words">
                <strong>{item.quantity} ×</strong> {item.name}
              </span>
              <span className="shrink-0 text-base text-ink-500">
                {item.unitPrice == null ? "Pending" : money(item.quantity * item.unitPrice)}
              </span>
            </li>
          ))}
        </ul>
        {!order.items.length && <p className="text-base text-ink-500">Item details are unavailable.</p>}
      </details>
      <div className="flex items-center justify-between gap-2 border-t border-[var(--border-faint)] pt-3">
        <p className="flex min-w-0 items-center gap-2 truncate text-base text-ink-500">
          <Bike className="h-5 w-5 shrink-0" aria-hidden />
          {order.riderName ?? "No rider yet"}
        </p>
        <Link
          href={`/chat/${encodeURIComponent(order.customerId)}`}
          aria-label={`Chat with ${order.customerName}`}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"
        >
          <MessageCircle className="h-6 w-6" aria-hidden />
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
      <TabBar
        label="Orders"
        active={view}
        onChange={setView}
        tabs={[
          { id: "active", label: "Active", icon: ClipboardList, count: feed?.counts.active },
          { id: "history", label: "History", icon: History },
        ]}
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-base text-ink-500">
          {updated ? `Updated ${updated}` : "Checking orders…"}
          {feed && feed.orders.length > 50 ? " · Viewing older orders" : ""}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void load()}
          className="flex min-h-12 items-center gap-2 text-base font-bold text-gold disabled:opacity-50"
        >
          <RefreshCw size={20} className={busy ? "animate-spin" : ""} />
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
        <div className="home-card flex flex-col items-center gap-2 py-10 text-center">
          <ClipboardList size={48} className="text-ink-500" aria-hidden />
          <h2 className="text-xl font-bold text-ink-500">
            {view === "active" ? "No active orders" : "No history yet"}
          </h2>
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
          className="min-h-14 w-full rounded-full border border-gold text-lg font-bold text-gold disabled:opacity-50"
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
      <header className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-base text-ink-500">{restaurant.name}</p>
          <h1 className="text-3xl font-black leading-tight">Orders</h1>
        </div>
        <Link
          href="/payments"
          aria-label="Confirm a rider's payment"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold"
        >
          <ShieldCheck className="h-6 w-6" aria-hidden />
        </Link>
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
            className="min-h-14 shrink-0 rounded-full border border-[var(--border-faint)] px-4 text-base font-bold text-ink-500 opacity-60"
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
      <OrdersInbox key={restaurant.id} />
    </div>
  );
}
