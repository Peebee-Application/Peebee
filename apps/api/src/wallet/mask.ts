/**
 * Mask a phone the way the wallet shows a saved contact: "07•• ••• 412".
 * The full number never leaves the server on lookup, contacts, or the ledger.
 */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length < 6) return "••• •••";
  const local = digits.startsWith("256") && digits.length > 9 ? `0${digits.slice(3)}` : digits;
  const head = local.slice(0, 2);
  const tail = local.slice(-3);
  return `${head}•• ••• ${tail}`;
}

/** Initials for an avatar, from a display name. */
export function nameInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}
