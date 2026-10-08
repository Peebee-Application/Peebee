"use client";

import type { ChatThreadDetail } from "@peebee/shared";
import { ArrowLeft, Phone, User } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { OrderChat } from "../../../components/OrderChat";
import { api } from "../../../lib/api";
import { useCalls } from "../../../lib/calls-context";

export default function ChatThreadPage() {
  const params = useParams<{ counterpartId: string }>();
  const counterpartId = params.counterpartId;
  const router = useRouter();
  const [thread, setThread] = useState<ChatThreadDetail | null | undefined>(undefined);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const { startCall } = useCalls();

  useEffect(() => {
    api
      .getChatThread(counterpartId)
      .then(setThread)
      .catch(() => setThread(null));
  }, [counterpartId]);

  useEffect(() => {
    if (!thread?.counterpartHasPhoto) {
      setPhotoUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .riderPhotoBlob(counterpartId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [counterpartId, thread?.counterpartHasPhoto]);

  if (thread === undefined) {
    return <div className="flex min-h-dvh items-center justify-center bg-cream text-sm text-ink-500">Loading…</div>;
  }

  if (!thread) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-cream p-4 text-center">
        <p className="text-sm text-ink-500">Couldn&apos;t load this conversation.</p>
        <button type="button" onClick={() => router.push("/chat")} className="text-sm font-semibold text-gold">
          Back to chats
        </button>
      </div>
    );
  }

  return (
    // Fixed to the true viewport edges rather than a dvh/JS height calc —
    // those drift from the real visible viewport on some mobile browsers
    // (address-bar show/hide, embedded WebViews), which let the page
    // itself scroll and dragged this "sticky" header/composer away with
    // it. `fixed` can't be scrolled away by an ancestor no matter what.
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-cream pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-hidden">
        <header className="peebee-chat-chrome flex shrink-0 items-center gap-3 border-b border-[var(--border-faint)] glass-panel px-3 py-2.5">
          <button
            type="button"
            onClick={() => router.push("/chat")}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
          </button>
          {/* The rider's own order detail is the closest thing to "their
              profile" from a customer's side — name, rating, delivery info. */}
          <Link href={`/orders/${thread.orderId}`} className="flex min-w-0 flex-1 items-center gap-3">
            {photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={photoUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gold text-sm font-bold text-[#0A0A0A]">
                <User className="h-5 w-5" strokeWidth={2} aria-hidden />
              </span>
            )}
            <h1 className="min-w-0 flex-1 truncate text-base font-bold text-ink">{thread.counterpartName}</h1>
          </Link>
          <button
            type="button"
            onClick={() => startCall({ calleeId: counterpartId, orderId: thread.orderId })}
            className="flex h-9 w-9 shrink-0 items-center justify-center text-green"
            aria-label="Call"
          >
            <Phone className="h-4.5 w-4.5" fill="currentColor" strokeWidth={2} aria-hidden />
          </button>
        </header>
        <OrderChat orderId={thread.orderId} variant="full" />
      </div>
    </div>
  );
}
