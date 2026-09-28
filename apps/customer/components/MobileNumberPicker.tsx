"use client";

import type { MobileNumberPurpose, SavedMobileNumber } from "@tuma/shared";
import { detectMobileMoneyNetwork, mobileMoneyNetworkLabel } from "@tuma/shared";
import { Check, Plus, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";

/**
 * Picks which mobile money number a payment goes out from — saved numbers
 * (max 2, see apps/api/src/account/mobile-numbers.ts) as one-tap options,
 * or a custom number typed in on the spot. Reports the chosen digits up via
 * `onChange`; saving/deleting/setting-primary all happen inline here.
 */
export function MobileNumberPicker({
  purpose,
  value,
  onChange,
  prominent = false,
  autoSave = false,
}: {
  purpose: MobileNumberPurpose;
  value: string;
  onChange: (phone: string) => void;
  prominent?: boolean;
  autoSave?: boolean;
}) {
  const [numbers, setNumbers] = useState<SavedMobileNumber[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | "custom" | null>(null);
  const [customPhone, setCustomPhone] = useState("");
  const saving = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getMobileNumbers(purpose)
      .then((res) => {
        setNumbers(res.numbers);
        const primary = res.numbers.find((n) => n.is_primary) ?? res.numbers[0];
        if (primary) {
          setSelectedId(primary.id);
          onChange(primary.phone);
        } else {
          setSelectedId("custom");
        }
      })
      .catch(() => {
        setNumbers([]);
        setSelectedId("custom");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [purpose]);

  function choose(n: SavedMobileNumber) {
    setSelectedId(n.id);
    onChange(n.phone);
  }

  function chooseCustom() {
    setSelectedId("custom");
    onChange(customPhone);
  }

  async function saveThisNumber() {
    if (!customPhone.trim() || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const res = await api.addMobileNumber({ purpose, phone: customPhone.trim() });
      setNumbers((prev) => [...(prev ?? []), res.number]);
      setSelectedId(res.number.id);
      onChange(res.number.phone);
      setCustomPhone("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      saving.current = false;
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
      if (selectedId === id) {
        setSelectedId("custom");
        onChange("");
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const network = detectMobileMoneyNetwork(selectedId === "custom" ? customPhone : value);
  const atLimit = (numbers?.length ?? 0) >= 2;

  return (
    <div className="space-y-2">
      {numbers && numbers.length > 0 && (
        <div className="space-y-1.5">
          {numbers.map((n) => (
            <div
              key={n.id}
              className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 ${
                selectedId === n.id ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"
              }`}
            >
              <button type="button" onClick={() => choose(n)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
                    selectedId === n.id ? "bg-gold text-ink-gold" : "border border-[var(--border-faint)]"
                  }`}
                >
                  {selectedId === n.id && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold text-ink">
                    {n.phone}
                    {n.label ? ` · ${n.label}` : ""}
                  </span>
                </span>
              </button>
              {!!n.is_primary && (
                <span className="flex shrink-0 items-center gap-0.5 text-[10px] font-bold text-gold">
                  <Star className="h-3 w-3 fill-current" strokeWidth={0} aria-hidden />
                  Default
                </span>
              )}
              {!n.is_primary && (
                <button
                  type="button"
                  onClick={() => setPrimary(n.id)}
                  disabled={busy}
                  className="shrink-0 text-[11px] font-semibold text-ink-500 underline disabled:opacity-50"
                >
                  Set as default
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
        </div>
      )}

      <div
        className={`space-y-1.5 rounded-xl border px-3 py-2.5 ${
          selectedId === "custom" ? "border-gold bg-gold/10" : "border-[var(--border-faint)]"
        }`}
      >
        <button type="button" onClick={chooseCustom} className="flex w-full items-center gap-2 text-left">
          <span
            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              selectedId === "custom" ? "bg-gold text-ink-gold" : "border border-[var(--border-faint)]"
            }`}
          >
            {selectedId === "custom" && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
          </span>
          <span className="text-[15px] font-semibold text-ink">
            {numbers && numbers.length > 0 ? "Use a different number" : "Mobile money number"}
          </span>
        </button>
        {selectedId === "custom" && (
          <div className={prominent ? "space-y-3 pt-2" : "space-y-1.5 pl-7"}>
            <label htmlFor={`mobile-number-${purpose}`} className={prominent ? "block text-sm font-semibold text-ink" : "sr-only"}>Mobile money phone number</label>
            <input
              id={`mobile-number-${purpose}`}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={customPhone}
              onChange={(e) => {
                setCustomPhone(e.target.value);
                onChange(e.target.value);
              }}
              onBlur={() => {
                if (autoSave && numbers !== null && !atLimit && detectMobileMoneyNetwork(customPhone)) void saveThisNumber();
              }}
              placeholder="e.g. 0772345678"
              className={prominent ? "min-h-16 w-full rounded-xl border-2 border-gold bg-[rgb(var(--surface-card))] px-4 py-4 text-xl font-semibold outline-none focus:ring-2 focus:ring-gold/30" : "w-full rounded-lg border border-[var(--border-faint)] px-3 py-2 text-[15px] outline-none focus:border-gold"}
            />
            {autoSave && !atLimit && <p className="text-xs text-ink-500">Your number is saved automatically for next time. You can choose which saved number is your default.</p>}
            {network && <p className="text-xs font-semibold text-ink-500">{mobileMoneyNetworkLabel(network)} detected</p>}
            {!atLimit && customPhone.trim().length >= 6 && (
              <button
                type="button"
                onClick={saveThisNumber}
                disabled={busy}
                className="flex items-center gap-1 text-xs font-bold text-gold disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
                Save this number for next time
              </button>
            )}
            {atLimit && <p className="text-xs text-ink-500">You&apos;ve saved the maximum of 2 numbers.</p>}
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
