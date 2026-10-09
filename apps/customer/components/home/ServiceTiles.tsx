"use client";

import { Bike, Package, StickyNote, UtensilsCrossed } from "lucide-react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ServiceKey } from "@peebee/shared";
import { useTranslate, type TranslationKey } from "../../lib/i18n";

type Tile = { key: ServiceKey; labelKey: TranslationKey; icon: LucideIcon; href?: string; onClick?: () => void };

/** The four things a customer can do, as a compact tile row — icon in a
 * muted square, one-word label underneath. */
export function ServiceTiles({
  onRide,
  onShopping,
  onParcel,
  paused = {},
}: {
  onRide: () => void;
  onShopping: () => void;
  onParcel: () => void;
  /** Services an admin has switched off — shown greyed out and not tappable. */
  paused?: Partial<Record<ServiceKey, boolean>>;
}) {
  const t = useTranslate();
  const tiles: Tile[] = [
    { key: "ride", labelKey: "service_ride", icon: Bike, onClick: onRide },
    { key: "food", labelKey: "service_food", icon: UtensilsCrossed, href: "/food" },
    { key: "shopping", labelKey: "service_shopping", icon: StickyNote, onClick: onShopping },
    { key: "parcel", labelKey: "service_parcel", icon: Package, onClick: onParcel },
  ];
  const inner = (tile: Tile) => (
    <>
      <span data-service={tile.key} className={`service-glass relative z-[1] flex aspect-square w-full shrink-0 items-center justify-center rounded-2xl text-ink ${paused[tile.key] ? "opacity-40" : ""}`}>
        <tile.icon className="h-7 w-7" strokeWidth={1.75} aria-hidden />
      </span>
      <span className="relative z-[2] text-[13px] font-semibold text-ink">{t(tile.labelKey)}</span>
      {paused[tile.key] && <span className="relative z-[2] -mt-1 text-[11px] font-semibold text-ink-500">{t("service_paused")}</span>}
    </>
  );
  const cls = "service-shortcut relative isolate flex min-w-0 flex-col items-center gap-1.5 overflow-visible transition-transform active:scale-95";
  return (
    <div className="grid grid-cols-4 gap-3 overflow-visible">
      {tiles.map((tile) =>
        paused[tile.key] ? (
          <button key={tile.key} data-service={tile.key} type="button" disabled className={cls}>
            {inner(tile)}
          </button>
        ) : tile.href ? (
          <Link key={tile.key} data-service={tile.key} href={tile.href} className={cls}>
            {inner(tile)}
          </Link>
        ) : (
          <button key={tile.key} data-service={tile.key} type="button" onClick={tile.onClick} className={cls}>
            {inner(tile)}
          </button>
        ),
      )}
    </div>
  );
}
