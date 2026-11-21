"use client";

import type { ListSummary } from "@peebee/shared";
import { ChevronRight, ListChecks, ShoppingBag } from "lucide-react";
import Link from "next/link";
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

export function RecentLists({personalized=false}:{personalized?:boolean}) {
  const [lists, setLists] = useState<ListSummary[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error,setError]=useState(false);
  const [retry,setRetry]=useState(0);
  const t = useTranslate();

  useEffect(() => {
    let cancelled = false;
    api
      .getRecentLists(10)
      .then((res) => {
        if (!cancelled) {setLists(res.lists);setError(false);}
      })
      .catch(() => {
        if (!cancelled) {setLists([]);setError(true);}
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [retry]);

  if(personalized) return <section className="ph-lists"><div className="ph-section-heading"><h2>Your lists</h2><Link href="/orders">View all</Link></div>
    {!loaded?<div className="ph-skeleton ph-list-skeleton" aria-label="Loading lists"/>:error?<div className="ph-empty"><p>Your lists couldn’t load</p><button className="ph-primary" type="button" onClick={()=>{setLoaded(false);setRetry(v=>v+1);}}>Try again</button></div>:lists.length===0?<div className="ph-empty"><span className="ph-icon-chip"><ListChecks size={32} aria-hidden/></span><p>Your first list starts here</p><Link href="/shoplist" className="ph-primary">Create a list</Link></div>:<ul className="ph-list-rows">{lists.slice(0,2).map(list=><li key={list.id}><Link href={list.orderId&&!list.expired?`/orders/${list.orderId}`:`/orders/lists/${list.listId}`}><span className="ph-icon-chip"><ShoppingBag size={24} aria-hidden/></span><span><strong>{listDisplayTitle(list)}</strong><small>{list.itemCount} items</small></span><ChevronRight size={24} aria-hidden/></Link></li>)}</ul>}
  </section>;

  if (!loaded || lists.length === 0) return null;

  return (
    <section className="space-y-1">
      <SectionHeading title={t("recent_lists_title")} actionLabel={t("see_all")} actionHref="/orders" />

      <ListRows>
        {lists.map((list) => (
          <li key={list.id}>
            <ListRow
              href={list.orderId && !list.expired ? `/orders/${list.orderId}` : `/orders/lists/${list.listId}`}
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
              subtitle={list.expired ? t("list_expired_hint") : `${list.itemCount} ${t("items_count")}`}
              trailing={
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${
                    list.expired ? "bg-gold/15 text-gold" : statusClasses(list.status)
                  }`}
                >
                  {list.expired ? t("list_expired") : list.status}
                </span>
              }
            />
          </li>
        ))}
      </ListRows>
    </section>
  );
}
