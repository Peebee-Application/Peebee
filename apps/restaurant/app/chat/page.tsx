"use client";

import { observeNotificationSnapshot } from "@peebee/shared";

import type { RestaurantChatThread } from "@peebee/shared";
import { ChevronRight, MessageCircle } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useLivePolling } from "../../lib/use-live-polling";

function formatWhen(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export default function RestaurantChatThreadsPage() {
  const [threads, setThreads] = useState<RestaurantChatThread[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .myRestaurantChatThreads()
      .then((res) => {
        observeNotificationSnapshot("restaurant-inbox", res.threads.filter((t) => t.unread_count > 0).map((t) => t.customer_id + ":" + t.last_message_at));
        setThreads(res.threads);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  useLivePolling(load, 6000, [load]);

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Chat</h1>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {threads.length === 0 && !error && (
        <p className="py-10 text-center text-sm text-ink-500">No customer messages yet.</p>
      )}

      <ul className="space-y-2">
        {threads.map((t) => (
          <li key={t.customer_id}>
            <Link
              href={`/chat/${t.customer_id}`}
              className="home-card flex items-center gap-3 !rounded-2xl !px-3 !py-3"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                <MessageCircle className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{t.customer_name}</span>
                <span className="mt-0.5 block text-xs text-ink-500">{formatWhen(t.last_message_at)}</span>
              </span>
              {t.unread_count > 0 && (
                <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-bold text-ink-gold">
                  {t.unread_count}
                </span>
              )}
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-500/60" strokeWidth={1.75} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
