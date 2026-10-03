import { hasPermission } from "@tuma/shared";
import {
  Banknote,
  Car,
  Compass,
  CreditCard,
  FlaskConical,
  Languages,
  Mic,
  Map as MapIcon,
  PiggyBank,
  Phone,
  Route,
  Store,
  Settings as SettingsIcon,
  Wallet as WalletIcon,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type SettingsLink = {
  href: string;
  label: string;
  description: string;
  icon: LucideIcon;
  show?: (role: Parameters<typeof hasPermission>[0]) => boolean;
};

export const SETTINGS_LINKS: SettingsLink[] = [
  {
    href: "/settings/delivery",
    label: "Delivery pricing",
    description: "Rate per km, minimum fees, shopping and ride fares.",
    icon: SettingsIcon,
  },
  {
    href: "/settings/matching",
    label: "Rider matching",
    description: "Service range, matching modes, assignment timing.",
    icon: Route,
  },
  {
    href: "/settings/car",
    label: "Tuma Car",
    description: "Switch car rides on, how drivers are found, profit share, car types, owners, drivers and vehicles.",
    icon: Car,
    show: (role) => hasPermission(role, "car.view"),
  },
  {
    href: "/settings/voice",
    label: "Voice recordings",
    description: "Max recording length across the app.",
    icon: Mic,
  },
  {
    href: "/settings/luganda-audio",
    label: "Luganda list reading",
    description: "Read a rider's shopping list aloud in Luganda, and which voices they can pick from.",
    icon: Languages,
  },
  {
    href: "/settings/payments",
    label: "Payments",
    description: "Aggregators, demo mode, API credentials.",
    icon: CreditCard,
    show: (role) => hasPermission(role, "payments.manage"),
  },
  {
    href: "/settings/merchant-payments",
    label: "Merchant payments",
    description: "Custody gate, payout verification and reconciliation.",
    icon: Store,
    show: (role) => hasPermission(role, "merchant_finance.manage"),
  },
  {
    href: "/settings/calls",
    label: "Calls",
    description: "Voice call provider and credentials.",
    icon: Phone,
    show: (role) => hasPermission(role, "payments.manage"),
  },
  {
    href: "/settings/maps",
    label: "Maps",
    description: "Maps provider and API credentials.",
    icon: MapIcon,
    show: (role) => hasPermission(role, "payments.manage"),
  },
  {
    href: "/settings/navigation",
    label: "Navigation mode",
    description: "How riders get turn-by-turn directions.",
    icon: Compass,
    show: (role) => hasPermission(role, "payments.manage"),
  },
  {
    href: "/settings/customer-wallet",
    label: "Customer wallet limits",
    description: "Unverified/verified balance caps, max top-up.",
    icon: WalletIcon,
    show: (role) => hasPermission(role, "payments.manage"),
  },
  {
    href: "/settings/rider-wallet",
    label: "Rider wallet minimum balance",
    description: "Reserve every rider withdrawal must leave behind.",
    icon: WalletIcon,
    show: (role) => hasPermission(role, "payments.manage"),
  },
  {
    href: "/settings/monetization",
    label: "Monetization",
    description: "Commission, service fee, processing fee, cash orders, rider subscription, Rider Pro.",
    icon: Banknote,
    show: (role) => hasPermission(role, "payments.manage"),
  },
  {
    href: "/settings/stage-savings",
    label: "Stage savings circles",
    description: "Stage creation, loan interest, recorder role, admin visibility.",
    icon: PiggyBank,
    show: (role) => hasPermission(role, "payments.manage"),
  },
  {
    href: "/settings/platform",
    label: "Platform state",
    description: "Live vs. sandbox — affects every customer and rider.",
    icon: FlaskConical,
    show: (role) => hasPermission(role, "payments.manage"),
  },
];
