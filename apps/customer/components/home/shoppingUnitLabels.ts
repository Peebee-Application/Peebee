import type { ShoppingUnit } from "@peebee/shared";
import type { TranslationKey } from "../../lib/i18n";
export const UNIT_KEYS: Record<ShoppingUnit, TranslationKey> = {
  pcs: "unit_pcs", kg: "unit_kg", g: "unit_g", l: "unit_l", ml: "unit_ml", m: "unit_m",
  bunch: "unit_bunch", cluster: "unit_cluster", bundle: "unit_bundle", bag: "unit_bag", box: "unit_box",
  packet: "unit_packet", pair: "unit_pair", set: "unit_set", roll: "unit_roll", sack: "unit_sack",
  basket: "unit_basket", heap: "unit_heap", budget: "unit_budget", other: "unit_other",
};
