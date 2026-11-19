"use client";

import { Camera, Check, FileText, Hash, Image as ImageIcon, Lock, Pencil, Receipt, RefreshCw, Search, Send, type LucideIcon, BadgeCheck, IdCard, Landmark } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AccountFrame, BigCheck, ErrorNote, KYC_META, OptionCard, SectionLabel, kycState, readFlash, setFlash, useBack, type KycState } from "../../../components/account/AccountUI";
import { BottomSheet } from "../../../components/store/BottomSheet";
import { PageHeader, card, fieldCls, labelCls } from "../../../components/store/StoreUI";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

type DocType = "owner-id" | "business-registration";
const DOCS: { type: DocType; title: string; hint: string; icon: LucideIcon }[] = [
  { type: "owner-id", title: "Owner ID", hint: "National ID, front side", icon: IdCard },
  { type: "business-registration", title: "Business papers", hint: "URSB certificate", icon: Landmark },
];
const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

const HERO: Record<KycState, { title: string; sub: string; icon: LucideIcon; box: string; border: string }> = {
  start: { title: "Not verified yet", sub: "3 quick steps", icon: KYC_META.start.icon, box: "bg-white/12 text-white", border: "border-gold/50" },
  review: { title: "In review", sub: "We'll tell you when done", icon: KYC_META.review.icon, box: "bg-gold text-ink-gold", border: "border-gold/50" },
  ok: { title: "Verified", sub: "Your business is approved", icon: BadgeCheck, box: "bg-[#22c55e] text-white", border: "border-gold/50" },
  fix: { title: "Needs a fix", sub: "Check and send again", icon: KYC_META.fix.icon, box: "bg-red-600 text-white", border: "border-red-600/60" },
  expired: { title: "Expired", sub: "Send your details again", icon: KYC_META.expired.icon, box: "bg-red-600 text-white", border: "border-red-600/60" },
};

function Tracker({ step }: { step: number }) {
  const steps: { icon: LucideIcon; label: string }[] = [{ icon: Send, label: "Sent" }, { icon: Search, label: "Review" }, { icon: BadgeCheck, label: "Verified" }];
  const bar = step <= 0 ? "0%" : step === 1 ? "33.4%" : "66.8%";
  return (
    <div className="relative grid grid-cols-3" data-testid="kyc-tracker" aria-label={`Step ${Math.min(step + 1, 3)} of 3`}>
      <span aria-hidden className="absolute left-[16.6%] right-[16.6%] top-[22px] h-1 rounded bg-white/20" />
      <span aria-hidden className="absolute left-[16.6%] top-[22px] h-1 rounded bg-gold" style={{ width: bar }} />
      {steps.map((s, i) => {
        const done = i < step || step >= 3;
        const now = i === step && step < 3;
        const Icon = done ? Check : s.icon;
        return (
          <div key={s.label} className={`relative flex flex-col items-center gap-2 text-center text-[16px] font-extrabold ${done ? "text-white" : now ? "text-gold" : "text-white/60"}`} aria-current={now ? "step" : undefined}>
            <span className={`grid h-12 w-12 place-items-center rounded-full border-[3px] ${done ? "border-gold bg-gold text-ink-gold" : now ? "border-gold bg-black text-gold shadow-[0_0_0_6px_rgb(var(--gold)/0.25)]" : "border-white/25 bg-[#1f1f1f] text-white/60"}`}>
              <Icon className="h-6 w-6" strokeWidth={2.8} />
            </span>
            {s.label}
          </div>
        );
      })}
    </div>
  );
}

