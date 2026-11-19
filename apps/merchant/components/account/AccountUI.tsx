"use client";

import type { AuthUser, Merchant, MerchantMember } from "@peebee/shared";
import { BadgeCheck, Briefcase, Check, ChevronRight, CircleAlert, Clock, Crown, Landmark, Lock, Pencil, ScanLine, Shield, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../lib/api";
import { StoreGlow, card } from "../store/StoreUI";

/**
 * Big, senior-friendly pieces for the Account screens (same look as the Store screens): page frame with the gold
 * glow, grouped rows, toggles, role pills, avatars and big option cards for sheets.
 */

export function AccountFrame({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="relative mx-auto max-w-xl space-y-4 overflow-x-clip px-4 pb-24 pt-4" data-testid={testId}>
      <StoreGlow />
      <div className="relative space-y-4">{children}</div>
    </div>
  );
}

/** Back to the previous screen (the phone's Back does the same); falls back to a parent page when opened directly. */
export function useBack(fallback = "/account") {
  const router = useRouter();
  return () => {
    const idx = (window.history.state as { idx?: number; __NA?: boolean } | null)?.idx;
    if ((typeof idx === "number" && idx > 0) || (idx === undefined && window.history.length > 1 && document.referrer.startsWith(window.location.origin))) router.back();
    else router.push(fallback);
  };
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return <p className="px-1 pt-1 text-[15px] font-black uppercase tracking-[.06em] text-ink-500">{children}</p>;
}

export function Group({ children, testId }: { children: ReactNode; testId?: string }) {
  return <div className={`${card} overflow-hidden !rounded-[26px] [&>*+*]:border-t-[1.5px] [&>*+*]:border-[var(--border-faint)]`} data-testid={testId}>{children}</div>;
}

export function Toggle({ on, label }: { on: boolean; label?: string }) {
  return (
    <span aria-hidden={!label} className={`relative inline-block h-10 w-[68px] shrink-0 rounded-full border-2 transition ${on ? "border-gold bg-gold" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]"}`}>
      <span className={`absolute top-[2px] h-8 w-8 rounded-full shadow-[0_2px_6px_rgb(0_0_0/.25)] transition-all ${on ? "left-[30px] bg-black" : "left-[2px] bg-white"}`} />
    </span>
  );
}

type RowTrail = "chev" | "edit" | "lock" | "none" | ReactNode;
/** One row inside a Group: icon, small label, big value, and a trailing pencil / lock / chevron / toggle. */
export function GRow({ icon: Icon, label, value, trail = "chev", onClick, href, external, testId, tone, pressed }: {
  icon: LucideIcon; label?: ReactNode; value: ReactNode; trail?: RowTrail; onClick?: () => void; href?: string; external?: boolean; testId?: string; tone?: "red"; pressed?: boolean;
}) {
  const t = trail === "chev" ? <ChevronRight className="h-7 w-7 shrink-0 text-gold" strokeWidth={3} />
    : trail === "edit" ? <Pencil className="h-6 w-6 shrink-0 text-ink-500" />
    : trail === "lock" ? <Lock className="h-6 w-6 shrink-0 text-ink-500" aria-label="Locked" />
    : trail === "none" ? null : trail;
  const inner = (
    <>
      <span className={`grid h-[52px] w-[52px] shrink-0 place-items-center rounded-[16px] ${tone === "red" ? "bg-red-600/12 text-red-600 dark:text-red-400" : "bg-gold/15 text-[#8a6d0b] dark:text-gold"}`}>
        <Icon className="h-7 w-7" strokeWidth={2.2} />
      </span>
      <span className="min-w-0 flex-1">
        {label != null && <span className="block text-[16px] font-bold leading-snug text-ink-500">{label}</span>}
        <span className={`block break-words text-[20px] font-black leading-tight ${tone === "red" ? "text-red-600 dark:text-red-400" : "text-ink"}`}>{value}</span>
      </span>
      {t}
    </>
  );
  const cls = "flex min-h-[80px] w-full min-w-0 items-center gap-3.5 px-4 py-3 text-left transition active:bg-[rgb(var(--surface-muted))]";
  if (href) return external ? <a href={href} target="_blank" rel="noreferrer" className={cls} data-testid={testId}>{inner}</a> : <Link href={href} className={cls} data-testid={testId}>{inner}</Link>;
  if (onClick) return <button type="button" onClick={onClick} className={cls} data-testid={testId} {...(pressed != null ? { "aria-pressed": pressed } : {})}>{inner}</button>;
  return <div className={cls} data-testid={testId}>{inner}</div>;
}

export const ROLE_META: Record<MerchantMember["role"], { label: string; icon: LucideIcon; cls: string }> = {
  owner: { label: "Owner", icon: Crown, cls: "bg-black text-gold dark:bg-gold dark:text-ink-gold" },
  manager: { label: "Manager", icon: Briefcase, cls: "bg-blue-600/12 text-blue-700 dark:text-blue-300" },
  cashier: { label: "Cashier", icon: ScanLine, cls: "bg-green-600/12 text-green-700 dark:text-green-300" },
  finance: { label: "Finance", icon: Landmark, cls: "bg-purple-600/12 text-purple-700 dark:text-purple-300" },
};

export function Pill({ icon: Icon, children, cls, testId }: { icon?: LucideIcon; children: ReactNode; cls: string; testId?: string }) {
  return (
    <span data-testid={testId} className={`inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full px-3 py-1 text-[16px] font-black leading-tight ${cls}`}>
      {Icon && <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={2.6} />}<span className="min-w-0 break-words">{children}</span>
    </span>
  );
}

export function RolePill({ role }: { role: MerchantMember["role"] }) {
  const m = ROLE_META[role] ?? ROLE_META.cashier;
  return <Pill icon={m.icon} cls={m.cls}>{m.label}</Pill>;
}

export type KycState = "start" | "review" | "ok" | "fix" | "expired";
export function kycState(m: Merchant): KycState {
  switch (m.kyc_status) {
    case "approved": return "ok";
    case "in_review": return "review";
    case "rejected": return "fix";
    case "expired": return "expired";
    default: return "start";
  }
}
export const KYC_META: Record<KycState, { label: string; icon: LucideIcon; tone: "wait" | "ok" | "bad" | "none" }> = {
  start: { label: "Not verified", icon: Shield, tone: "none" },
  review: { label: "In review", icon: Clock, tone: "wait" },
  ok: { label: "Verified", icon: BadgeCheck, tone: "ok" },
  fix: { label: "Needs a fix", icon: CircleAlert, tone: "bad" },
  expired: { label: "Expired", icon: CircleAlert, tone: "bad" },
};

export function initials(name?: string | null) {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "?";
}

/** The signed-in user's own photo as an object URL (null when they have none). */
export function useUserPhoto(user: AuthUser | null, version = 0) {
  const [photo, setPhoto] = useState<{ key: string; url: string } | null>(null);
  const key = user?.id && user.hasProfilePhoto ? `${user.id}:${version}` : "";
  useEffect(() => {
    if (!key || !user?.id) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    api.userPhotoBlob(user.id).then((blob) => { if (cancelled) return; objectUrl = URL.createObjectURL(blob); setPhoto({ key, url: objectUrl }); }).catch(() => undefined);
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [key, user?.id]);
  return photo && photo.key === key ? photo.url : null;
}

export function Avatar({ name, photo, size = 80, ring = "border-white/85" }: { name?: string | null; photo?: string | null; size?: number; ring?: string }) {
  return photo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={photo} alt="" style={{ width: size, height: size }} className={`shrink-0 rounded-full border-[3px] object-cover ${ring}`} />
  ) : (
    <span style={{ width: size, height: size, fontSize: size * 0.37 }} className={`grid shrink-0 place-items-center rounded-full border-[3px] bg-gold font-black text-ink-gold ${ring}`}>{initials(name)}</span>
  );
}

/** A big choice card for sheets (radio look when `selected` is given). */
export function OptionCard({ icon: Icon, title, sub, selected, onClick, testId, trailing }: {
  icon: LucideIcon; title: string; sub?: string; selected?: boolean; onClick: () => void; testId?: string; trailing?: ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} data-testid={testId} {...(selected != null ? { role: "radio", "aria-checked": selected } : {})}
      className={`flex min-h-[84px] w-full min-w-0 items-center gap-3.5 rounded-[22px] border-2 px-4 py-2.5 text-left transition active:scale-[.99] ${selected ? "border-gold bg-gold/12 shadow-[0_0_0_4px_rgb(var(--gold)/0.2)]" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`}>
      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><Icon className="h-[30px] w-[30px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block break-words text-[21px] font-black leading-tight text-ink">{title}</span>
        {sub && <span className="mt-0.5 block break-words text-[16px] font-semibold leading-snug text-ink-500">{sub}</span>}
      </span>
      {trailing ?? (selected != null && <span className={`h-[34px] w-[34px] shrink-0 rounded-full ${selected ? "border-[10px] border-gold" : "border-[3px] border-[var(--border-faint)]"}`} />)}
    </button>
  );
}

/** Big tick box with a label (whole row is the target). */
export function BigCheck({ checked, onChange, children, testId }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; testId?: string }) {
  return (
    <button type="button" role="checkbox" aria-checked={checked} onClick={() => onChange(!checked)} data-testid={testId}
      className={`flex min-h-[76px] w-full items-center gap-3.5 rounded-[22px] border-2 px-4 py-3 text-left text-[18px] font-extrabold leading-snug text-ink transition ${checked ? "border-gold bg-gold/10" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`}>
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border-[3px] ${checked ? "border-gold bg-gold text-ink-gold" : "border-[var(--border-faint)] bg-[rgb(var(--surface-input))]"}`}>
        {checked && <Check className="h-6 w-6" strokeWidth={3.2} />}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </button>
  );
}

export function ErrorNote({ message }: { message: string }) {
  if (!message) return null;
  return <p role="alert" className="rounded-[18px] bg-red-600/10 px-4 py-3 text-[17px] font-bold text-red-700 dark:text-red-300">{message}</p>;
}
