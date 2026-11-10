export type IdKind = "email" | "phone" | "unknown";

/** Phone while the value is only digits and phone punctuation; email once a letter or @ appears. */
export function identifierKind(value: string): IdKind {
  const v = value.trim();
  if (!v) return "unknown";
  if (/[a-z@]/i.test(v)) return "email";
  if (/^[\d+\s().-]+$/.test(v)) return "phone";
  return "unknown";
}

export function identifierInputMode(value: string): "email" | "tel" | "text" {
  const kind = identifierKind(value);
  if (kind === "email") return "email";
  if (kind === "phone") return "tel";
  return "text";
}

export function identifierIsValid(value: string): boolean {
  const v = value.trim();
  const kind = identifierKind(v);
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  if (kind === "phone") return v.replace(/\D/g, "").length >= 9;
  return false;
}

export function identifierLabel(value: string): "Email" | "Phone" | "Phone or email" {
  const kind = identifierKind(value);
  if (kind === "email") return "Email";
  if (kind === "phone") return "Phone";
  return "Phone or email";
}

/** "sharon@example.com" → "s*****@example.com". A phone keeps its last two digits. */
export function maskContact(value: string): string {
  const v = value.trim();
  const at = v.indexOf("@");
  if (at > 0) {
    const name = v.slice(0, at);
    const domain = v.slice(at + 1);
    return `${name.slice(0, 1)}${"*".repeat(Math.max(4, name.length - 1))}@${domain}`;
  }
  const compact = v.replace(/\s/g, "");
  if (compact.length <= 4) return v;
  return `${"*".repeat(Math.max(4, compact.length - 2))}${compact.slice(-2)}`;
}
