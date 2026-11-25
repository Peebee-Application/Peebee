import { HeaderWordmark } from "../../../customer/components/HeaderWordmark";
import type { useLocationLabel } from "./location";

const taglines = ["Travel with Taxibee", "Find your ride", "Ready to go?", "Go with Peebee"];
export const brandDescriptionId = "taxibee-current-location";

export function TaxibeeBrand(details: ReturnType<typeof useLocationLabel> & { modeLabel: string | null }) {
  return <HeaderWordmark {...details} brandDescriptionId={brandDescriptionId} taglines={taglines} />;
}
