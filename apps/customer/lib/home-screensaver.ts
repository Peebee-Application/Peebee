import type { HiveShortcutId, HomeClusterId } from "@peebee/shared";

/**
 * Launch screensaver content. Titles for the five slides come from the admin
 * home-menu labels at runtime. Everything else here is isolated placeholder
 * copy (including "15 riders near you") until a real source exists.
 * Photos live in /home-screensaver; Buy, Work and Learn use token gradients.
 */

export type ScreensaverIcon =
  | "phone" | "package" | "bag" | "truck" | "bike" | "car"
  | "utensils" | "chef" | "croissant" | "list" | "basket" | "store" | "pill"
  | "sparkles" | "washer" | "wrench" | "hardhat" | "briefcase"
  | "book" | "radio" | "tv";

export type ScreensaverEntity = {
  id: string;
  title: string;
  /** Hidden when this Services switch is off. Parent modules are already applied by useModules. */
  module?: string;
  /** Hidden when this Hive shortcut is switched off in the home menu. */
  shortcut?: HiveShortcutId;
  meta: string;
  description: string;
  cta: string;
  href: string;
  icon: ScreensaverIcon;
  image?: string;
  /** CSS object-position for the hero crop. */
  imagePosition?: string;
  /** Token gradient behind the photo, and the whole slide when there is no photo. */
  gradient: string;
};

export type ScreensaverModuleDef = {
  id: string;
  cluster: HomeClusterId;
  /** Fallback slide title. The admin home-menu label replaces it in the app. */
  title: string;
  /** The slide is omitted when this module is off. */
  module: string;
  cover?: string;
  coverPosition?: string;
  coverGradient: string;
  entities: ScreensaverEntity[];
};

const photo = (name: string) => `/home-screensaver/${name}.webp`;

/** Ink-to-gold wash. Angle varies so neighbouring fallbacks are not identical. */
function wash(angle: number): string {
  return `linear-gradient(${angle}deg, rgb(var(--color-ink)) 0%, rgb(var(--color-black-700)) 48%, rgb(var(--color-gold) / 0.9) 130%)`;
}

