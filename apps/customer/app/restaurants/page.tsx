"use client";

import type { Restaurant } from "@tuma/shared";
import { Store } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useTranslate } from "../../lib/i18n";
import { ListRow, ListRows } from "../../components/ui/ListRow";

export default function RestaurantsPage() {
  const t = useTranslate();
  const [restaurants, setRestaurants] = useState<Restaurant[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [paused, setPaused] = useState(false);

  useEffect(() => {
    api
      .listRestaurants()
      .then((res) => {
        setRestaurants(res.restaurants);
        setPaused(!!res.paused);
      })
      .catch((err) => setError(errorMessage(err)));
  }, []);

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">{t("restaurants_title")}</h1>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {paused && <p className="rounded-lg bg-gold/15 px-3 py-3 text-sm font-semibold text-ink">{t("service_paused_note", { service: t("service_food") })}</p>}

      {restaurants === null ? (
        <p className="py-10 text-center text-sm text-ink-500">{t("loading")}</p>
      ) : restaurants.length === 0 ? (
        <p className="py-10 text-center text-sm text-ink-500">{t("restaurants_none_yet")}</p>
      ) : (
        <ListRows>
          {restaurants.map((r) => (
            <li key={r.id}>
              <ListRow
                href={`/restaurants/${r.id}`}
                icon={<Store className="h-5 w-5" strokeWidth={1.75} aria-hidden />}
                title={r.name}
                subtitle={r.cuisine ?? r.description ?? undefined}
                trailing={
                  !r.is_open ? (
                    <span className="shrink-0 rounded-full bg-[rgb(var(--surface-muted))] px-2 py-0.5 text-[10px] font-semibold text-ink-500">
                      {t("restaurant_closed")}
                    </span>
                  ) : undefined
                }
              />
            </li>
          ))}
        </ListRows>
      )}
    </div>
  );
}
