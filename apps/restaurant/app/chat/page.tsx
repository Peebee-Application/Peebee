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
      <h1 className="text-3xl font-black text-ink">Chat</h1>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {threads.length === 0 && !error && (
        <div className="home-card flex flex-col items-center gap-2 py-10 text-center"><MessageCircle className="h-12 w-12 text-ink-500" aria-hidden /><p className="text-lg font-bold text-ink-500">No messages yet</p></div>
      )}

      <ul className="space-y-2">
        {threads.map((t) => (
          <li key={t.customer_id}>
            <Link
              href={`/chat/${t.customer_id}`}
              className="home-card flex min-h-20 items-center gap-3 !rounded-2xl !px-3 !py-3"
            >
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                <MessageCircle className="h-7 w-7" strokeWidth={1.75} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xl font-bold text-ink">{t.customer_name}</span>
                <span className="mt-0.5 block text-base text-ink-500">{formatWhen(t.last_message_at)}</span>
              </span>
              {t.unread_count > 0 && (
                <span className="flex h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-gold px-2 text-base font-bold text-ink-gold">
                  {t.unread_count}
                </span>
              )}
              <ChevronRight className="h-6 w-6 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
