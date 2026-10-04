"use client";

import {
  hasPermission,
  type AdminMerchantProfileResponse,
  type AdminMerchantRange,
  type Merchant,
} from "@peebee/shared";
import {
  ArrowLeft,
  Building2,
  CheckCircle2,
  ExternalLink,
  MapPin,
  ShieldCheck,
  Store,
  Users,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { useAuth } from "../../../../lib/auth-context";

const RANGE_LABEL: Record<AdminMerchantRange, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

const STATUS_LABEL: Record<Merchant["status"], string> = {
  pending_approval: "Pending approval",
  provisional: "Provisional",
  active: "Approved",
  suspended: "Suspended",
  rejected: "Rejected",
};

type DocumentPreview = { url: string; contentType: string };

function money(value: number | null | undefined): string {
  return `UGX ${Number(value ?? 0).toLocaleString("en-UG")}`;
}

function dateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function titleCase(value: string | null | undefined): string {
  return value ? value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "—";
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--border-faint)] py-2 last:border-0">
      <span className="text-sm text-ink-500">{label}</span>
      <span className="max-w-[62%] text-right text-sm font-semibold text-ink">{value || "—"}</span>
    </div>
  );
}

function StatusPill({ status }: { status: Merchant["status"] }) {
  const tone =
    status === "active"
      ? "bg-green/15 text-green"
      : status === "suspended" || status === "rejected"
        ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
        : "bg-[rgb(var(--surface-muted))] text-ink-500";
  return <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{STATUS_LABEL[status]}</span>;
}

function DocumentCard({
  label,
  present,
  preview,
}: {
  label: string;
  present: boolean;
  preview: DocumentPreview | null;
}) {
  return (
    <div className="rounded-2xl border border-[var(--border-faint)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold text-ink">{label}</p>
          <p className="mt-0.5 text-xs text-ink-500">{present ? "Attached to this KYC case" : "Not attached"}</p>
        </div>
        {present && <CheckCircle2 className="h-5 w-5 text-green" strokeWidth={1.8} aria-label="Attached" />}
      </div>
      {present && !preview && <p className="mt-3 text-xs text-ink-500">Loading secure preview…</p>}
      {preview && (
        <a
          href={preview.url}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-gold"
        >
          Open attached file
          <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </a>
      )}
    </div>
  );
}

