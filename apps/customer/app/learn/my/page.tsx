"use client";

import type { FeeInvoice, LearnEnrollment } from "@peebee/shared";
import { Award, BookOpen, Radio, Receipt } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LearnThumb } from "@peebee/shared/learn-thumb";
import { api, errorMessage } from "../../../lib/api";
import { Empty, ErrorNote, LearnScreen, Pill, Progress, ScreenHeader, SectionTitle, Skeleton, card, cardLink, displayFont, primaryBtn } from "../ui";

const ugx = (n: number) => (n > 0 ? `UGX ${n.toLocaleString("en-UG")}` : "Free");

const STATUS_LABEL: Record<FeeInvoice["status"], string> = { unpaid: "Unpaid", partial: "Part paid", paid: "Paid", cancelled: "Cancelled" };

function InvoiceRow({ invoice, onPaid }: { invoice: FeeInvoice; onPaid: () => void }) {
  const [amount, setAmount] = useState(String(invoice.balanceUgx));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsFunds, setNeedsFunds] = useState(false);

  async function pay() {
    const value = Number(amount);
    if (!Number.isInteger(value) || value < 1) return setError("Enter the amount as a whole number of shillings.");
    setBusy(true);
    setError(null);
    setNeedsFunds(false);
    try {
      await api.learnPayInvoice(invoice.id, value);
      onPaid();
    } catch (err) {
      setError(errorMessage(err));
      setNeedsFunds(/wallet/i.test(errorMessage(err)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`${card} space-y-3 p-4`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={`${displayFont} truncate text-[15px] font-semibold text-ink`}>{invoice.title}</p>
          <p className="truncate text-xs text-ink-500">
            {invoice.schoolName}
            {invoice.dueDate ? ` · due ${invoice.dueDate}` : ""}
          </p>
        </div>
        <Pill tone={invoice.status === "paid" ? "green" : invoice.status === "cancelled" ? "muted" : "gold"}>{STATUS_LABEL[invoice.status]}</Pill>
      </div>
      <Progress percent={invoice.amountUgx > 0 ? Math.round((invoice.paidUgx / invoice.amountUgx) * 100) : 0} label={`${invoice.title} paid`} />
      <p className="text-xs text-ink-500">
        {ugx(invoice.paidUgx)} paid of {ugx(invoice.amountUgx)}
      </p>
      {invoice.status !== "paid" && (
        <div className="space-y-2">
          <label htmlFor={`pay-${invoice.id}`} className="block text-xs font-semibold text-ink-500">
            Amount to pay now (UGX)
          </label>
          <div className="flex gap-2">
            <div className="field-box min-w-0 flex-1 rounded-2xl border border-[var(--border-faint)]">
            <input
              id={`pay-${invoice.id}`}
              type="number"
              inputMode="numeric"
              min={1}
              max={invoice.balanceUgx}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-11 w-full text-sm text-ink outline-none"
            />
            </div>
            <button type="button" onClick={pay} disabled={busy} className={`${primaryBtn} shrink-0 !px-4 !py-2`}>
              {busy ? "Paying…" : "Pay from wallet"}
            </button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-red-600 dark:text-red-400">
              {error}{" "}
              {needsFunds && (
                <Link href="/wallet" className="font-semibold underline">
                  Open your wallet
                </Link>
              )}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export default function MyLearningPage() {
  const [enrollments, setEnrollments] = useState<LearnEnrollment[] | null>(null);
  const [invoices, setInvoices] = useState<FeeInvoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, i] = await Promise.all([api.learnEnrollments(), api.learnInvoices()]);
      setEnrollments(e.enrollments);
      setInvoices(i.invoices);
      setError(null);
    } catch (err) {
      setEnrollments([]);
      setInvoices([]);
      setError(errorMessage(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = enrollments?.filter((e) => e.progressPercent < 100) ?? [];

  return (
    <LearnScreen>
      <ScreenHeader
        back={{ href: "/learn", label: "Learn" }}
        label="Peebee Learn"
        title="My class"
        subtitle="Your courses, fees and certificates in one place."
      />

      <div className="grid grid-cols-2 gap-2.5">
        <Link href="/learn/live" className={`${cardLink} relative flex flex-col gap-2 overflow-hidden p-3.5`}>
          <span className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-[radial-gradient(circle,rgb(var(--color-gold)/0.5),transparent_70%)]" aria-hidden />
          <span className="relative flex h-9 w-9 items-center justify-center rounded-[12px] bg-gold/15 text-gold">
            <Radio className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="relative">
            <span className={`${displayFont} block text-[15px] font-bold text-ink`}>Join live class</span>
            <span className="block text-[11px] text-ink-500">Enter your class code</span>
          </span>
        </Link>
        <Link href="/learn/certificates" className={`${cardLink} relative flex flex-col gap-2 overflow-hidden p-3.5`}>
          <span className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-[radial-gradient(circle,rgb(var(--color-green)/0.45),transparent_70%)]" aria-hidden />
          <span className="relative flex h-9 w-9 items-center justify-center rounded-[12px] bg-green/15 text-green">
            <Award className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <span className="relative">
            <span className={`${displayFont} block text-[15px] font-bold text-ink`}>Certificates</span>
            <span className="block text-[11px] text-ink-500">And your badges</span>
          </span>
        </Link>
      </div>

      {error && <ErrorNote>{error}</ErrorNote>}

      <section aria-labelledby="courses-h" className="space-y-3">
        <SectionTitle id="courses-h" icon={BookOpen} action={enrollments && enrollments.length > 0 ? <Pill tone="muted">{active.length} in progress</Pill> : undefined}>
          My courses
        </SectionTitle>
        {enrollments === null ? (
          <Skeleton className="h-28" />
        ) : enrollments.length === 0 ? (
          <Empty
            icon={BookOpen}
            action={
              <Link href="/learn" className={primaryBtn}>
                Browse courses
              </Link>
            }
          >
            You haven&apos;t joined a course yet.
          </Empty>
        ) : (
          <ul className="space-y-3">
            {enrollments.map((e) => (
              <li key={e.id}>
                <Link href={`/learn/course/${e.courseId}`} className={`${cardLink} block space-y-3 p-3`}>
                  <div className="flex gap-3">
                    <LearnThumb src={api.learnArtUrl("course", e.courseId)} ratio="15 / 9" className="w-28 shrink-0 self-start rounded-[14px]" />
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className={`${displayFont} text-[15px] font-semibold leading-tight text-ink`}>{e.title}</p>
                      <p className="mt-0.5 truncate text-xs text-ink-500">{e.schoolName}</p>
                      <div className="mt-2">{e.progressPercent >= 100 ? <Pill tone="green">Finished</Pill> : <Pill>{e.progressPercent}%</Pill>}</div>
                    </div>
                  </div>
                  <Progress percent={e.progressPercent} label={`${e.title} progress`} />
                  <p className="text-xs text-ink-500">
                    {e.completedLessons} of {e.lessonCount} lessons
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fees-h" className="space-y-3">
        <SectionTitle id="fees-h" icon={Receipt}>
          School fees
        </SectionTitle>
        {invoices === null ? (
          <Skeleton className="h-24" />
        ) : invoices.length === 0 ? (
          <Empty icon={Receipt}>No fees to pay. When a school sends you an invoice, it appears here and you pay it from your Peebee wallet.</Empty>
        ) : (
          <ul className="space-y-3">
            {invoices.map((inv) => (
              <InvoiceRow key={inv.id} invoice={inv} onPaid={() => void load()} />
            ))}
          </ul>
        )}
      </section>
    </LearnScreen>
  );
}
