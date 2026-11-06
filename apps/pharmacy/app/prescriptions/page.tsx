"use client";

import type { PharmacyPrescription, PharmacyQuoteItem } from "@peebee/shared";
import { RefreshCw } from "lucide-react";
import { TabBar } from "../../components/TabBar";
import {
  CheckCircle2,
  Clock,
  Eye,
  FileCheck,
  FileText,
  Info,
  Maximize2,
  PackageCheck,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";

const ugx = (val: number) => `UGX ${Math.round(val).toLocaleString()}`;

const timeAgo = (iso: string) => {
  const then = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
};

const STATUS_LABEL: Record<PharmacyPrescription["status"], string> = {
  pending_review: "Awaiting review",
  priced_ready: "Quote sent",
  dispensed: "Dispensed",
  declined: "Declined",
  cancelled: "Cancelled by patient",
};

type Draft = { name: string; strength: string; dosage: string; quantity: string; unitPrice: string };
const EMPTY_DRAFT: Draft = { name: "", strength: "", dosage: "", quantity: "1", unitPrice: "" };

export default function PrescriptionsWorkbenchPage() {
  const [cases, setCases] = useState<PharmacyPrescription[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"open" | "done">("open");
  const [items, setItems] = useState<PharmacyQuoteItem[]>([]);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [advice, setAdvice] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  const [slipError, setSlipError] = useState(false);
  const [showImageZoom, setShowImageZoom] = useState(false);
  const slipRef = useRef<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.getPharmacistPrescriptions();
      setCases(res.prescriptions);
    } catch (err) {
      setLoadError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = cases.filter((c) => (filter === "open" ? c.status === "pending_review" || c.status === "priced_ready" : !["pending_review", "priced_ready"].includes(c.status)));
  const active = cases.find((c) => c.id === activeId) ?? visible[0] ?? null;

  // Load the chosen case into the editor, and fetch its slip (it needs the sign-in header, so not a plain <img src>).
  useEffect(() => {
    if (!active) return;
    setItems(active.quotedItems);
    setAdvice(active.dosageInstructions || active.pharmacistNotes || "");
    setDraft(EMPTY_DRAFT);
    setSlipError(false);
    setSlipUrl(null);
    let cancelled = false;
    if (active.hasImage) {
      api
        .prescriptionImageBlob(active.id)
        .then((blob) => {
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          slipRef.current = url;
          setSlipUrl(url);
        })
        .catch(() => !cancelled && setSlipError(true));
    }
    return () => {
      cancelled = true;
      if (slipRef.current) URL.revokeObjectURL(slipRef.current);
      slipRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  const subtotal = items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
  const editable = active?.status === "pending_review" || active?.status === "priced_ready";

  function say(kind: "ok" | "error", text: string) {
    setNotice({ kind, text });
    setTimeout(() => setNotice(null), 4000);
  }

  function addLine() {
    const quantity = Number(draft.quantity);
    const unitPrice = Number(draft.unitPrice);
    if (!draft.name.trim() || !Number.isInteger(quantity) || quantity < 1 || !Number.isInteger(unitPrice) || unitPrice < 0 || draft.unitPrice === "") {
      say("error", "Enter the medicine name, a whole quantity and the price per unit.");
      return;
    }
    setItems((prev) => [
      ...prev,
      { name: draft.name.trim(), strength: draft.strength.trim() || undefined, dosage: draft.dosage.trim() || undefined, quantity, unitPrice },
    ]);
    setDraft(EMPTY_DRAFT);
  }

  async function decide(status: "priced_ready" | "declined" | "dispensed", reason?: string) {
    if (!active) return;
    setBusy(true);
    try {
      const res = await api.updatePrescriptionReview(active.id, {
        status,
        dosageInstructions: advice.trim() || undefined,
        pharmacistNotes: reason,
        quotedItems: status === "priced_ready" ? items : undefined,
      });
      setCases((prev) => prev.map((c) => (c.id === res.prescription.id ? res.prescription : c)));
      say("ok", status === "priced_ready" ? "Quote sent to the patient." : status === "dispensed" ? "Marked as dispensed." : "Prescription declined.");
    } catch (err) {
      say("error", errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full bg-transparent px-3 py-2 text-base text-ink focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-2xl font-black text-ink"><FileText className="h-7 w-7 text-gold" aria-hidden /> Prescriptions</h1>
        <button type="button" onClick={() => void load()} aria-label="Refresh" className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-faint)] text-ink"><RefreshCw className="h-6 w-6" aria-hidden /></button>
      </div>

      {notice && (
        <div className={`rounded-2xl p-3 text-base font-bold flex items-center gap-2 ${notice.kind === "ok" ? "bg-gold/15 text-ink" : "bg-red-500/10 text-red-600"}`}>
          <CheckCircle2 className={`h-4 w-4 shrink-0 ${notice.kind === "ok" ? "text-gold" : "text-red-600"}`} />
          <span>{notice.text}</span>
        </div>
      )}

      <TabBar
        label="Prescriptions"
        active={filter}
        onChange={(f) => { setFilter(f); setActiveId(null); }}
        tabs={[
          { id: "open", label: "Open", icon: Clock, count: cases.filter((c) => c.status === "pending_review").length },
          { id: "done", label: "Finished", icon: CheckCircle2 },
        ]}
      />

      {loading && <p className="text-base text-ink-500">Loading prescriptions…</p>}
      {loadError && (
        <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600">{loadError}</div>
      )}
      {!loading && !loadError && visible.length === 0 && (
        <div className="rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-6 text-center text-base text-ink-500">
          {filter === "open" ? "None waiting" : "None finished yet"}
        </div>
      )}

      {visible.length > 0 && (
        <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
          {visible.map((c) => {
            const selected = active?.id === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveId(c.id)}
                className={`flex items-center gap-2 shrink-0 rounded-2xl px-3.5 py-2 text-base font-bold transition active:scale-95 ${
                  selected ? "border border-gold bg-gold/10 text-ink shadow-sm font-black" : "border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink-500"
                }`}
              >
                <FileText className={`h-3.5 w-3.5 ${selected ? "text-gold" : "text-ink-500"}`} />
                <span>{c.customerName}</span>
                <span className="text-sm text-ink-500">({timeAgo(c.createdAt)})</span>
              </button>
            );
          })}
        </div>
      )}

      {active && (
        <div className="rounded-3xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-sm space-y-4">
          <div className="flex items-start justify-between gap-3 pb-3 border-b border-[var(--border-faint)]">
            <div>
              <span className="text-sm font-black uppercase tracking-wider text-gold">Case #{active.id.slice(-4).toUpperCase()}</span>
              <h2 className="mt-0.5 text-2xl font-black text-ink">{active.customerName}</h2>
              <p className="text-base text-ink-500 mt-0.5">
                {[active.patientAge != null ? `${active.patientAge} years` : null, active.patientGender, active.customerPhone].filter(Boolean).join(" · ")}
              </p>
              {active.deliveryAddress && <p className="text-sm text-ink-500 mt-0.5 font-medium">Deliver to: {active.deliveryAddress}</p>}
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gold/15 px-3 py-1 text-sm font-black text-gold"><Clock className="h-4 w-4" aria-hidden /> {timeAgo(active.createdAt)}</span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-ink-500 flex items-center gap-1.5">
                <Eye className="h-3.5 w-3.5 text-gold" /> Doctor slip
              </span>
              {slipUrl && (
                <button type="button" onClick={() => setShowImageZoom(true)} className="text-sm font-bold text-gold flex items-center gap-1 hover:underline">
                  <Maximize2 className="h-3 w-3" /> Full screen
                </button>
              )}
            </div>
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-[var(--border-faint)] bg-black/5">
              {slipUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={slipUrl} alt="Prescription slip" onClick={() => setShowImageZoom(true)} className="h-full w-full cursor-pointer object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-base text-ink-500">
                  {slipError ? "The slip couldn't be loaded." : active.hasImage ? "Loading slip…" : "No slip attached."}
                </div>
              )}
            </div>
          </div>

          {active.patientNotes && (
            <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-base space-y-1">
              <span className="font-bold text-ink flex items-center gap-1">
                <Info className="h-3.5 w-3.5 text-gold" /> Symptoms &amp; allergies
              </span>
              <p className="text-ink-500 leading-relaxed">{active.patientNotes}</p>
            </div>
          )}

          <div className="space-y-2 pt-2 border-t border-[var(--border-faint)]">
            <h3 className="text-base font-black text-ink uppercase tracking-wider">Quote ({items.length} {items.length === 1 ? "medicine" : "medicines"})</h3>

            {items.map((item, idx) => (
              <div key={`${item.name}-${idx}`} className="rounded-2xl border border-[var(--border-faint)] p-3 space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-base font-black text-ink">
                      {idx + 1}. {item.name} {item.quantity > 1 ? `× ${item.quantity}` : ""}
                    </h4>
                    {item.strength && <p className="text-sm text-gold font-bold">{item.strength}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-base font-black text-ink">{ugx(item.unitPrice * item.quantity)}</span>
                    {editable && (
                      <button type="button" aria-label="Remove medicine" onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))} className="text-ink-500 hover:text-red-500">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
                {item.dosage && (
                  <div className="rounded-xl bg-[rgb(var(--surface-muted))] px-2.5 py-1.5 text-sm text-ink-500">
                    <span className="font-bold text-ink">Dosage: </span>
                    {item.dosage}
                  </div>
                )}
              </div>
            ))}

            {editable && (
              <div className="rounded-2xl border border-dashed border-[var(--border-faint)] p-3 space-y-2">
                <div className="field-box rounded-xl border border-[var(--border-faint)]">
                  <input className={input} placeholder="Medicine name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="field-box rounded-xl border border-[var(--border-faint)]">
                    <input className={input} placeholder="Strength (optional)" value={draft.strength} onChange={(e) => setDraft({ ...draft, strength: e.target.value })} maxLength={40} />
                  </div>
                  <div className="field-box rounded-xl border border-[var(--border-faint)]">
                    <input className={input} placeholder="Dosage (optional)" value={draft.dosage} onChange={(e) => setDraft({ ...draft, dosage: e.target.value })} maxLength={160} />
                  </div>
                  <div className="field-box rounded-xl border border-[var(--border-faint)]">
                    <input className={input} placeholder="Quantity" inputMode="numeric" value={draft.quantity} onChange={(e) => setDraft({ ...draft, quantity: e.target.value.replace(/\D/g, "") })} />
                  </div>
                  <div className="field-box rounded-xl border border-[var(--border-faint)]">
                    <input className={input} placeholder="Price per unit (UGX)" inputMode="numeric" value={draft.unitPrice} onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value.replace(/\D/g, "") })} />
                  </div>
                </div>
                <button type="button" onClick={addLine} className="flex items-center gap-1.5 text-base font-bold text-gold hover:underline">
                  <Plus className="h-3.5 w-3.5" /> Add medicine
                </button>
              </div>
            )}

            <div className="flex items-center justify-between rounded-2xl bg-gold/10 p-3 pt-2">
              <div>
                <span className="text-base font-bold text-ink-500">Quote total</span>
                <p className="text-sm text-ink-500">Delivery of {ugx(active.deliveryFeeUgx)} is added at checkout</p>
              </div>
              <span className="font-mono text-base font-black text-ink">{ugx(subtotal)}</span>
            </div>
          </div>

          {editable && (
            <div className="space-y-1">
              <label className="text-base font-bold text-ink-500">Instructions to the patient</label>
              <div className="field-box rounded-2xl border border-[var(--border-faint)]">
                <textarea
                  rows={2}
                  value={advice}
                  maxLength={1000}
                  onChange={(e) => setAdvice(e.target.value)}
                  placeholder="e.g. Take after food. Complete all 5 days."
                  className="w-full bg-transparent p-3 text-base text-ink focus:outline-none resize-none"
                />
              </div>
            </div>
          )}

          {editable && (
            <div className="pt-2 border-t border-[var(--border-faint)] space-y-2">
              <button
                type="button"
                disabled={busy || items.length === 0}
                onClick={() => void decide("priced_ready")}
                className="flex w-full items-center justify-center gap-2 min-h-16 rounded-2xl bg-gold text-xl font-black text-ink-gold shadow transition hover:opacity-95 active:scale-98 disabled:opacity-50"
              >
                <FileCheck className="h-4 w-4" />
                {active.status === "priced_ready" ? "Update quote" : "Send quote"} ({ugx(subtotal)})
              </button>
              {active.status === "priced_ready" && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide("dispensed")}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl border border-[var(--border-faint)] py-2.5 text-base font-bold text-ink hover:bg-gold/10 disabled:opacity-50"
                >
                  <PackageCheck className="h-4 w-4 text-gold" /> Mark as dispensed
                </button>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide("declined", "Doctor slip illegible — please send a clearer photo")}
                  className="flex-1 rounded-2xl border border-[var(--border-faint)] py-2 text-sm font-bold text-ink-500 hover:text-ink disabled:opacity-50"
                >
                  Slip unclear
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void decide("declined", "This medicine needs the original paper prescription")}
                  className="flex-1 rounded-2xl border border-red-500/30 py-2 text-sm font-bold text-red-500 hover:bg-red-500/5 disabled:opacity-50"
                >
                  Controlled drug
                </button>
              </div>
            </div>
          )}

          {!editable && active.pharmacistNotes && (
            <p className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-base text-ink-500">Note: {active.pharmacistNotes}</p>
          )}
        </div>
      )}

      {showImageZoom && slipUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
          <div className="relative max-h-[90vh] max-w-2xl w-full">
            <button type="button" aria-label="Close" onClick={() => setShowImageZoom(false)} className="absolute -top-12 right-0 rounded-full bg-white/20 p-2 text-white hover:bg-white/40">
              <X className="h-6 w-6" />
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={slipUrl} alt="Prescription slip zoomed" className="max-h-[85vh] w-full rounded-2xl object-contain shadow-2xl" />
          </div>
        </div>
      )}
    </div>
  );
}