export default function MerchantDetailPage() {
  const params = useParams<{ id: string }>();
  const merchantId = params.id;
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "merchants.manage");
  const [range, setRange] = useState<AdminMerchantRange>("month");
  const [profile, setProfile] = useState<AdminMerchantProfileResponse | null>(null);
  const [ownerId, setOwnerId] = useState<DocumentPreview | null>(null);
  const [businessDocument, setBusinessDocument] = useState<DocumentPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProfile(await api.adminGetMerchant(merchantId, range));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [merchantId, range]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const urls: string[] = [];
    setOwnerId(null);
    setBusinessDocument(null);

    async function loadDocuments() {
      const requests: Promise<void>[] = [];
      if (profile?.merchant.has_owner_id_document) {
        requests.push(
          api.adminMerchantKycDocumentBlob(merchantId, "owner-id").then((blob) => {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            setOwnerId({ url, contentType: blob.type });
          }),
        );
      }
      if (profile?.merchant.has_business_document) {
        requests.push(
          api.adminMerchantKycDocumentBlob(merchantId, "business-registration").then((blob) => {
            const url = URL.createObjectURL(blob);
            urls.push(url);
            setBusinessDocument({ url, contentType: blob.type });
          }),
        );
      }
      await Promise.allSettled(requests);
    }

    void loadDocuments();
    return () => urls.forEach((url) => URL.revokeObjectURL(url));
  }, [merchantId, profile?.merchant.has_business_document, profile?.merchant.has_owner_id_document]);

  const totals = useMemo(() => {
    if (!profile) return { paymentValue: 0, settledValue: 0 };
    return {
      paymentValue: profile.payments.reduce((total, payment) => total + Number(payment.amount), 0),
      settledValue: profile.settlements
        .filter((settlement) => settlement.status === "successful")
        .reduce((total, settlement) => total + Number(settlement.amount), 0),
    };
  }, [profile]);

  async function setStatus(status: Merchant["status"]) {
    setBusy(true);
    setError(null);
    try {
      await api.adminSetMerchantStatus(merchantId, status);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!profile) {
    return (
      <div className="space-y-4 p-4">
        <Link href="/people" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500">
          <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
          Users
        </Link>
        <p className="text-sm text-ink-500">{error ?? "Loading merchant profile…"}</p>
      </div>
    );
  }

  const { merchant, outlets, members, settlementAccounts, payments, transactions, settlements } = profile;
  const isApproved = merchant.status === "active";

  return (
    <div className="space-y-5 px-4 pb-8 pt-4">
      <Link href="/people" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-500">
        <ArrowLeft className="h-4 w-4" strokeWidth={2} aria-hidden />
        Users
      </Link>

      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-gold">Merchant profile</p>
          <h1 className="truncate text-xl font-bold text-ink">{merchant.display_name}</h1>
          <p className="truncate text-sm text-ink-500">{merchant.legal_name}</p>
        </div>
        <StatusPill status={merchant.status} />
      </header>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

      {canManage && (
        <section className="home-card space-y-3">
          <h2 className="text-sm font-bold text-ink">Review decision</h2>
          <div className="grid grid-cols-2 gap-2">
            {merchant.status !== "active" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStatus("active")}
                className="min-h-11 rounded-full bg-gold px-3 text-sm font-bold text-ink-gold disabled:opacity-60"
              >
                Approve
              </button>
            )}
            {merchant.status !== "provisional" && merchant.status !== "active" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStatus("provisional")}
                className="min-h-11 rounded-full border border-[var(--border-faint)] px-3 text-sm font-bold text-ink disabled:opacity-60"
              >
                Make provisional
              </button>
            )}
            {merchant.status !== "suspended" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStatus("suspended")}
                className="min-h-11 rounded-full border border-red-200 px-3 text-sm font-bold text-red-700 disabled:opacity-60"
              >
                Suspend
              </button>
            )}
            {merchant.status !== "rejected" && merchant.status !== "active" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStatus("rejected")}
                className="min-h-11 rounded-full border border-red-200 px-3 text-sm font-bold text-red-700 disabled:opacity-60"
              >
                Reject
              </button>
            )}
          </div>
        </section>
      )}

      <section className="home-card">
        <div className="mb-2 flex items-center gap-2">
          <Building2 className="h-4 w-4 text-gold" strokeWidth={1.8} aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Business data</h2>
        </div>
        <Row label="Legal name" value={merchant.legal_name} />
        <Row label="Trading name" value={merchant.display_name} />
        <Row label="Business type" value={titleCase(merchant.business_kind)} />
        <Row label="Registration number" value={merchant.registration_number ?? "Not supplied"} />
        <Row label="Tax ID" value={merchant.tax_id ?? "Not supplied"} />
        <Row label="Trust tier" value={titleCase(merchant.trust_tier)} />
        <Row label="Environment" value={titleCase(merchant.environment)} />
        <Row label="Registered" value={dateTime(merchant.created_at)} />
        <Row label="Approved" value={dateTime(merchant.approved_at)} />
        <Row label="Approved by" value={merchant.approved_by_name ?? "—"} />
      </section>

      <section className="home-card space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-gold" strokeWidth={1.8} aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">KYC and attached files</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            ["Phone", merchant.phone_verified],
            ["Identity", merchant.identity_verified],
            ["Business", merchant.business_verified],
          ].map(([label, verified]) => (
            <div key={String(label)} className="rounded-xl bg-[rgb(var(--surface-muted))] p-2">
              <p className="text-[11px] text-ink-500">{label}</p>
              <p className={`mt-1 text-xs font-bold ${verified ? "text-green" : "text-ink-500"}`}>
                {verified ? "Verified" : "Pending"}
              </p>
            </div>
          ))}
        </div>
        <Row label="KYC status" value={titleCase(merchant.kyc_status)} />
        <Row label="Last reviewed" value={dateTime(merchant.reviewed_at)} />
        <Row label="Reviewed by" value={merchant.reviewed_by_name ?? "—"} />
        {merchant.risk_notes && <Row label="Risk notes" value={merchant.risk_notes} />}
        <DocumentCard label="Owner identity document" present={Boolean(merchant.has_owner_id_document)} preview={ownerId} />
        <DocumentCard
          label="Business registration document"
          present={Boolean(merchant.has_business_document)}
          preview={businessDocument}
        />
      </section>

      <section className="home-card space-y-3">
        <div className="flex items-center gap-2">
          <Store className="h-4 w-4 text-gold" strokeWidth={1.8} aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Outlets ({outlets.length})</h2>
        </div>
        {outlets.length === 0 && <p className="text-sm text-ink-500">No outlets registered.</p>}
        {outlets.map((outlet) => (
          <article key={outlet.id} className="rounded-2xl border border-[var(--border-faint)] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-ink">{outlet.name}</p>
                <p className="text-xs text-ink-500">{outlet.category_name ?? "Uncategorised"} · {outlet.code}</p>
              </div>
              <span className="rounded-full bg-[rgb(var(--surface-muted))] px-2 py-0.5 text-[11px] font-bold text-ink-500">
                {titleCase(outlet.status)}
              </span>
            </div>
            {outlet.address && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-500">
                <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
                {outlet.address}
              </p>
            )}
            <p className="mt-1 text-xs text-ink-500">{outlet.phone ?? "No outlet phone"}</p>
            {outlet.lat != null && outlet.lng != null && (
              <p className="mt-1 text-xs text-ink-500">GPS: {outlet.lat}, {outlet.lng}</p>
            )}
          </article>
        ))}
      </section>

      <section className="home-card space-y-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-gold" strokeWidth={1.8} aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Owners and staff ({members.length})</h2>
        </div>
        {members.length === 0 && <p className="text-sm text-ink-500">No merchant members found.</p>}
        {members.map((member) => {
          const assignedOutlet = outlets.find((outlet) => outlet.id === member.outlet_id);
          return (
            <article key={member.user_id} className="rounded-2xl border border-[var(--border-faint)] p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-bold text-ink">{member.name}</p>
                  <p className="text-xs text-ink-500">{titleCase(member.role)} · {titleCase(member.status)}</p>
                </div>
                {assignedOutlet && <span className="text-right text-xs font-semibold text-ink-500">{assignedOutlet.name}</span>}
              </div>
              <p className="mt-2 text-xs text-ink-500">{member.phone ?? "No phone"}</p>
              <p className="mt-0.5 text-xs text-ink-500">{member.email ?? "No email"}</p>
            </article>
          );
        })}
      </section>

      <section className="home-card space-y-3">
        <div className="flex items-center gap-2">
          <WalletCards className="h-4 w-4 text-gold" strokeWidth={1.8} aria-hidden />
          <h2 className="text-sm font-bold uppercase tracking-wide text-ink-500">Wallet and settlement</h2>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-[rgb(var(--surface-muted))] p-2">
            <p className="text-[11px] text-ink-500">Held</p><p className="mt-1 text-xs font-bold text-ink">{money(merchant.held)}</p>
          </div>
          <div className="rounded-xl bg-[rgb(var(--surface-muted))] p-2">
            <p className="text-[11px] text-ink-500">Available</p><p className="mt-1 text-xs font-bold text-ink">{money(merchant.available)}</p>
          </div>
          <div className="rounded-xl bg-[rgb(var(--surface-muted))] p-2">
            <p className="text-[11px] text-ink-500">Settling</p><p className="mt-1 text-xs font-bold text-ink">{money(merchant.settling)}</p>
          </div>
        </div>
        {settlementAccounts.length === 0 && <p className="text-sm text-ink-500">No payout destination added.</p>}
        {settlementAccounts.map((account) => (
          <article key={account.id} className="rounded-2xl border border-[var(--border-faint)] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-ink">{account.account_name ?? titleCase(account.type)}</p>
              {account.is_primary ? <span className="text-xs font-bold text-gold">Primary</span> : null}
            </div>
            <p className="mt-1 text-xs text-ink-500">
              {account.network_or_bank ?? account.provider} · {account.masked_account_ref} · {titleCase(account.status)}
            </p>
          </article>
        ))}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-ink">Transaction records</h2>
            <p className="text-xs text-ink-500">Server-filtered merchant financial activity</p>
          </div>
          {loading && <span className="text-xs text-ink-500">Updating…</span>}
        </div>

        {!isApproved ? (
          <div className="home-card text-sm text-ink-500">
            Transaction records become available after this merchant is approved.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-4 gap-1 rounded-full bg-[rgb(var(--surface-muted))] p-1">
              {(Object.keys(RANGE_LABEL) as AdminMerchantRange[]).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setRange(option)}
                  aria-pressed={range === option}
                  className={`min-h-9 rounded-full px-2 text-xs font-bold transition-colors ${
                    range === option ? "bg-gold text-ink-gold" : "text-ink-500"
                  }`}
                >
                  {RANGE_LABEL[option]}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="home-card !py-3">
                <p className="text-xs text-ink-500">Payment value</p>
                <p className="mt-1 font-bold text-ink">{money(totals.paymentValue)}</p>
                <p className="mt-0.5 text-[11px] text-ink-500">{payments.length} record{payments.length === 1 ? "" : "s"}</p>
              </div>
              <div className="home-card !py-3">
                <p className="text-xs text-ink-500">Settled successfully</p>
                <p className="mt-1 font-bold text-ink">{money(totals.settledValue)}</p>
                <p className="mt-0.5 text-[11px] text-ink-500">Selected {RANGE_LABEL[range].toLowerCase()}</p>
              </div>
            </div>

            <div className="home-card space-y-3">
              <h3 className="text-sm font-bold text-ink">Merchant payments</h3>
              {payments.length === 0 && <p className="text-sm text-ink-500">No payments in this period.</p>}
              {payments.map((payment) => (
                <article key={payment.id} className="border-b border-[var(--border-faint)] pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-ink">{payment.outlet_name}</p>
                      <p className="text-xs text-ink-500">Rider: {payment.rider_name}</p>
                    </div>
                    <p className="shrink-0 text-sm font-bold text-ink">{money(payment.amount)}</p>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    {titleCase(payment.status)} · {dateTime(payment.created_at)}
                  </p>
                  {payment.receipt_reference && <p className="mt-0.5 text-xs text-ink-500">Receipt: {payment.receipt_reference}</p>}
                </article>
              ))}
            </div>

            <div className="home-card space-y-3">
              <h3 className="text-sm font-bold text-ink">Withdrawals and settlements</h3>
              {settlements.length === 0 && <p className="text-sm text-ink-500">No settlements in this period.</p>}
              {settlements.map((settlement) => (
                <article key={settlement.id} className="border-b border-[var(--border-faint)] pb-3 last:border-0 last:pb-0">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-bold text-ink">{titleCase(settlement.status)}</p>
                      <p className="text-xs text-ink-500">
                        {settlement.network_or_bank ?? settlement.provider ?? "Provider pending"} · {settlement.masked_account_ref}
                      </p>
                    </div>
                    <p className="text-right text-sm font-bold text-ink">{money(settlement.amount)}</p>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    Fee {money(settlement.fee)} · {titleCase(settlement.mode)} · {dateTime(settlement.created_at)}
                  </p>
                </article>
              ))}
            </div>

            <div className="home-card space-y-3">
              <h3 className="text-sm font-bold text-ink">Ledger entries</h3>
              {transactions.length === 0 && <p className="text-sm text-ink-500">No ledger entries in this period.</p>}
              {transactions.map((transaction) => (
                <article key={transaction.id} className="flex items-start justify-between gap-3 border-b border-[var(--border-faint)] pb-3 last:border-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-ink">{transaction.description ?? titleCase(transaction.kind)}</p>
                    <p className="text-xs text-ink-500">{titleCase(transaction.purpose)} · {dateTime(transaction.created_at)}</p>
                  </div>
                  <p className={`shrink-0 text-sm font-bold ${Number(transaction.amount) >= 0 ? "text-green" : "text-red-700"}`}>
                    {Number(transaction.amount) >= 0 ? "+" : "−"}{money(Math.abs(Number(transaction.amount)))}
                  </p>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
