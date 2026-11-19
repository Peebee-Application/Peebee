"use client";

import type { MerchantMember } from "@peebee/shared";
import { ArrowLeftRight, Building2, Check, ChevronRight, FileText, LifeBuoy, LogOut, Settings, ShieldCheck, Store as StoreIcon, UserRound, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AccountFrame, Avatar, ErrorNote, KYC_META, Pill, RolePill, kycState, useUserPhoto } from "../../components/account/AccountUI";
import { BottomSheet } from "../../components/store/BottomSheet";
import { HubTile, card } from "../../components/store/StoreUI";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { useModules } from "../../lib/modules";

const TONE: Record<string, string> = {
  wait: "bg-gold/25 text-gold",
  ok: "bg-green-500/20 text-[#5fe0a0]",
  bad: "bg-red-600/25 text-[#ff8a8a]",
  none: "bg-white/15 text-white",
};

export default function AccountPage() {
  const { user, merchant, merchants, selectMerchant, logout } = useAuth();
  const router = useRouter();
  const moduleOn = useModules();
  const photo = useUserPhoto(user);
  const [members, setMembers] = useState<MerchantMember[]>([]);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState("");

  const cashier = merchant?.member_role === "cashier";
  useEffect(() => {
    if (!merchant || merchant.member_role === "cashier") return;
    api.merchantMembers(merchant.id).then((r) => setMembers(r.members)).catch((cause) => setError(errorMessage(cause)));
  }, [merchant]);

  if (!merchant) return null;
  const kyc = KYC_META[kycState(merchant)];
  const marketplace = moduleOn("buy.marketplace");
  const go = (path: string) => () => router.push(path);
  const activeMembers = cashier ? 0 : members.filter((m) => m.status !== "revoked").length;
  const kycSubTone = kyc.tone === "ok" ? "text-[#15803d] dark:text-[#4ade80]" : kyc.tone === "bad" ? "text-red-600 dark:text-red-400" : kyc.tone === "wait" ? "text-[#8a6d0b] dark:text-gold" : "text-ink-500";

  return (
    <AccountFrame testId="account-home">
      <h1 className="px-1 text-[30px] font-black leading-tight text-ink">Account</h1>
      <ErrorNote message={error} />

      <section className="relative flex flex-col gap-4 overflow-hidden rounded-[32px] border-[1.5px] border-gold/45 bg-[#0a0a0a] p-[18px] text-white shadow-[0_14px_40px_rgb(0_0_0/.25)]" data-testid="account-hero">
        <div aria-hidden className="pointer-events-none absolute -right-[70px] -top-[70px] h-[220px] w-[220px] rounded-full bg-[radial-gradient(circle,rgb(var(--gold)/0.45),transparent_70%)]" />
        <div className="relative flex items-center gap-3.5">
          <Avatar name={user?.name} photo={photo} />
          <div className="min-w-0 flex-1">
            <p className="break-words text-[25px] font-black leading-tight" data-testid="account-name">{user?.name}</p>
            <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[17px] font-bold text-white/75"><StoreIcon className="h-[18px] w-[18px] shrink-0" /><span className="min-w-0 break-words">{merchant.display_name}</span></p>
            <div className="mt-2 flex flex-wrap gap-2">
              {merchant.member_role && (merchant.member_role === "owner" ? <RolePill role="owner" /> : <Pill cls="bg-white/15 text-white">{merchant.member_role[0].toUpperCase() + merchant.member_role.slice(1)}</Pill>)}
              {!cashier && <Pill icon={kyc.icon} cls={TONE[kyc.tone]} testId="account-kyc-pill">{kyc.label}</Pill>}
            </div>
          </div>
        </div>
        {merchants.length > 1 && (
          <button type="button" onClick={() => setSwitching(true)} data-testid="switch-business"
            className="relative flex min-h-[60px] items-center justify-center gap-2.5 rounded-[18px] border-[1.5px] border-white/20 bg-white/10 text-[18px] font-black text-white active:scale-[.98]">
            <ArrowLeftRight className="h-[22px] w-[22px]" /> Switch business
          </button>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3" data-testid="account-tiles">
        {!cashier && (
          <button type="button" onClick={go("/account/verification")} data-testid="tile-verification"
            className={`${card} relative flex min-h-[132px] min-w-0 flex-col items-start justify-between gap-3 p-4 text-left transition active:scale-[.98]`}>
            <span className="grid h-14 w-14 place-items-center rounded-[18px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><ShieldCheck className="h-[30px] w-[30px]" /></span>
            <span className="block min-w-0 max-w-full">
              <span className="block break-words text-[20px] font-black leading-tight text-ink">Verification</span>
              <span className={`mt-0.5 flex items-center gap-1.5 text-[16px] font-black ${kycSubTone}`}><kyc.icon className="h-4 w-4 shrink-0" strokeWidth={2.6} />{kyc.label}</span>
            </span>
          </button>
        )}
        {!cashier && <HubTile icon={Users} title="Team" sub="Staff & roles" badge={activeMembers || undefined} onClick={go("/account/team")} testId="tile-team" />}
        <HubTile icon={UserRound} title="My profile" sub="Name & photo" onClick={go("/account/profile")} testId="tile-profile" />
        {marketplace && <HubTile icon={Building2} title="Outlets" sub="Pay codes" onClick={go("/outlets")} testId="tile-outlets" />}
        {!cashier && marketplace && <HubTile icon={FileText} title="Statements" sub="Money reports" onClick={go("/reports")} testId="tile-statements" />}
        <HubTile icon={Settings} title="App settings" sub={cashier ? "Look & practice" : "Look & help"} onClick={go("/account/settings")} testId="tile-settings" />
        <button type="button" onClick={go("/help")} data-testid="tile-help"
          className={`${card} col-span-2 flex min-h-[92px] min-w-0 items-center gap-3.5 p-4 text-left transition active:scale-[.98]`}>
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><LifeBuoy className="h-[30px] w-[30px]" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[20px] font-black leading-tight text-ink">Help &amp; support</span><span className="block text-[16px] font-semibold text-ink-500">Chat with us</span></span>
          <ChevronRight className="h-[30px] w-[30px] shrink-0 text-gold" strokeWidth={3} />
        </button>
      </div>

      <button type="button" onClick={logout} data-testid="logout"
        className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-full border-[2.5px] border-red-600/45 text-[21px] font-black text-red-600 active:scale-[.98] dark:text-red-400">
        <LogOut className="h-6 w-6" strokeWidth={2.6} /> Log out
      </button>

      {switching && (
        <BottomSheet title="Switch business" subtitle="Pick one" onClose={() => setSwitching(false)} testId="switch-sheet">
          <div className="space-y-3 pt-1" role="radiogroup" aria-label="Current business">
            {merchants.map((m) => {
              const on = m.id === merchant.id;
              return (
                <button key={m.id} type="button" role="radio" aria-checked={on} data-testid={`business-${m.id}`}
                  onClick={() => { selectMerchant(m.id); setSwitching(false); }}
                  className={`flex min-h-[84px] w-full min-w-0 items-center gap-3.5 rounded-[22px] border-2 px-4 py-2.5 text-left ${on ? "border-gold bg-gold/12" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"}`}>
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-[16px] bg-gold/15 text-[#8a6d0b] dark:text-gold"><StoreIcon className="h-7 w-7" /></span>
                  <span className="min-w-0 flex-1"><span className="block break-words text-[20px] font-black leading-tight text-ink">{m.display_name}</span>
                    {m.member_role && <span className="block text-[16px] font-semibold capitalize text-ink-500">{m.member_role}</span>}</span>
                  <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[12px] border-[3px] ${on ? "border-gold bg-gold text-ink-gold" : "border-[var(--border-faint)]"}`}>{on && <Check className="h-6 w-6" strokeWidth={3.2} />}</span>
                </button>
              );
            })}
          </div>
        </BottomSheet>
      )}
    </AccountFrame>
  );
}
