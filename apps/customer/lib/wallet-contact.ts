export type ContactInputError = "short" | "long" | "format";

/** A phone or email Peebee can look up: 3 to 200 characters, and a real shape. */
export function contactInputError(raw: string): ContactInputError | null {
  const value = raw.trim();
  if (value.length < 3) return "short";
  if (value.length > 200) return "long";
  if (value.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : "format";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return "format";
  if (!/^[+\d][\d\s().-]*$/.test(value)) return "format";
  return null;
}

export type PickedContact = { name: string; phone: string; email: string };

/** The phone picker can return several numbers. Peebee uses the first and lets the person edit it. */
export function firstContact(contact: { name?: string[]; tel?: string[]; email?: string[] } | undefined): PickedContact | null {
  if (!contact) return null;
  const name = contact.name?.find((part) => part.trim())?.trim() ?? "";
  const phone = contact.tel?.find((part) => part.trim())?.trim() ?? "";
  const email = contact.email?.find((part) => part.trim())?.trim() ?? "";
  if (!name && !phone && !email) return null;
  return { name, phone, email };
}

type ContactPicker = {
  select: (props: string[], opts?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; tel?: string[]; email?: string[] }>>;
};

export function contactPicker(): ContactPicker | null {
  if (typeof navigator === "undefined" || typeof window === "undefined") return null;
  if (!("contacts" in navigator) || !("ContactsManager" in window)) return null;
  return (navigator as unknown as { contacts: ContactPicker }).contacts;
}
