"use client";

import type { RidePassenger, SavedPassenger } from "@peebee/shared";
import { ArrowLeft, BookUser, Check, Plus, Trash2, User, UserPlus, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useTranslate } from "../lib/i18n";

/** Digits only (and a leading +) — mirrors cleanPhone in apps/api/src/passengers/routes.ts. */
function phoneOk(raw: string): boolean {
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 9 && digits.length <= 15;
}

type ContactPicker = { select: (props: string[], opts?: { multiple?: boolean }) => Promise<Array<{ name?: string[]; tel?: string[] }>> };
const contactPicker = (): ContactPicker | null =>
  typeof navigator !== "undefined" && "contacts" in navigator && "ContactsManager" in window ? ((navigator as unknown as { contacts: ContactPicker }).contacts) : null;

/**
 * "Who's riding?" — the booker picks themselves, someone they've booked for
 * before, or adds a new person (name + phone, or straight from the phone's
 * contacts). The booker still pays and stays in charge; the passenger gets a
 * private trip link once the ride is booked.
 */
export function WhoIsRiding({
  passenger,
  saved,
  onSaved,
  onPick,
  onClose,
  startAdding = false,
}: {
  passenger: RidePassenger | null;
  saved: SavedPassenger[];
  /** The saved list changed (added/removed) — the parent keeps the source of truth. */
  onSaved: (list: SavedPassenger[]) => void;
  onPick: (passenger: RidePassenger | null) => void;
  onClose: () => void;
  /** Open straight on the "someone new" form (the prompt's "Yes" answer). */
  startAdding?: boolean;
}) {
  const t = useTranslate();
  const [adding, setAdding] = useState(startAdding);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const picker = contactPicker();

  async function fromContacts() {
    try {
      const [contact] = (await picker?.select(["name", "tel"], { multiple: false })) ?? [];
      if (!contact) return;
      if (contact.name?.[0]) setName(contact.name[0]);
      if (contact.tel?.[0]) setPhone(contact.tel[0]);
      setError(null);
    } catch {
      // The person closed the picker — nothing to do.
    }
  }

  async function add() {
    if (!name.trim()) return setError(t("who_name"));
    if (!phoneOk(phone)) return setError(t("who_bad_phone"));
    const person = { name: name.trim(), phone: phone.trim() };
    if (remember) {
      try {
        const { passenger: row } = await api.savePassenger(person);
        onSaved([...saved.filter((p) => p.id !== row.id && p.phone !== row.phone), row]);
      } catch {
        // Saving is a convenience; the ride can still be booked for them.
      }
    }
    onPick(person);
  }

  async function remove(id: string) {
    onSaved(saved.filter((p) => p.id !== id));
    await api.deletePassenger(id).catch(() => {});
  }

  const sheet = (
    <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/40" role="dialog" aria-modal="true" aria-label={t("who_title")}>
      <button type="button" className="absolute inset-0 cursor-default" aria-label="Close" onClick={onClose} />
      <div className="soft-drawer relative w-full max-w-lg space-y-4 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4">
        <div className="flex items-center gap-2">
          {adding && (
            <button type="button" onClick={() => setAdding(false)} aria-label="Back" className="flex h-10 w-10 items-center justify-center rounded-full text-ink active:bg-[rgb(var(--surface-muted))]">
              <ArrowLeft className="h-5 w-5" strokeWidth={2.25} />
            </button>
          )}
          <h2 className="flex-1 text-xl font-bold text-ink">{adding ? t("who_new") : t("who_title")}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-10 w-10 items-center justify-center rounded-full text-ink active:bg-[rgb(var(--surface-muted))]">
            <X className="h-5 w-5" strokeWidth={2.25} />
          </button>
        </div>

        {adding ? (
          <div className="space-y-3">
            {picker && (
              <button type="button" onClick={() => void fromContacts()} className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-[var(--border-faint)] px-4 text-left text-base font-semibold text-ink active:bg-[rgb(var(--surface-muted))]">
                <BookUser className="h-5 w-5 text-gold" strokeWidth={2} aria-hidden />
                {t("who_contacts")}
              </button>
            )}
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("who_name")} autoComplete="off" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-4 text-base outline-none focus:border-gold" />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t("who_phone")} inputMode="tel" autoComplete="off" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-4 text-base outline-none focus:border-gold" />
            <label className="flex items-center gap-2 text-sm font-semibold text-ink">
              <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4 accent-gold" />
              {t("who_save")}
            </label>
            <p className="text-sm leading-5 text-ink-500">{t("who_info", { name: name.trim() || t("who_someone_else") })}</p>
            {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            <button type="button" onClick={() => void add()} className="min-h-12 w-full rounded-full bg-gold px-4 text-base font-bold text-ink-gold shadow-[0_4px_12px_rgba(201,162,39,0.35)]">
              {t("who_continue")}
            </button>
          </div>
        ) : (
          <ul className="space-y-2">
            <li>
              <button type="button" onClick={() => onPick(null)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-[var(--border-faint)] px-4 text-left active:bg-[rgb(var(--surface-muted))]">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"><User className="h-5 w-5" strokeWidth={1.75} aria-hidden /></span>
                <span className="flex-1 text-base font-bold text-ink">{t("who_me")}</span>
                {!passenger && <Check className="h-5 w-5 text-gold" strokeWidth={2.5} aria-hidden />}
              </button>
            </li>
            {saved.map((p) => {
              const selected = passenger?.phone === p.phone;
              return (
                <li key={p.id} className="flex items-center gap-1">
                  <button type="button" onClick={() => onPick({ name: p.name, phone: p.phone })} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-[var(--border-faint)] px-4 text-left active:bg-[rgb(var(--surface-muted))]">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"><User className="h-5 w-5" strokeWidth={1.75} aria-hidden /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-bold text-ink">{p.name}</span>
                      <span className="block truncate text-sm text-ink-500">{p.phone}</span>
                    </span>
                    {selected && <Check className="h-5 w-5 shrink-0 text-gold" strokeWidth={2.5} aria-hidden />}
                  </button>
                  <button type="button" onClick={() => void remove(p.id)} aria-label={`Remove ${p.name}`} className="flex h-10 w-10 shrink-0 items-center justify-center text-ink-500/60 active:text-red-600">
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </li>
              );
            })}
            <li>
              <button type="button" onClick={() => setAdding(true)} className="flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-gold px-4 text-left active:bg-gold/10">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold/15 text-gold"><UserPlus className="h-5 w-5" strokeWidth={2} aria-hidden /></span>
                <span className="flex-1 text-base font-bold text-ink">{saved.length === 0 ? t("who_someone_else") : t("who_new")}</span>
                <Plus className="h-5 w-5 text-ink-500" aria-hidden />
              </button>
            </li>
          </ul>
        )}
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
