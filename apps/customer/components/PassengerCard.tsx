"use client";

import { Check, Link2, MessageCircle, Users } from "lucide-react";
import { useState } from "react";
import { useTranslate } from "../lib/i18n";

/** Shown to the booker on a ride they booked for someone else: who is riding
 * and one tap to send them their private trip link (driver, live progress and
 * the PIN to give the driver). The booker keeps paying and stays in charge. */
export function PassengerCard({ name, phone, shareToken }: { name: string; phone: string | null; shareToken: string | null }) {
  const t = useTranslate();
  const [copied, setCopied] = useState(false);
  const link = shareToken && typeof window !== "undefined" ? `${window.location.origin}/trip/${shareToken}` : null;
  const message = link ? `${t("trip_share_text")} ${link}` : "";
  // wa.me wants the number as digits only, with the country code; a local "07…" number gets Uganda's.
  const digits = (phone ?? "").replace(/\D/g, "");
  const waNumber = digits.startsWith("0") ? `256${digits.slice(1)}` : digits;

  async function share() {
    if (!link) return;
    try {
      if (navigator.share) {
        await navigator.share({ text: message });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sharing was dismissed — nothing to do.
    }
  }

  return (
    <div className="space-y-3 rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
      <p className="flex items-center gap-2 text-[15px] font-bold text-ink">
        <Users className="h-4 w-4 text-gold" strokeWidth={2.25} aria-hidden />
        {t("trip_riding", { name })}
        {phone && <span className="font-normal text-ink-500">· {phone}</span>}
      </p>
      {link && (
        <div className="flex gap-2">
          <button type="button" onClick={() => void share()} className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold">
            {copied ? <Check className="h-4 w-4" strokeWidth={2.5} aria-hidden /> : <Link2 className="h-4 w-4" strokeWidth={2.25} aria-hidden />}
            {copied ? t("trip_copied") : t("trip_share")}
          </button>
          {waNumber && (
            <a
              href={`https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="WhatsApp"
              className="flex min-h-11 w-11 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink"
            >
              <MessageCircle className="h-5 w-5" strokeWidth={2} aria-hidden />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
