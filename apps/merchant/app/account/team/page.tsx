"use client";

import type { MerchantMember, MerchantOutlet } from "@peebee/shared";
import { Building2, ChevronRight, IdCard, Mail, Phone, UserMinus, UserPlus, Users } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AccountFrame, ErrorNote, OptionCard, Pill, ROLE_META, RolePill, SectionLabel, initials, useBack } from "../../../components/account/AccountUI";
import { BottomSheet } from "../../../components/store/BottomSheet";
import { PageHeader, card, fieldCls, labelCls } from "../../../components/store/StoreUI";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

type StaffRole = "cashier" | "manager" | "finance";
const ROLES: { role: StaffRole; sub: string }[] = [
  { role: "cashier", sub: "Confirms sales" },
  { role: "manager", sub: "Runs outlets" },
  { role: "finance", sub: "Settles money" },
];

export default function TeamPage() {
  const { user, merchant } = useAuth();
  const back = useBack("/account");
  const [members, setMembers] = useState<MerchantMember[]>([]);
  const [outlets, setOutlets] = useState<MerchantOutlet[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<StaffRole>("cashier");
  const [outletId, setOutletId] = useState("");
  const [removing, setRemoving] = useState<MerchantMember | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheetError, setSheetError] = useState("");

  const load = useCallback(async () => {
    if (!merchant || merchant.member_role === "cashier") return;
    const [m, o] = await Promise.all([api.merchantMembers(merchant.id), api.merchantOutlets(merchant.id)]);
    setMembers(m.members); setOutlets(o.outlets); setLoaded(true);
  }, [merchant]);
  useEffect(() => { load().catch((cause) => { setError(errorMessage(cause)); setLoaded(true); }); }, [load]);

  if (!merchant) return null;
  if (merchant.member_role === "cashier") return <AccountFrame><PageHeader title="Team" onBack={back} backLabel="Back" /><ErrorNote message="Only the owner and managers can see the team." /></AccountFrame>;
  const owner = merchant.member_role === "owner";
  const outletName = (id: string | null) => (id ? outlets.find((o) => o.id === id)?.name ?? "One outlet" : "All outlets");
  const shown = members.filter((m) => m.status !== "revoked");
  const removed = members.filter((m) => m.status === "revoked");

  async function add(event: React.FormEvent) {
    event.preventDefault();
    if (!merchant) return;
    if (!identifier.trim()) { setSheetError("Type their phone or email."); return; }
    setBusy(true); setSheetError("");
    try {
      await api.addMerchantMember(merchant.id, { identifier: identifier.trim(), role, outletId: outletId || null });
      setIdentifier(""); setRole("cashier"); setOutletId(""); setAdding(false);
      await load();
    } catch (cause) { setSheetError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function remove() {
    if (!merchant || !removing) return;
    setBusy(true); setError("");
    try { await api.removeMerchantMember(merchant.id, removing.user_id); setRemoving(null); await load(); }
    catch (cause) { setError(errorMessage(cause)); setRemoving(null); } finally { setBusy(false); }
  }

  const memberCard = (m: MerchantMember) => {
    const me = m.user_id === user?.id;
    const canRemove = owner && m.role !== "owner" && m.status === "active" && !me;
    return (
      <div key={m.user_id} className={`${card} relative flex flex-col gap-3.5 p-4 ${m.status === "revoked" ? "opacity-70" : ""}`} data-testid={`member-${m.user_id}`}>
        <div className="flex items-center gap-3.5">
          <span className={`grid h-16 w-16 shrink-0 place-items-center rounded-full text-[24px] font-black ${me ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink"}`}>{initials(m.name)}</span>
          <div className="min-w-0 flex-1">
            <p className="break-words text-[21px] font-black leading-tight text-ink">{m.name}{me ? " (you)" : ""}</p>
            {(m.phone || m.email) && <p className="mt-0.5 break-all text-[16px] font-bold text-ink-500">{m.phone || m.email}</p>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <RolePill role={m.role} />
          <Pill icon={Building2} cls="bg-[rgb(var(--surface-muted))] text-ink-500">{outletName(m.outlet_id)}</Pill>
          {m.status === "invited" && <Pill icon={Mail} cls="bg-gold/20 text-[#8a6d0b] dark:text-gold" testId="member-invited">Invited</Pill>}
          {m.status === "revoked" && <Pill icon={UserMinus} cls="bg-[rgb(var(--surface-muted))] text-ink-500">Removed</Pill>}
        </div>
        {canRemove && (
          <button type="button" onClick={() => setRemoving(m)} disabled={busy} data-testid={`remove-${m.user_id}`}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full border-2 border-red-600/25 bg-red-600/[.08] text-[18px] font-black text-red-600 active:scale-[.98] dark:text-red-400">
            <UserMinus className="h-[22px] w-[22px]" strokeWidth={2.6} /> Remove
          </button>
        )}
      </div>
    );
  };

  return (
    <AccountFrame testId="team">
      <PageHeader title="Team" count={loaded ? shown.length : undefined} onBack={back} backLabel="Back" />
      <ErrorNote message={error} />
      {owner && (
        <button type="button" onClick={() => { setSheetError(""); setAdding(true); }} data-testid="add-staff"
          className="flex min-h-[72px] w-full items-center gap-3.5 rounded-[24px] bg-gold px-[18px] text-left text-[21px] font-black text-ink-gold shadow-[0_10px_26px_rgb(var(--gold)/0.35)] active:scale-[.98]">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-[16px] bg-black text-gold"><UserPlus className="h-7 w-7" strokeWidth={2.6} /></span>
          <span className="flex-1">Add staff</span><ChevronRight className="h-7 w-7" strokeWidth={3} />
        </button>
      )}
      {loaded && shown.length === 0 && (
        <div className="flex flex-col items-center gap-2.5 rounded-[30px] border-2 border-dashed border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-4 py-8 text-center">
          <span className="grid h-24 w-24 place-items-center rounded-[30px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><Users className="h-12 w-12" /></span>
          <p className="text-[22px] font-black text-ink">No staff yet</p>
        </div>
      )}
      {shown.map(memberCard)}
      {removed.length > 0 && <><SectionLabel>Removed</SectionLabel>{removed.map(memberCard)}</>}

      {adding && (
        <BottomSheet title="Add staff" subtitle="Must have a Peebee account" onClose={() => setAdding(false)} testId="add-staff-sheet"
          footer={<button type="submit" form="add-staff-form" disabled={busy} data-testid="add-staff-save"
            className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full bg-gold text-[20px] font-black text-ink-gold shadow-[0_8px_22px_rgb(var(--gold)/0.35)] active:scale-[.98] disabled:opacity-50">
            <UserPlus className="h-6 w-6" strokeWidth={2.6} /> {busy ? "Adding…" : "Add staff"}</button>}>
          <form id="add-staff-form" onSubmit={add} className="space-y-5 pt-1">
            <div>
              <label htmlFor="staff-identifier" className={labelCls}><Phone className="h-5 w-5 text-gold" /> Phone or email</label>
              <input id="staff-identifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="07… or name@mail.com" autoComplete="off" className={fieldCls} data-testid="staff-identifier" />
            </div>
            <div>
              <p className={labelCls}><IdCard className="h-5 w-5 text-gold" /> Role</p>
              <div className="space-y-2.5" role="radiogroup" aria-label="Staff role">
                {ROLES.map((r) => <OptionCard key={r.role} icon={ROLE_META[r.role].icon} title={ROLE_META[r.role].label} sub={r.sub} selected={role === r.role} onClick={() => setRole(r.role)} testId={`role-${r.role}`} />)}
              </div>
            </div>
            <div>
              <p className={labelCls}><Building2 className="h-5 w-5 text-gold" /> Outlet</p>
              <div className="space-y-2.5" role="radiogroup" aria-label="Outlet">
                <OptionCard icon={Building2} title="All outlets" selected={outletId === ""} onClick={() => setOutletId("")} testId="outlet-all" />
                {outlets.map((o) => <OptionCard key={o.id} icon={Building2} title={o.name} selected={outletId === o.id} onClick={() => setOutletId(o.id)} testId={`outlet-${o.id}`} />)}
              </div>
            </div>
            <ErrorNote message={sheetError} />
          </form>
        </BottomSheet>
      )}

      {removing && (
        <BottomSheet title="Remove staff?" subtitle="They lose access now" onClose={() => setRemoving(null)} testId="remove-sheet">
          <div className="space-y-3 pt-1">
            <div className={`${card} flex items-center gap-3.5 p-4`}>
              <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[rgb(var(--surface-muted))] text-[24px] font-black text-ink">{initials(removing.name)}</span>
              <div className="min-w-0"><p className="break-words text-[21px] font-black text-ink">{removing.name}</p><p className="text-[16px] font-bold text-ink-500">{ROLE_META[removing.role].label} · {outletName(removing.outlet_id)}</p></div>
            </div>
            <button type="button" onClick={remove} disabled={busy} data-testid="remove-confirm"
              className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-full bg-red-600 text-[21px] font-black text-white active:scale-[.98] disabled:opacity-50"><UserMinus className="h-6 w-6" strokeWidth={2.6} /> {busy ? "Removing…" : "Remove"}</button>
            <button type="button" onClick={() => setRemoving(null)} data-testid="remove-keep"
              className="flex min-h-[68px] w-full items-center justify-center rounded-full bg-black text-[21px] font-black text-white active:scale-[.98] dark:border-2 dark:border-white/20">Keep</button>
          </div>
        </BottomSheet>
      )}
    </AccountFrame>
  );
}
