"use client";

import type { ListSummary } from "@tuma/shared";
import { ShoppingBag } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { ListRow, ListRows } from "../ui/ListRow";
import { SectionHeading } from "../ui/SectionHeading";

function statusClasses(status: string) {
  if (status === "delivered") return "bg-green/15 text-green";
  return "bg-[rgb(var(--surface-muted))] text-ink-500";
}

function listDisplayTitle(list: ListSummary): string {
  if (!list.riderFirstName) return list.title;
  return list.area ? `${list.riderFirstName} · ${list.area}` : `${list.riderFirstName}'s delivery`;
}

/** Once a rider's taken the order, their face replaces the generic bag icon — who delivered it, at a glance. */
function RiderAvatar({ riderId }: { riderId: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .riderPhotoBlob(riderId)
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
  }, [riderId]);

  if (!url) {
    return (
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--surface-muted))] text-ink">
        <ShoppingBag className="h-5 w-5" strokeWidth={1.75} aria-hidden />
      </span>
    );
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt="" className="h-12 w-12 shrink-0 rounded-xl object-cover" />;
}

export function RecentLists() {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const t = useTranslate();

  useEffect(() => {
    let cancelled = false;
    api
      .getRecentLists(10)
      .then((res) => {
        if (!cancelled) setLists(res.lists);
      })
      .catch(() => {
        if (!cancelled) setLists([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || lists.length === 0) return null;

  return (
    <section className="space-y-1">
      <SectionHeading title={t("recent_lists_title")} actionLabel={t("see_all")} actionHref="/orders" />

      <ListRows>
        {lists.map((list) => (
          <li key={list.id}>
            <ListRow
              href={list.orderId ? `/orders/${list.orderId}` : `/orders/lists/${list.listId}`}
              leading={
                list.riderId && list.riderHasPhoto ? (
                  <RiderAvatar riderId={list.riderId} />
                ) : (
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--surface-muted))] text-ink">
                    <ShoppingBag className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                  </span>
                )
              }
              title={listDisplayTitle(list)}
              subtitle={`${list.itemCount} ${t("items_count")}`}
              trailing={
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${statusClasses(list.status)}`}>
                  {list.status}
                </span>
              }
            />
          </li>
        ))}
      </ListRows>
    </section>
  );
}
