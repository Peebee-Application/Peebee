/** Keep selection inside the horizontal menu without scrolling the page. */
export function selectedMenuScroll(left: number, width: number, viewport: number, total: number, center: boolean) {
  const target = center ? left - (viewport - width) / 2 : left;
  return Math.max(0, Math.min(target, Math.max(0, total - viewport)));
}

export const SPACE_PAGES = [
  { id: "stay", label: "Stay", description: "Find a place for your next stay." },
  { id: "homes", label: "Homes", description: "Find a place to call home." },
  { id: "offices", label: "Offices", description: "Find room for your business to grow." },
  { id: "storage", label: "Storage", description: "Find space for the things that matter." },
  { id: "for-sale", label: "For Sale", description: "Explore property for your next chapter." },
] as const;
