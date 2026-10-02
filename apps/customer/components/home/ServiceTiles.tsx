"use client";

import { Bike, Package, StickyNote, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { useTranslate, type TranslationKey } from "../../lib/i18n";

type Tile = { key: string; labelKey: TranslationKey; icon: LucideIcon; href?: string; onClick?: () => void };

/** The four things a customer can do, as a compact tile row — icon in a
 * muted square, one-word label underneath. */
export function ServiceTiles({
  onRide,
  onShopping,
  onParcel,
}: {
  onRide: () => void;
  onShopping: () => void;
  onParcel: () => void;
}) {
  const t = useTranslate();
  const tiles: Tile[] = [
    { key: "ride", labelKey: "service_ride", icon: Bike, onClick: onRide },
    { key: "food", labelKey: "service_food", icon: UtensilsCrossed, href: "/restaurants" },
    { key: "shopping", labelKey: "service_shopping", icon: StickyNote, onClick: onShopping },
    { key: "parcel", labelKey: "service_parcel", icon: Package, onClick: onParcel },
  ];
  const inner = (tile: Tile) => (
    <>
      <span className="flex h-16 w-full items-center justify-center rounded-2xl bg-[rgb(var(--surface-muted))] text-ink">
        <tile.icon className="h-7 w-7" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="text-[13px] font-semibold text-ink">{t(tile.labelKey)}</span>
    </>
  );
  const cls = "flex flex-1 flex-col items-center gap-1.5 transition-transform active:scale-95";
  return (
    <div className="flex gap-3">
      {tiles.map((tile) =>
        tile.href ? (
          <Link key={tile.key} href={tile.href} className={cls}>
            {inner(tile)}
          </Link>
        ) : (
          <button key={tile.key} type="button" onClick={tile.onClick} className={cls}>
            {inner(tile)}
          </button>
        ),
      )}
    </div>
  );
}
