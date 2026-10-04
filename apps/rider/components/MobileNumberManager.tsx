"use client";

import type { MobileNumberPurpose, SavedMobileNumber } from "@peebee/shared";
import { Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";

/** Manage up to 2 saved mobile money numbers for a purpose (here always
 * 'withdrawal' — see apps/api/src/account/mobile-numbers.ts). Once 2 are
 * saved, the wallet page requires picking one for every withdrawal instead
 * of guessing. */
export function MobileNumberManager({ purpose }: { purpose: MobileNumberPurpose }) {
  const [numbers, setNumbers] = useState<SavedMobileNumber[] | null>(null);
  const [newPhone, setNewPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMobileNumbers(purpose)
      .then((res) => setNumbers(res.numbers))
      .catch(() => setNumbers([]));
  }, [purpose]);

  async function add() {
    if (!newPhone.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.addMobileNumber({ purpose, phone: newPhone.trim() });
      setNumbers((prev) => [...(prev ?? []), res.number]);
      setNewPhone("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function setPrimary(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.updateMobileNumber(id, { isPrimary: true });
      setNumbers((prev) => (prev ? prev.map((n) => ({ ...n, is_primary: n.id === id ? 1 : 0 })) : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setError(null);
    try {
      await api.deleteMobileNumber(id);
      setNumbers((prev) => (prev ? prev.filter((n) => n.id !== id) : prev));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (numbers === null) return null;
  const atLimit = numbers.length >= 2;

  return (
    <div className="space-y-2">
      {numbers.map((n) => (
        <div key={n.id} className="flex items-center gap-2 rounded-xl border border-[var(--border-faint)] px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-ink">
            {n.phone}
            {n.label ? ` · ${n.label}` : ""}
          </span>
          {!!n.is_primary && (
            <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-gold">
              <Star className="h-3 w-3 fill-current" strokeWidth={0} aria-hidden />
              Primary
            </span>
          )}
          {!n.is_primary && (
            <button
              type="button"
              onClick={() => setPrimary(n.id)}
              disabled={busy}
              className="shrink-0 text-[11px] font-semibold text-ink-500 underline disabled:opacity-50"
            >
              Set primary
            </button>
          )}
          <button
            type="button"
            onClick={() => remove(n.id)}
            disabled={busy}
            aria-label="Delete number"
            className="shrink-0 text-ink-500/60 disabled:opacity-50"
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.75} aria-hidden />
          </button>
        </div>
      ))}

      {!atLimit && (
        <div className="flex gap-2">
          <input
            value={newPhone}
            onChange={(e) => setNewPhone(e.target.value)}
            placeholder="Add a number, e.g. 0772345678"
            className="min-w-0 flex-1 rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
          <button
            type="button"
            onClick={add}
            disabled={busy || !newPhone.trim()}
            className="flex shrink-0 items-center gap-1 rounded-xl bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-50"
          >
            <Plus className="h-4 w-4" strokeWidth={2.5} aria-hidden />
            Add
          </button>
        </div>
      )}
      {atLimit && <p className="text-xs text-ink-500">You&apos;ve saved the maximum of 2 numbers.</p>}
      {numbers.length >= 2 && (
        <p className="text-xs text-ink-500">With 2 saved, you&apos;ll be asked which one to use every time you withdraw.</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
