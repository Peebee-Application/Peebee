"use client";

import Link from "next/link";

import { Select } from "@peebee/shared/select";

import type { MerchantMember, MerchantOutlet } from "@peebee/shared";
import { Building2, LogOut, Settings, ShieldCheck, UserPlus, LifeBuoy, ChevronRight, FileText } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { AppearanceSettings } from "../../components/AppearanceSettings";
import { TabBar } from "../../components/TabBar";
import { PracticeModeCard } from "../../components/PracticeMode";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function AccountPage() {
  const { user, merchant, merchants, selectMerchant, refreshMerchants, logout } = useAuth();
  const [members, setMembers] = useState<MerchantMember[]>([]);
  const [outlets, setOutlets] = useState<MerchantOutlet[]>([]);
  const [registrationNumber, setRegistrationNumber] = useState(merchant?.registration_number ?? "");
  const [taxId, setTaxId] = useState(merchant?.tax_id ?? "");
  const [identifier, setIdentifier] = useState("");
  const [role, setRole] = useState<"finance" | "manager" | "cashier">("cashier");
  const [outletId, setOutletId] = useState("");
  const [ownerIdDocument, setOwnerIdDocument] = useState<File | null>(null);
  const [businessDocument, setBusinessDocument] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"business" | "team" | "settings" | null>(null);

  const load = useCallback(async () => { if (!merchant) return; if (merchant.member_role === "cashier") { setOutlets((await api.merchantOutlets(merchant.id)).outlets); setMembers([]); return; } const [m, o] = await Promise.all([api.merchantMembers(merchant.id), api.merchantOutlets(merchant.id)]); setMembers(m.members); setOutlets(o.outlets); }, [merchant]);
  useEffect(() => { setRegistrationNumber(merchant?.registration_number ?? ""); setTaxId(merchant?.tax_id ?? ""); load().catch((cause) => setError(errorMessage(cause))); }, [load, merchant]);

  async function submitKyc(event: React.FormEvent) { event.preventDefault(); if (!merchant) return; if (!merchant.has_owner_id_document && !ownerIdDocument) { setError("Upload the business owner's National ID."); return; } if (!merchant.has_business_document && !businessDocument) { setError("Upload the business registration document."); return; } setBusy(true); setError(""); try { await api.submitMerchantKyc(merchant.id, { registrationNumber, taxId }); if (ownerIdDocument) await api.uploadMerchantKycDocument(merchant.id, "owner-id", ownerIdDocument); if (businessDocument) await api.uploadMerchantKycDocument(merchant.id, "business-registration", businessDocument); setOwnerIdDocument(null); setBusinessDocument(null); await refreshMerchants(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function addMember(event: React.FormEvent) { event.preventDefault(); if (!merchant) return; setBusy(true); setError(""); try { await api.addMerchantMember(merchant.id, { identifier, role, outletId: outletId || null }); setIdentifier(""); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }
  async function remove(userId: string) { if (!merchant) return; setBusy(true); try { await api.removeMerchantMember(merchant.id, userId); await load(); } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); } }

  if (!merchant) return null;
  const cashier = merchant.member_role === "cashier";
  const activeTab = cashier ? "settings" : tab ?? "business";
  return <div className="space-y-4 px-4 pb-6 pt-5">
    <header><h1 className="text-3xl font-black">Account</h1><p className="text-lg text-ink-500">{user?.name} · {merchant.member_role}</p></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    {!cashier && <TabBar label="Account" active={activeTab} onChange={setTab} tabs={[{ id: "business", label: "Business", icon: Building2 }, { id: "team", label: "Team", icon: UserPlus, count: members.length }, { id: "settings", label: "Settings", icon: Settings }]} />}

    {activeTab === "business" && <div className="space-y-4" role="tabpanel" aria-label="Business">
    {merchants.length > 1 && <section className="home-card space-y-2"><label className="text-xs font-bold text-ink-500">Current business</label><Select aria-label="Current business" value={merchant.id} onValueChange={(value) => selectMerchant(value)} className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3">{merchants.map((m) => <option key={m.id} value={m.id}>{m.display_name}</option>)}</Select></section>}
    {merchant.member_role !== "cashier" && <section className="home-card space-y-3"><div className="flex items-start gap-3"><ShieldCheck className="h-6 w-6 shrink-0 text-gold"/><div><h2 className="font-bold">Business verification</h2><p className="text-xs text-ink-500">Update these details only when your business information changes. Submitting requests a new review. Status: {merchant.kyc_status?.replaceAll("_", " ") ?? "pending"}. Documents are private and available only to authorized Peebee reviewers.</p></div></div><form onSubmit={submitKyc} className="space-y-2"><label htmlFor="registration-number" className="block text-sm font-bold">URSB registration number</label><input id="registration-number" required value={registrationNumber} onChange={(e) => setRegistrationNumber(e.target.value)} placeholder="URSB registration number" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/><label htmlFor="tax-id" className="block text-sm font-bold">URA TIN / tax identifier</label><input id="tax-id" required value={taxId} onChange={(e) => setTaxId(e.target.value)} placeholder="URA TIN / tax identifier" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/><label className="block rounded-xl border border-[var(--border-faint)] p-3 text-xs"><span className="mb-2 block font-bold">Owner National ID {merchant.has_owner_id_document ? "✓ uploaded" : ""}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setOwnerIdDocument(e.target.files?.[0] ?? null)}/></label><label className="block rounded-xl border border-[var(--border-faint)] p-3 text-xs"><span className="mb-2 block font-bold">Business registration document {merchant.has_business_document ? "✓ uploaded" : ""}</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setBusinessDocument(e.target.files?.[0] ?? null)}/></label><label className="flex gap-2 text-xs text-ink-500"><input required type="checkbox"/>I declare that these business details and documents are accurate and authorized.</label><button disabled={busy} className="min-h-11 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Uploading securely…" : "Submit for verification"}</button></form></section>}
      <Link href="/reports" className="home-card flex min-h-16 items-center gap-3 !rounded-2xl text-lg font-bold text-ink"><FileText className="h-6 w-6 text-gold" aria-hidden /><span className="flex-1">Financial statements</span><ChevronRight className="h-6 w-6 shrink-0 text-ink-500" aria-hidden /></Link>
    </div>}

    {activeTab === "team" && <div className="space-y-4" role="tabpanel" aria-label="Team">
    {merchant.member_role !== "cashier" && <section className="home-card space-y-3"><div className="flex gap-3"><UserPlus className="h-6 w-6 shrink-0 text-gold"/><div><h2 className="font-bold">Team access</h2><p className="text-xs text-ink-500">Cashiers confirm sales; finance can settle; managers operate outlets. Only owners manage staff.</p></div></div>{members.map((member) => <div key={member.user_id} className="flex justify-between gap-3 border-t border-[var(--border-faint)] pt-3 text-sm"><span><span className="block font-semibold">{member.name}</span><span className="text-xs text-ink-500">{member.role} · {member.status}</span></span>{merchant.member_role === "owner" && member.role !== "owner" && member.status === "active" && <button disabled={busy} onClick={() => remove(member.user_id)} className="text-xs font-bold text-red-600">Remove</button>}</div>)}{merchant.member_role === "owner" && <form onSubmit={addMember} className="space-y-2 border-t border-[var(--border-faint)] pt-3"><input required value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="Staff email or phone" className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] px-3"/><div className="grid grid-cols-2 gap-2"><Select aria-label="Staff role" value={role} onValueChange={(value) => setRole(value as typeof role)} className="min-h-11 rounded-xl border border-[var(--border-faint)] px-3"><option value="cashier">Cashier</option><option value="manager">Manager</option><option value="finance">Finance</option></Select><Select aria-label="Outlet" value={outletId} onValueChange={(value) => setOutletId(value)} className="min-h-11 rounded-xl border border-[var(--border-faint)] px-3"><option value="">All outlets</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</Select></div><button disabled={busy} className="min-h-11 w-full rounded-full border border-gold font-bold text-gold">Add existing Peebee user</button></form>}</section>}
    </div>}

    {activeTab === "settings" && <div className="space-y-4" role="tabpanel" aria-label="Settings">
      <Link href="/help" className="home-card flex min-h-16 items-center gap-3 !rounded-2xl text-lg font-bold text-ink">
        <LifeBuoy className="h-6 w-6 text-gold" strokeWidth={1.75} aria-hidden />
        <span className="flex-1">Help &amp; support</span>
        <ChevronRight className="h-6 w-6 shrink-0 text-ink-500" strokeWidth={1.75} aria-hidden />
      </Link>
      <PracticeModeCard role="merchant" />
      <AppearanceSettings />
      <button onClick={logout} className="flex min-h-14 w-full items-center justify-center gap-2 rounded-full border border-red-300 text-lg font-bold text-red-600"><LogOut className="h-5 w-5" aria-hidden />Log out</button>
    </div>}
  </div>;
}
