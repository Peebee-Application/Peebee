"use client";

import type { StudioSchoolChatThread } from "@peebee/shared";
import { MessageSquare, UserRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState, Skeleton, cardCls } from "../../components/ui";
import { api } from "../../lib/api";

const POLL_MS = 15000;

function when(iso: string) {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toDateString() === new Date().toDateString() ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : d.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** Everyone who has written to one of the teacher's schools: learners, parents and others. */
export default function ChatPage() {
  const [threads, setThreads] = useState<StudioSchoolChatThread[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let alive = true;
    const run = () => {
      if (document.hidden) return;
      api
        .studioSchoolChats()
        .then((res) => {
          if (!alive) return;
          setThreads(res.threads);
          setUnavailable(false);
        })
        .catch(() => {
          if (!alive) return;
          setUnavailable(true);
          setThreads((t) => t ?? []);
        });
    };
    run();
    const timer = window.setInterval(run, POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <div className="space-y-4 pb-6">
      <h1 className="flex items-center gap-2 text-2xl font-black text-ink">
        <MessageSquare className="h-7 w-7 text-gold" aria-hidden /> Chat
      </h1>
      {threads === null ? (
        <Skeleton className="h-24" />
      ) : unavailable && threads.length === 0 ? (
        <EmptyState icon={MessageSquare} title="Messages aren't ready yet" body="Try again shortly." />
      ) : threads.length === 0 ? (
        <EmptyState icon={MessageSquare} title="No messages yet" body="Learners, parents and others can message your school from the Peebee app. Their messages appear here." />
      ) : (
        <ul className="space-y-2">
          {threads.map((t) => (
            <li key={`${t.schoolId}-${t.customerId}`}>
              <Link href={`/chat/${encodeURIComponent(t.schoolId)}/${encodeURIComponent(t.customerId)}`} className={`${cardCls} flex min-h-20 items-center gap-3 p-3`}>
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
                  <UserRound className="h-6 w-6" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xl font-bold text-ink">{t.customerName ?? "Someone"}</span>
                  <span className="block truncate text-base text-ink-500">{t.schoolName}</span>
                  <span className={`block truncate text-lg ${t.unread ? "font-bold text-ink" : "text-ink-500"}`}>{t.lastMessagePreview}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className="text-base text-ink-500">{when(t.lastMessageAt)}</span>
                  {t.unread && <span className="h-3 w-3 rounded-full bg-gold" aria-label="Unread" />}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
