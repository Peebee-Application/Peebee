"use client";

import type { ChatThread, CustomerRestaurantChatThread, SchoolChatThread } from "@peebee/shared";
import { GraduationCap, Store, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ShoppingListModal } from "../../components/home/ShoppingListModal";
import { api } from "../../lib/api";
import { useChatDrawer } from "../../lib/chat-drawer";
import { useTranslate } from "../../lib/i18n";

type Kind = "rider" | "restaurant" | "school";
type FilterKind = "all" | Kind;

type UnifiedThread = {
  kind: Kind;
  id: string;
  href: string;
  name: string;
  hasPhoto: boolean;
  preview: string;
  lastAt: string;
  unread: boolean;
};

function formatTime(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function RiderAvatar({ counterpartId, hasPhoto }: { counterpartId: string; hasPhoto: boolean }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!hasPhoto) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .riderPhotoBlob(counterpartId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [counterpartId, hasPhoto]);

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-full object-cover" />;
  }
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
      <User className="h-6 w-6" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

function SchoolAvatar() {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
      <GraduationCap className="h-6 w-6" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

function RestaurantAvatar() {
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
      <Store className="h-6 w-6" strokeWidth={1.75} aria-hidden />
    </span>
  );
}

/** The conversations list. `embedded` is for the chat drawer, which supplies its own title. */
export function ChatInbox({ embedded = false }: { embedded?: boolean }) {
  const tr = useTranslate();
  const { openThread } = useChatDrawer();
  const [riderThreads, setRiderThreads] = useState<ChatThread[] | null>(null);
  const [restaurantThreads, setRestaurantThreads] = useState<CustomerRestaurantChatThread[] | null>(null);
  const [schoolThreads, setSchoolThreads] = useState<SchoolChatThread[] | null>(null);
  const [filter, setFilter] = useState<FilterKind>("all");
  const [showNewList, setShowNewList] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getChatThreads()
      .then((res) => {
        if (!cancelled) setRiderThreads(res.threads);
      })
      .catch(() => {
        if (!cancelled) setRiderThreads([]);
      });
    api
      .getMyRestaurantChatThreads()
      .then((res) => {
        if (!cancelled) setRestaurantThreads(res.threads);
      })
      .catch(() => {
        if (!cancelled) setRestaurantThreads([]);
      });
    // School messages may be switched off or not ready yet; then there are simply none to show.
    api
      .mySchoolChats()
      .then((res) => {
        if (!cancelled) setSchoolThreads(res.threads);
      })
      .catch(() => {
        if (!cancelled) setSchoolThreads([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loaded = riderThreads !== null && restaurantThreads !== null && schoolThreads !== null;

  const threads = useMemo<UnifiedThread[]>(() => {
    const riders: UnifiedThread[] = (riderThreads ?? []).map((t) => ({
      kind: "rider",
      id: t.counterpartId,
      href: `/chat/${t.counterpartId}`,
      name: t.counterpartName,
      hasPhoto: t.counterpartHasPhoto,
      preview: t.lastMessagePreview,
      lastAt: t.lastMessageAt,
      unread: t.unread,
    }));
    const restaurants: UnifiedThread[] = (restaurantThreads ?? []).map((t) => ({
      kind: "restaurant",
      id: t.restaurantId,
      href: `/restaurants/${t.restaurantId}/chat`,
      name: t.restaurantName,
      hasPhoto: false,
      preview: t.lastMessagePreview,
      lastAt: t.lastMessageAt,
      unread: t.unread,
    }));
    const schools: UnifiedThread[] = (schoolThreads ?? []).map((t) => ({
      kind: "school",
      id: t.schoolId,
      href: `/learn/messages/${t.schoolId}`,
      name: t.schoolName,
      hasPhoto: false,
      preview: t.lastMessagePreview,
      lastAt: t.lastMessageAt,
      unread: t.unread,
    }));
    return [...riders, ...restaurants, ...schools].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
  }, [riderThreads, restaurantThreads, schoolThreads]);

  const hasRiders = (riderThreads?.length ?? 0) > 0;
  const hasRestaurants = (restaurantThreads?.length ?? 0) > 0;
  const hasSchools = (schoolThreads?.length ?? 0) > 0;
  const showFilters = [hasRiders, hasRestaurants, hasSchools].filter(Boolean).length > 1;

  const filtered = filter === "all" ? threads : threads.filter((t) => t.kind === filter);

  if (!loaded) {
    return <div className="p-4 text-sm text-ink-500">{tr("loading")}</div>;
  }

  if (threads.length === 0) {
    return (
      <div className={`flex ${embedded ? "min-h-[50dvh]" : "min-h-[70dvh]"} flex-col items-center justify-center space-y-3 p-4 text-center`}>
        {!embedded && <h1 className="text-xl font-bold text-ink">{tr("chat_title")}</h1>}
        <p className="text-sm text-ink-500">{tr("chat_no_conversations")}</p>
        <button type="button" onClick={() => setShowNewList(true)} className="text-sm font-semibold text-gold">
          {tr("chat_send_list")}
        </button>
        {showNewList && <ShoppingListModal onClose={() => setShowNewList(false)} />}
      </div>
    );
  }

  return (
    <div className={`space-y-3 px-4 pb-6 ${embedded ? "pt-2" : "pt-4"}`}>
      {!embedded && <h1 className="text-xl font-bold text-ink">{tr("chat_title")}</h1>}

      {showFilters && (
        <div className="flex gap-2">
          {(["all", "rider", "restaurant", "school"] as const).filter((f) => f === "all" || (f === "rider" ? hasRiders : f === "restaurant" ? hasRestaurants : hasSchools)).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                filter === f ? "bg-gold text-[#0A0A0A]" : "bg-[rgb(var(--surface-muted))] text-ink-500"
              }`}
            >
              {f === "all" ? tr("chat_filter_all") : f === "rider" ? tr("chat_filter_riders") : f === "restaurant" ? tr("chat_filter_restaurants") : "Schools"}
            </button>
          ))}
        </div>
      )}

      <ul className="space-y-2">
        {filtered.map((t) => (
          <li key={`${t.kind}-${t.id}`}>
            <button type="button" onClick={() => openThread(t.kind === "rider" ? { type: "rider", id: t.id } : t.kind === "school" ? { type: "school", id: t.id } : { type: "restaurant", id: t.id })} className="home-card flex w-full items-center gap-3 !rounded-2xl !px-3 !py-3 text-left">
              {t.kind === "rider" ? <RiderAvatar counterpartId={t.id} hasPhoto={t.hasPhoto} /> : t.kind === "school" ? <SchoolAvatar /> : <RestaurantAvatar />}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-bold text-ink">{t.name}</span>
                <span className="block text-[11px] font-medium text-ink-500/80">
                  {t.kind === "rider" ? tr("chat_kind_rider") : t.kind === "school" ? "School" : tr("chat_kind_restaurant")}
                </span>
                <span className={`block truncate text-xs ${t.unread ? "font-semibold text-ink" : "text-ink-500"}`}>
                  {t.preview}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <span className="text-[11px] text-ink-500">{formatTime(t.lastAt)}</span>
                {t.unread && <span className="h-2 w-2 rounded-full bg-gold" aria-hidden />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
