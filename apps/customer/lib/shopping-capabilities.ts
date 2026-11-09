/** Adapters for shopping capabilities that do not have a backend yet.
 * They never invent catalogue rows, membership, or a store code. */

export type PhotoSearchResult =
  | { status: "unavailable" }
  | { status: "ok"; hits: Array<{ id: string; title: string; href: string }> };

/** Photo catalogue search. There is no vision endpoint yet, so this stays unavailable. */
export async function searchCatalogueByPhoto(_file: File): Promise<PhotoSearchResult> {
  return { status: "unavailable" };
}

export type MembershipState = { active: false } | { active: true; since: string };

/** Membership status. There is no membership record yet, so nobody is marked a member. */
export async function loadMembership(): Promise<MembershipState> {
  return { active: false };
}

export type InStoreCodeResult = { status: "unavailable" } | { status: "ok"; code: string; expiresAt: string };

/** In-store identity code. There is no issuer yet. */
export async function loadInStoreCode(): Promise<InStoreCodeResult> {
  return { status: "unavailable" };
}
