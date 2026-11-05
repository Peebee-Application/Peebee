"use client";

import type { RelayMerchantOrder, RelayTrack } from "@peebee/shared";
import { ArrowLeft, ChevronDown, ChevronRight, Fuel, RotateCcw, Truck } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { RelayTimeline, formatWhen, heldAtStation } from "../../components/RelayTimeline";
import { api, errorMessage } from "../../lib/api";

const REFRESH_MS = 20_000;
const errorBox = "rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300";

export default function DeliveriesPage() {
  const [orders, setOrders] = useState<RelayMerchantOrder[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [track, setTrack] = useState<RelayTrack | null>(null);
  const [trackError, setTrackError] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const openRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOrders((await api.listMerchantRelayOrders()).orders);
      setError("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadTrack = useCallback(async (id: string) => {
    try {
      const res = await api.trackRelayOrder(id);
      if (openRef.current !== id) return;
      setTrack(res);
      setTrackError("");
    } catch (err) {
      if (openRef.current === id) setTrackError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  useEffect(() => {
    openRef.current = openId;
    setTrack(null);
    setTrackError("");
    if (!openId) return;
    void loadTrack(openId);
    const timer = window.setInterval(() => void loadTrack(openId), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [openId, loadTrack]);

  return (
    <div className="space-y-4 px-4 pb-6 pt-5">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          aria-label="Back to overview"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"
        >
          <ArrowLeft className="h-6 w-6" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-black text-ink">Deliveries</h1>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          aria-label="Refresh"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"
        >
          <RotateCcw className={`h-6 w-6 ${loading ? "animate-spin" : ""}`} />
        </button>
      </header>

      {error && <p className={errorBox}>{error}</p>}
      {orders && orders.length === 0 && <div className="home-card flex flex-col items-center gap-2 py-10 text-center"><Truck className="h-12 w-12 text-ink-500" aria-hidden /><p className="text-lg font-bold text-ink-500">No deliveries yet</p></div>}

      {orders?.map((o) => {
        const open = openId === o.id;
        const shown = open && track?.order.id === o.id ? track : null;
        return (
          <article key={o.id} className="home-card space-y-3">
            <button type="button" onClick={() => setOpenId(open ? null : o.id)} aria-expanded={open} className="flex w-full items-center gap-3 text-left">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                <Truck className="h-6 w-6" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-lg font-bold text-ink">
                  {o.customer_name ?? "Customer"}
                  {o.destination_area ? ` · ${o.destination_area}` : ""}
                </span>
                <span className="block truncate text-base text-ink-500">
                  {o.store_name} · {o.stage} · {formatWhen(o.created_at)}
                </span>
              </span>
              {open ? <ChevronDown className="h-6 w-6 shrink-0 text-ink-500" /> : <ChevronRight className="h-6 w-6 shrink-0 text-ink-500" />}
            </button>
            {open && (
              <div className="border-t border-[var(--border-faint)] pt-3">
                {trackError && <p className={errorBox}>{trackError}</p>}
                {!shown && !trackError && <p className="text-sm text-ink-500">Loading…</p>}
                {shown && (
                  <div className="space-y-3">
                    {heldAtStation(shown.relay) && (
                      <p className="flex items-center gap-2 text-sm font-semibold text-gold">
                        <Fuel className="h-4 w-4 shrink-0" aria-hidden /> Held at {shown.relay.station?.name ?? "the station"}
                      </p>
                    )}
                    <RelayTimeline track={shown} />
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
