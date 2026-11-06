"use client";

import type { FeeInvoice, StudioSchool } from "@peebee/shared";
import { Plus, Receipt } from "lucide-react";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";
import { Button, Chip, Crumbs, EmptyState, Field, Notice, Skeleton, cardCls, controlCls } from "../../../../components/ui";
import { api, errorMessage } from "../../../../lib/api";
import { useStudioSettings } from "../../../../lib/studio-config";
import { formatMoney } from "../../../../lib/streams";

const STATUS: Record<FeeInvoice["status"], { label: string; tone: "muted" | "gold" | "green" }> = {
  unpaid: { label: "Unpaid", tone: "gold" },
  partial: { label: "Part paid", tone: "gold" },
  paid: { label: "Paid", tone: "green" },
  cancelled: { label: "Cancelled", tone: "muted" },
};

export default function FeesPage() {
  const { id } = useParams<{ id: string }>();
  const settings = useStudioSettings();
  const fid = useId();
  const [school, setSchool] = useState<StudioSchool | null>(null);
  const [invoices, setInvoices] = useState<FeeInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [student, setStudent] = useState("");
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([api.studioSchool(id), api.studioInvoices(id)]);
      setSchool(s.school);
      setInvoices(list.invoices);
      setError(null);
    } catch (err) {
      setInvoices([]);
      setError(errorMessage(err));
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    const amountUgx = Number(amount);
    if (!Number.isInteger(amountUgx) || amountUgx < 1) return setFormError("Enter the amount as a whole number of shillings.");
    setBusy(true);
    setFormError(null);
    try {
      await api.studioCreateInvoice(id, { student: student.trim(), title: title.trim(), amountUgx, dueDate });
      setStudent("");
      setTitle("");
      setAmount("");
      setDueDate("");
      setCreating(false);
      setNotice("Invoice sent. The learner can pay it from their Peebee wallet.");
      await load();
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancel(invoice: FeeInvoice) {
    if (!window.confirm(`Cancel “${invoice.title}” for ${invoice.studentName}?`)) return;
    try {
      await api.studioCancelInvoice(invoice.id);
      setNotice("Invoice cancelled.");
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (invoices === null) return <Skeleton className="h-64" />;
  const totalOwed = invoices.filter((i) => i.status !== "cancelled").reduce((n, i) => n + i.balanceUgx, 0);
  const totalPaid = invoices.reduce((n, i) => n + i.paidUgx, 0);

  return (
    <div className="space-y-5 pb-6">
      <Crumbs items={[{ label: "Schools", href: "/schools" }, { label: school?.name ?? "School", href: `/schools/${id}` }, { label: "Fees" }]} />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-base font-bold uppercase tracking-wider text-gold">School fees</p>
          <h2 className="font-display text-2xl font-semibold text-ink">Invoices</h2>
          <p className="text-lg text-ink-500">Learners pay from their Peebee wallet. Peebee keeps {settings.commissionPercent}% of each payment.</p>
        </div>
        {!creating && settings.feesEnabled && school?.status !== "suspended" && (
          <Button onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" aria-hidden /> New invoice
          </Button>
        )}
      </header>

      {!settings.feesEnabled && <Notice tone="info">School fees are switched off right now, so new invoices can&apos;t be sent.</Notice>}
      {notice && (
        <Notice tone="success" onClose={() => setNotice(null)}>
          {notice}
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <section className="grid grid-cols-2 gap-3">
        <div className={`${cardCls} p-4`}>
          <p className="text-base text-ink-500">Collected</p>
          <p className="font-display text-xl font-semibold text-ink">{formatMoney(totalPaid)}</p>
        </div>
        <div className={`${cardCls} p-4`}>
          <p className="text-base text-ink-500">Still owed</p>
          <p className="font-display text-xl font-semibold text-ink">{formatMoney(totalOwed)}</p>
        </div>
      </section>

      {creating && (
        <form onSubmit={create} className={`${cardCls} space-y-4 p-4 sm:p-5`}>
          <h3 className="text-base font-semibold text-ink">New invoice</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Learner's phone or email" htmlFor={`${fid}-student`} hint="The Peebee account that will pay">
              <input id={`${fid}-student`} required value={student} onChange={(e) => setStudent(e.target.value)} className={controlCls} placeholder="+256700000000 or name@example.com" />
            </Field>
            <Field label="What it's for" htmlFor={`${fid}-title`}>
              <input id={`${fid}-title`} required minLength={2} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} className={controlCls} placeholder="e.g. Term 3 tuition" />
            </Field>
            <Field label="Amount (UGX)" htmlFor={`${fid}-amount`}>
              <input id={`${fid}-amount`} required type="number" min={1} step={1} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} className={controlCls} />
            </Field>
            <Field label="Due date (optional)" htmlFor={`${fid}-due`}>
              <input id={`${fid}-due`} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={controlCls} />
            </Field>
          </div>
          {formError && <Notice tone="error">{formError}</Notice>}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy}>
              {busy ? "Sending…" : "Send invoice"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setCreating(false)}>
              Cancel
            </Button>
          </div>
        </form>
      )}

      {invoices.length === 0 ? (
        !creating && <EmptyState icon={Receipt} title="No invoices yet" body="Send an invoice to a learner for tuition, uniforms, trips or exams. They pay it from their Peebee wallet, in parts if you like." />
      ) : (
        <ul className="space-y-2">
          {invoices.map((inv) => (
            <li key={inv.id} className={`${cardCls} flex flex-wrap items-center justify-between gap-3 p-4`}>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-ink">{inv.title}</p>
                <p className="truncate text-base text-ink-500">
                  {inv.studentName} · {formatMoney(inv.paidUgx)} of {formatMoney(inv.amountUgx)}
                  {inv.dueDate ? ` · due ${inv.dueDate}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Chip tone={STATUS[inv.status].tone}>{STATUS[inv.status].label}</Chip>
                {inv.status === "unpaid" && (
                  <button type="button" onClick={() => void cancel(inv)} className="text-base font-semibold text-ink-500 underline hover:text-red-600">
                    Cancel
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
