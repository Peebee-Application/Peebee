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
export function HomeTemplateArtwork({ templateId, shortcuts, renderLink, footer, onPointerEnter, onPointerLeave }: {
  templateId: HomeTemplateId;
  shortcuts: readonly HomeShortcut[];
  renderLink?: RenderLink;
  footer?: ReactNode;
  onPointerEnter?: ComponentProps<"section">["onPointerEnter"];
  onPointerLeave?: ComponentProps<"section">["onPointerLeave"];
}) {
  const template = HOME_TEMPLATES.find((entry) => entry.id === templateId) ?? HOME_TEMPLATES[0];
  const titles: Partial<Record<HomeTemplateId, ReactNode>> = {
    "04": <>A little help.<br />A better<br />day.</>,
    "08": <>Your day.<br />Connected.</>,
    "09": <>Make room<br />for your day.</>,
    "12": <>A simpler<br />kind of day.</>,
    "17": <>Let’s get<br />it sorted.</>,
    "18": <>A place for<br />every little errand.</>,
    "20": <>Keep the everyday<br />close at hand.</>,
  };
  return (<><section className={`dh-art dh-${template.id}`} data-home-template={template.id} data-count={shortcuts.length} aria-label={template.name}
        onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
        <span className="dh-object" aria-hidden />
        <h2>{titles[template.id] ?? template.title}</h2>
        {template.id === "08" && <p className="dh-intro">Choose a stop to get started</p>}
        {template.id === "17" && <p className="dh-intro">What do you need today?</p>}
        {template.id === "11" && <p className="dh-intro">Pick a note to begin.</p>}
        <ul className="dh-options">{shortcuts.map((shortcut, index) => {
          const Icon = ICONS[shortcut.icon];
          const ticketActions: Record<string, string> = { shopping: "Write a shopping list", parcel: "Send a parcel", restaurants: "Order food" };
          const label = template.id === "04"
            ? index === 0 ? "Where to?" : ticketActions[shortcut.id] ?? shortcut.description
            : shortcut.label;
          const destination = template.id === "04" && index === 0 ? { ...shortcut, href: "/ride/car", module: "ride.car" } : shortcut;
          return <li key={shortcut.id} className="dh-option"><span className="dh-option-art" aria-hidden /><ShortcutSurface shortcut={destination} renderLink={renderLink}>
            <span className="dh-number" aria-hidden>{String(index + 1).padStart(2, "0")}</span>
            <span className="dh-icon"><Icon strokeWidth={1.6} aria-hidden /></span>
            <span className="dh-copy"><span className="dh-label">{label}</span><span className="dh-description">{shortcut.description}</span></span>
            <ArrowRight className="dh-arrow" size={20} aria-hidden />
          </ShortcutSurface>{template.id === "20" && <span className="dh-tab-icon" aria-hidden><Icon strokeWidth={1.6} /></span>}</li>;
        })}</ul>
      </section>
      {footer && <div className="dh-footer">{footer}</div>}
      </>);
}