export default function VerificationPage() {
  const { merchant, refreshMerchants } = useAuth();
  const back = useBack("/account");
  const [registrationNumber, setRegistrationNumber] = useState(merchant?.registration_number ?? "");
  const [taxId, setTaxId] = useState(merchant?.tax_id ?? "");
  const [files, setFiles] = useState<Record<DocType, File | null>>({ "owner-id": null, "business-registration": null });
  const [previews, setPreviews] = useState<Record<DocType, string | null>>({ "owner-id": null, "business-registration": null });
  const [picking, setPicking] = useState<DocType | null>(null);
  const [declared, setDeclared] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Refreshing the business list can remount this page, so the "Sent" note is kept for one showing.
  const [sent, setSent] = useState(() => readFlash("kyc") === "sent");
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setRegistrationNumber(merchant?.registration_number ?? ""); setTaxId(merchant?.tax_id ?? ""); }, [merchant?.registration_number, merchant?.tax_id]);
  const madeUrls = useRef<string[]>([]);
  useEffect(() => () => { madeUrls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  if (!merchant) return null;
  if (merchant.member_role === "cashier") return <AccountFrame><PageHeader title="Verification" onBack={back} backLabel="Back" /><ErrorNote message="Only the owner and managers can see this." /></AccountFrame>;

  const state = kycState(merchant);
  const hero = HERO[state];
  const step = state === "ok" ? 3 : state === "start" ? 0 : 1;
  const readOnly = state === "ok" && !editing;
  const has: Record<DocType, boolean> = { "owner-id": !!merchant.has_owner_id_document, "business-registration": !!merchant.has_business_document };

  function choose(file: File | undefined) {
    if (!file || !picking) return;
    if (!ACCEPT.split(",").includes(file.type)) { setError("Use a photo (JPEG, PNG, WebP) or a PDF."); return; }
    setError("");
    const doc = picking;
    setFiles((f) => ({ ...f, [doc]: file }));
    const url = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    if (url) madeUrls.current.push(url);
    setPreviews((p) => ({ ...p, [doc]: url }));
    setPicking(null);
  }

  async function submit() {
    if (!merchant) return;
    if (!registrationNumber.trim() || !taxId.trim()) { setError("Fill in the URSB number and the URA TIN."); return; }
    if (!has["owner-id"] && !files["owner-id"]) { setError("Add the business owner's National ID."); return; }
    if (!has["business-registration"] && !files["business-registration"]) { setError("Add the business registration document."); return; }
    if (!declared) { setError("Tick the box to confirm the details are true."); return; }
    setBusy(true); setError("");
    try {
      await api.submitMerchantKyc(merchant.id, { registrationNumber: registrationNumber.trim(), taxId: taxId.trim() });
      for (const d of DOCS) { const f = files[d.type]; if (f) await api.uploadMerchantKycDocument(merchant.id, d.type, f); }
      setFiles({ "owner-id": null, "business-registration": null });
      setPreviews({ "owner-id": null, "business-registration": null });
      setDeclared(false); setEditing(false); setSent(true);
      setFlash("kyc", "sent");
      await refreshMerchants();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <AccountFrame testId="verification">
      <PageHeader title="Verification" onBack={back} backLabel="Back" />

      <section className={`relative flex flex-col gap-[18px] overflow-hidden rounded-[30px] border-[1.5px] ${hero.border} bg-[#0a0a0a] p-5 text-white`} data-testid={`kyc-${state}`}>
        <div aria-hidden className="pointer-events-none absolute -right-[60px] -top-[60px] h-[200px] w-[200px] rounded-full bg-[radial-gradient(circle,rgb(var(--gold)/0.4),transparent_70%)]" />
        <div className="relative flex items-center gap-3.5">
          <span className={`grid h-[72px] w-[72px] shrink-0 place-items-center rounded-[24px] ${hero.box}`}><hero.icon className="h-9 w-9" /></span>
          <div className="min-w-0"><h2 className="text-[26px] font-black leading-tight">{hero.title}</h2><p className="mt-0.5 text-[17px] font-bold text-white/70">{hero.sub}</p></div>
        </div>
        <Tracker step={step} />
      </section>

      {sent && state === "review" && <p className="flex items-center gap-2.5 rounded-[18px] bg-green-600/12 px-4 py-3 text-[17px] font-black text-green-700 dark:text-green-300" role="status" data-testid="kyc-sent"><Check className="h-6 w-6" strokeWidth={3} /> Sent for review</p>}

      <SectionLabel>Details</SectionLabel>
      <div className={`${card} space-y-4 p-4`}>
        <div>
          <label htmlFor="registration-number" className={labelCls}><Hash className="h-5 w-5 text-gold" /> URSB number</label>
          <input id="registration-number" value={registrationNumber} readOnly={readOnly} onChange={(e) => setRegistrationNumber(e.target.value)} placeholder="e.g. 80020001234567" inputMode="text" autoComplete="off" className={`${fieldCls} ${readOnly ? "opacity-80" : ""}`} data-testid="kyc-reg" />
        </div>
        <div>
          <label htmlFor="tax-id" className={labelCls}><Receipt className="h-5 w-5 text-gold" /> URA TIN</label>
          <input id="tax-id" value={taxId} readOnly={readOnly} onChange={(e) => setTaxId(e.target.value)} placeholder="e.g. 1000123456" inputMode="numeric" autoComplete="off" className={`${fieldCls} ${readOnly ? "opacity-80" : ""}`} data-testid="kyc-tin" />
        </div>
      </div>

      <SectionLabel>Photos</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        {DOCS.map((d) => {
          const file = files[d.type];
          const preview = previews[d.type];
          const done = !!file || has[d.type];
          if (!done) {
            return (
              <button key={d.type} type="button" disabled={readOnly} onClick={() => setPicking(d.type)} data-testid={`doc-${d.type}`}
                className="flex min-h-[200px] min-w-0 flex-col items-center justify-center gap-2.5 rounded-[24px] border-2 border-dashed border-gold/70 bg-gold/[.07] px-2.5 py-3.5 text-center active:scale-[.98]">
                <span className="grid h-16 w-16 place-items-center rounded-[20px] bg-gold text-ink-gold"><Camera className="h-8 w-8" /></span>
                <span className="block break-words text-[18px] font-black leading-tight text-ink">{d.title}</span>
                <span className="block text-[15px] font-bold text-ink-500">Tap to add</span>
              </button>
            );
          }
          return (
            <div key={d.type} className={`${card} relative flex min-h-[200px] min-w-0 flex-col items-center gap-2.5 p-2.5 text-center`} data-testid={`doc-${d.type}`}>
              <span className="absolute -right-2 -top-3 z-[2] grid h-[42px] w-[42px] place-items-center rounded-full border-[3px] border-[rgb(var(--cream))] bg-[#16a34a] text-white" data-testid={`doc-${d.type}-ok`}><Check className="h-6 w-6" strokeWidth={3.2} /></span>
              {preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="" className="h-[104px] w-full rounded-[16px] object-cover" />
              ) : (
                <span className="flex h-[104px] w-full flex-col items-center justify-center gap-1 rounded-[16px] bg-[rgb(var(--surface-muted))] px-2 text-ink-500">
                  {file ? <FileText className="h-10 w-10" /> : <d.icon className="h-10 w-10" />}
                  <span className="line-clamp-1 max-w-full break-all text-[15px] font-bold">{file ? file.name : "Sent"}</span>
                </span>
              )}
              <span className="block break-words text-[18px] font-black leading-tight text-ink">{d.title}</span>
              {!readOnly && (
                <button type="button" onClick={() => setPicking(d.type)} data-testid={`doc-${d.type}-change`}
                  className="mt-auto flex min-h-14 w-full items-center justify-center gap-2 rounded-[16px] bg-[rgb(var(--surface-muted))] text-[17px] font-black text-ink active:scale-[.98]">
                  <RefreshCw className="h-5 w-5" /> Change
                </button>
              )}
            </div>
          );
        })}
      </div>

      <ErrorNote message={error} />

      {readOnly ? (
        <button type="button" onClick={() => setEditing(true)} data-testid="kyc-edit"
          className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-full bg-black text-[21px] font-black text-white active:scale-[.98] dark:border-2 dark:border-gold/50">
          <Pencil className="h-6 w-6" /> My details changed
        </button>
      ) : (
        <>
          <BigCheck checked={declared} onChange={setDeclared} testId="kyc-declare">These details are true</BigCheck>
          <button type="button" onClick={submit} disabled={busy} data-testid="kyc-submit"
            className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-full bg-gold text-[21px] font-black text-ink-gold shadow-[0_8px_22px_rgb(var(--gold)/0.35)] active:scale-[.98] disabled:opacity-50">
            <Send className="h-6 w-6" /> {busy ? "Sending securely…" : "Send for review"}
          </button>
        </>
      )}
      <p className="flex items-center justify-center gap-2.5 text-[16px] font-extrabold text-ink-500"><Lock className="h-[18px] w-[18px]" /> Only Peebee reviewers see these</p>

      <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-camera" />
      <input ref={galleryRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-gallery" />
      <input ref={pdfRef} type="file" accept="application/pdf" hidden onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} data-testid="input-pdf" />

      {picking && (
        <BottomSheet title={DOCS.find((d) => d.type === picking)!.title} subtitle={DOCS.find((d) => d.type === picking)!.hint} onClose={() => setPicking(null)} testId="doc-sheet">
          <div className="space-y-3 pt-1">
            <OptionCard icon={Camera} title="Take a photo" onClick={() => cameraRef.current?.click()} testId="doc-camera" />
            <OptionCard icon={ImageIcon} title="From gallery" onClick={() => galleryRef.current?.click()} testId="doc-gallery" />
            <OptionCard icon={FileText} title="PDF file" onClick={() => pdfRef.current?.click()} testId="doc-pdf" />
          </div>
        </BottomSheet>
      )}
    </AccountFrame>
  );
}
