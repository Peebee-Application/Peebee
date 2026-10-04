const STORAGE_KEY = "peebee_seen_fee_proposals";

/** A fee proposal the customer has already viewed (opened the order while
 * it was pending) or acted on, so the home screen's reminder card doesn't
 * keep nagging about something they've already dealt with. Proposal ids
 * are never reused, so this list only ever grows — no need to prune it
 * against a live proposal, and it naturally stops mattering once a
 * proposal resolves (a resolved one is never "pending" again anyway). */
function readSeen(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export function isFeeProposalSeen(proposalId: string): boolean {
  if (typeof window === "undefined") return false;
  return readSeen().includes(proposalId);
}

export function markFeeProposalSeen(proposalId: string): void {
  if (typeof window === "undefined") return;
  try {
    const seen = readSeen();
    if (!seen.includes(proposalId)) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen, proposalId].slice(-50)));
    }
  } catch {
    // Storage full or unavailable — worst case the reminder reappears once.
  }
}