export const SCREENSAVER_MODULES: readonly ScreensaverModuleDef[] = [
  {
    id: "ride",
    cluster: "ride",
    title: "Ride",
    module: "ride",
    cover: photo("ride-hero"),
    coverPosition: "50% 60%",
    coverGradient: wash(165),
    entities: [
      {
        id: "boda",
        title: "Boda",
        module: "ride.boda",
        meta: "15 riders near you",
        description: "Fast motorbike rides across town. Beat the traffic and pay with cash or mobile money.",
        cta: "Call a rider",
        href: "/ride/boda",
        icon: "phone",
        image: photo("boda"),
        imagePosition: "50% 15%",
        gradient: wash(160),
      },
      {
        id: "car",
        title: "Car",
        module: "ride.car",
        meta: "Cars ready nearby",
        description: "A car across town, with a driver. Pay with cash or mobile money.",
        cta: "Book a car",
        href: "/ride/car",
        icon: "car",
        image: photo("car"),
        imagePosition: "50% 40%",
        gradient: wash(175),
      },
      {
        id: "parcel",
        title: "Parcel",
        module: "deliver.parcel",
        meta: "8 riders near you",
        description: "Send a parcel across town by boda. Track it live until it reaches the door.",
        cta: "Send a parcel",
        href: "/deliver/parcel",
        icon: "package",
        image: photo("parcel"),
        imagePosition: "35% 30%",
        gradient: wash(188),
      },
      {
        id: "move",
        title: "Move",
        module: "ride.move",
        meta: "Vans ready nearby",
        description: "Vans and trucks for loads across town. Tell us what you are moving.",
        cta: "Book a move",
        href: "/ride/move",
        icon: "truck",
        image: photo("move"),
        imagePosition: "50% 40%",
        gradient: wash(200),
      },
    ],
  },
  {
    id: "eat",
    cluster: "food",
    title: "Eat",
    module: "buy.food",
    cover: photo("eat-hero"),
    coverPosition: "50% 40%",
    coverGradient: wash(155),
    entities: [
      {
        id: "restaurants",
        title: "Restaurants",
        meta: "42 open near you · 25–40 min",
        description: "Meals from Kampala's favourite kitchens, delivered hot to your door.",
        cta: "Order food",
        href: "/restaurants",
        icon: "bag",
        image: photo("restaurants"),
        imagePosition: "50% 60%",
        gradient: wash(158),
      },
      {
        id: "street-food",
        title: "Street food",
        meta: "Stalls open near you",
        description: "Street food from cooks near you, packed up and brought to your door.",
        cta: "Order street food",
        href: "/streetfood",
        icon: "chef",
        image: photo("street-food"),
        imagePosition: "50% 40%",
        gradient: wash(172),
      },
      {
        id: "bakeries",
        title: "Bakeries",
        meta: "Ovens on near you",
        description: "Bread, cakes and pastries from bakeries around you, still warm.",
        cta: "Order from a bakery",
        href: "/bakeries",
        icon: "croissant",
        image: photo("bakeries"),
        imagePosition: "50% 40%",
        gradient: wash(190),
      },
    ],
  },
  {
    id: "buy",
    cluster: "shopping",
    title: "Buy",
    module: "buy",
    coverGradient: wash(168),
    entities: [
      {
        id: "list",
        title: "List",
        module: "buy.shopping",
        meta: "Riders ready to shop",
        description: "Write what you need. A rider shops it and brings it to your door.",
        cta: "Start a list",
        href: "/shoplist",
        icon: "list",
        gradient: wash(162),
      },
      {
        id: "groceries",
        title: "Groceries",
        module: "buy.shopping",
        meta: "Markets open near you",
        description: "Fresh food from markets and shops around you, brought to your door.",
        cta: "Shop groceries",
        href: "/groceries",
        icon: "basket",
        gradient: wash(176),
      },
      {
        id: "stores",
        title: "Stores",
        module: "buy.marketplace",
        meta: "Stores open near you",
        description: "Browse shops and order what you need. A rider delivers it.",
        cta: "Browse stores",
        href: "/stores",
        icon: "store",
        gradient: wash(194),
      },
      {
        id: "pharmacy",
        title: "Pharmacy",
        module: "buy.pharmacy",
        meta: "Pharmacies open near you",
        description: "Medicine and pharmacy items, delivered with care.",
        cta: "Order medicine",
        href: "/pharmacy",
        icon: "pill",
        gradient: wash(208),
      },
    ],
  },
  {
    id: "work",
    cluster: "hive",
    title: "Work",
    module: "hive",
    coverGradient: wash(180),
    entities: [
      {
        id: "clean",
        title: "Clean",
        module: "hive.work",
        shortcut: "clean",
        meta: "Teams ready near you",
        description: "Home cleaning at a clear price. Tell us what needs doing.",
        cta: "Book a clean",
        href: "/services/clean",
        icon: "sparkles",
        gradient: wash(164),
      },
      {
        id: "laundry",
        title: "Laundry",
        module: "hive.work",
        shortcut: "laundry",
        meta: "Pickup available near you",
        description: "We collect your laundry and bring it back fresh.",
        cta: "Book laundry",
        href: "/services/laundry",
        icon: "washer",
        gradient: wash(178),
      },
      {
        id: "fix",
        title: "Fix",
        module: "hive.work",
        shortcut: "fix",
        meta: "Fixers ready near you",
        description: "Repairs at home, with a clear price before anyone starts.",
        cta: "Book a fix",
        href: "/services/fix",
        icon: "wrench",
        gradient: wash(196),
      },
      {
        id: "workers",
        title: "Workers",
        module: "hive.hire.search",
        shortcut: "workers",
        meta: "People ready for odd jobs",
        description: "Find someone for a quick job around the house or the shop.",
        cta: "Find a worker",
        href: "/services/hire/workers?segment=informal",
        icon: "hardhat",
        gradient: wash(210),
      },
      {
        id: "hire",
        title: "Hire",
        module: "hive.hire",
        shortcut: "hire",
        meta: "People for bigger jobs",
        description: "Hire someone for a project or a longer piece of work.",
        cta: "Hire someone",
        href: "/services/hire",
        icon: "briefcase",
        gradient: wash(222),
      },
    ],
  },
  {
    id: "learn",
    cluster: "learn",
    title: "Learn",
    module: "learn",
    coverGradient: wash(192),
    entities: [
      {
        id: "discover",
        title: "Discover",
        meta: "Courses open now",
        description: "Classes and courses to learn at your own pace.",
        cta: "Browse courses",
        href: "/learn",
        icon: "book",
        gradient: wash(170),
      },
      {
        id: "live",
        title: "Live",
        module: "learn.live",
        meta: "Classes you can join",
        description: "Join a live class with a teacher, a whiteboard and chat.",
        cta: "See live classes",
        href: "/learn/live",
        icon: "radio",
        gradient: wash(186),
      },
      {
        id: "tv",
        title: "TV",
        module: "learn.tv",
        meta: "Lessons on your TV",
        description: "Learning on the big screen, paired from your phone.",
        cta: "Watch on TV",
        href: "/learn/tv",
        icon: "tv",
        gradient: wash(204),
      },
    ],
  },
];

export function entitySubtitle(entities: readonly { title: string }[]): string {
  return entities.map((entity) => entity.title).join(" · ");
}

/** Signed steps around a loop, in (-count/2, count/2]. */
export function circularOffset(index: number, active: number, count: number): number {
  if (count <= 1) return 0;
  let delta = index - active;
  delta = ((delta % count) + count) % count;
  if (delta > count / 2) delta -= count;
  return delta;
}

export function wrapIndex(index: number, count: number): number {
  if (count <= 0) return 0;
  return ((index % count) + count) % count;
}

/**
 * Drops slides and sub-entities the admin has switched off.
 * A slide with nothing left to show is dropped too.
 * `moduleOn` is expected to already apply parent switches (see useModules).
 */
export function selectScreensaver<T extends ScreensaverModuleDef>(
  modules: readonly T[],
  moduleOn: (key: string) => boolean,
  shortcuts: readonly { id: string; enabled: boolean }[] = [],
): T[] {
  const shortcutOn = new Map(shortcuts.map((item) => [item.id, item.enabled]));
  const selected: T[] = [];
  for (const mod of modules) {
    if (!moduleOn(mod.module)) continue;
    const entities = mod.entities.filter((entity) => {
      if (entity.module && !moduleOn(entity.module)) return false;
      if (entity.shortcut && shortcutOn.get(entity.shortcut) === false) return false;
      return true;
    });
    if (entities.length === 0) continue;
    selected.push({ ...mod, entities });
  }
  return selected;
}
