"use client";

import { Ambulance, ArrowRight, Award, Bike, BookOpen, Briefcase, Bus, Car, ChefHat, Citrus, Clapperboard, Croissant, Crown, HardHat, ListChecks, MessagesSquare, Package, Pill, Radio, ShoppingBag, ShoppingBasket, Sparkles, Truck, Tv, UsersRound, UtensilsCrossed, WashingMachine, Wrench, type LucideIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { HOME_TEMPLATES, type HomeShortcut, type HomeTemplateId } from "./home-templates";

const ICONS: Record<HomeShortcut["icon"], LucideIcon> = {
  bike: Bike, car: Car, people: UsersRound, truck: Truck, parcel: Package, bus: Bus, crown: Crown, ambulance: Ambulance,
  list: ListChecks, basket: ShoppingBasket, store: ShoppingBag, pill: Pill, food: UtensilsCrossed, chef: ChefHat, bread: Croissant,
  juice: Citrus, clean: Sparkles, laundry: WashingMachine, fix: Wrench, worker: HardHat, hire: Briefcase, book: BookOpen,
  live: Radio, tv: Tv, award: Award, chat: MessagesSquare, spotlight: Clapperboard,
};

type RenderLink = (shortcut: HomeShortcut, children: ReactNode) => ReactNode;
function ShortcutSurface({ shortcut, renderLink, children }: { shortcut: HomeShortcut; renderLink?: RenderLink; children: ReactNode }) {
  return renderLink ? renderLink(shortcut, children) : <div className="dh-shortcut">{children}</div>;
}

/** One renderer for the customer home and inert Admin previews. Import home-artwork.css alongside it. */
export function HomeTemplateArtwork({ templateId, shortcuts, renderLink, onPointerEnter, onPointerLeave }: {
  templateId: HomeTemplateId;
  shortcuts: readonly HomeShortcut[];
  renderLink?: RenderLink;
  onPointerEnter?: ComponentProps<"section">["onPointerEnter"];
  onPointerLeave?: ComponentProps<"section">["onPointerLeave"];
}) {
  const template = HOME_TEMPLATES.find((entry) => entry.id === templateId) ?? HOME_TEMPLATES[0];
  return (<section className={`dh-art dh-${template.id}`} data-home-template={template.id} aria-label={template.name}
        onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
        <span className="dh-object" aria-hidden />
        <h2>{template.title}</h2>
        {template.id === "08" && <p className="dh-intro">Choose what you need to get started</p>}
        {template.id === "11" && <p className="dh-intro">Pick a note to begin.</p>}
        <ul className="dh-options">{shortcuts.map((shortcut, index) => {
          const Icon = ICONS[shortcut.icon];
          return <li key={shortcut.id} className="dh-option"><ShortcutSurface shortcut={shortcut} renderLink={renderLink}>
            <span className="dh-number" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
            <span className="dh-icon"><Icon strokeWidth={1.6} aria-hidden /></span>
            <span className="dh-copy"><span className="dh-label">{shortcut.label}</span><span className="dh-description">{shortcut.description}</span></span>
            <ArrowRight className="dh-arrow" size={20} aria-hidden />
          </ShortcutSurface></li>;
        })}</ul>
      </section>);
}
