import type { DealTermsView } from "@peebee/shared";

const ugx = (n: number) => `UGX ${n.toLocaleString("en-UG")}`;

/** Plain-words description of an agreed fee. */
export function describeTerms(t: DealTermsView | null | undefined): string {
  if (!t) return "Standard Peebee split";
  if (t.feeType === "rent") return `Fixed rent ${ugx(t.rentAmount ?? 0)} per ${t.rentPeriod ?? "day"} — you keep the rest of your earnings`;
  const owner = t.ownerSharePercent ?? 0;
  return `Owner gets ${owner}%, driver ${100 - owner}% of each ride after Peebee's cut`;
}
