"use client";

import {
  hasPermission,
  type AdminMerchant,
  type AdminMerchantSettlementAccount,
  type MerchantCustodyApproval,
  type MerchantProviderOperation,
  type MerchantReconciliationRow,
  type PlatformEnvironment,
} from "@peebee/shared";
import { useCallback, useEffect, useState } from "react";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

const money = (value: number) => `UGX ${Number(value).toLocaleString()}`;

export default function MerchantPaymentsSettingsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "merchant_finance.manage");
  const canApproveMerchants = hasPermission(user?.adminRole ?? null, "merchants.manage");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [environment, setEnvironment] = useState<PlatformEnvironment>("live");
  const [enabled, setEnabled] = useState(false);
  const [custody, setCustody] = useState<MerchantCustodyApproval[]>([]);
  const [accounts, setAccounts] = useState<AdminMerchantSettlementAccount[]>([]);
  const [merchants, setMerchants] = useState<AdminMerchant[]>([]);
  const [balances, setBalances] = useState<MerchantReconciliationRow[]>([]);
  const [operations, setOperations] = useState<MerchantProviderOperation[]>([]);
  const [reconciled, setReconciled] = useState(true);
  const [frozen, setFrozen] = useState(false);
  const [custodyProvider, setCustodyProvider] = useState("");
  const [payoutProvider, setPayoutProvider] = useState("");
  const [reference, setReference] = useState("");

  const load = useCallback(async () => {
    const [settingsResult, custodyResult, accountResult, reconciliationResult, merchantResult] = await Promise.all([
      api.getSettings(),
      api.adminMerchantCustody(),
      api.adminMerchantSettlementAccounts(),
      api.adminMerchantReconciliation(),
      api.adminMerchants(),
    ]);
    setEnvironment(settingsResult.settings.platformEnvironment);
    setEnabled(settingsResult.settings.merchantPaymentsEnabled);
    setCustody(custodyResult.approvals);
    setAccounts(accountResult.settlementAccounts);
    setMerchants(merchantResult.merchants);
    setBalances(reconciliationResult.merchants);
    setOperations(reconciliationResult.providerOperations);
    setReconciled(reconciliationResult.reconciled);
    setFrozen(reconciliationResult.withdrawalsFrozen);
  }, []);

  useEffect(() => {
    if (!canManage) {
      setLoading(false);
      return;
    }
    load().catch((err) => setError(errorMessage(err))).finally(() => setLoading(false));
  }, [canManage, load]);

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function openKycDocument(merchantId: string, type: "owner-id" | "business-registration") {
    const tab = window.open("", "_blank");
    setError(null);
    try {
      const blob = await api.adminMerchantKycDocumentBlob(merchantId, type);
      const url = URL.createObjectURL(blob);
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      tab?.close();
      setError(errorMessage(err));
    }
  }

  if (!loading && !canManage) {
    return (
      <SettingsPageShell title="Merchant payments" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage merchant finance.</p>
      </SettingsPageShell>
    );
  }

  const now = Date.now();
  const activeApproval = custody.find((item) => item.status === "active"
    && Date.parse(item.effective_at) <= now
    && (item.expires_at == null || Date.parse(item.expires_at) > now));

  return (
    <SettingsPageShell title="Merchant payments" loading={loading}>
      <div className="space-y-5">
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}

        {environment === "sandbox" && (
          <section className="rounded-xl border border-sky-300 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-100">
            <p className="font-bold">Sandbox merchant testing</p>
            <p className="mt-1 text-xs opacity-80">Collections, merchant allocations, balances, settlement requests, delayed provider responses, and occasional failures are simulated. No real money or provider credentials are used. KYC and administrator approvals remain in the flow so the experience matches production.</p>
          </section>
        )}

        <section className="home-card space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-ink">Merchant allocation flow</h2>
              <p className="mt-1 text-xs text-ink-500">
                {environment === "live" ? "Live" : "Sandbox"} orders use merchant allocations only when this is enabled.
                Existing orders remain on their original funds model.
              </p>
            </div>
            <button
              type="button"
              disabled={busy != null}
              onClick={() => run("activation", () => api.adminSetMerchantPaymentsEnabled(!enabled))}
              className={`shrink-0 rounded-full px-4 py-2 text-xs font-bold ${enabled ? "bg-green/15 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"}`}
            >
              {busy === "activation" ? "Saving…" : enabled ? "Enabled" : "Disabled"}
            </button>
          </div>
          {environment === "live" && !activeApproval && (
            <p className="rounded-lg bg-gold/10 px-3 py-2 text-xs text-ink">
              Live activation is locked until a current regulated custody and safeguarding approval is recorded.
            </p>
          )}
        </section>

        <section className="home-card space-y-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Merchant approvals</h2>
            <p className="mt-1 text-xs text-ink-500">Formal businesses remain unable to receive {environment} allocations until their KYC and merchant status are approved.</p>
          </div>
          {merchants.length === 0 && <p className="text-xs text-ink-500">No merchant applications yet.</p>}
          {merchants.map((merchant) => (
            <div key={merchant.id} className="rounded-xl border border-[var(--border-faint)] p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <span><span className="block font-semibold text-ink">{merchant.display_name}</span><span className="text-xs text-ink-500">{merchant.legal_name} · KYC {merchant.kyc_status ?? "pending"} · {merchant.outlet_count} outlet{Number(merchant.outlet_count) === 1 ? "" : "s"}</span></span>
                <span className="rounded-full bg-[rgb(var(--surface-muted))] px-2 py-1 text-[10px] font-bold capitalize text-ink-500">{merchant.status.replaceAll("_", " ")}</span>
              </div>
              {canApproveMerchants && (
                <div className="mt-3 flex flex-wrap gap-3">
                  {!!merchant.has_owner_id_document && <button type="button" onClick={() => void openKycDocument(merchant.id, "owner-id")} className="text-xs font-bold text-gold">View owner ID</button>}
                  {!!merchant.has_business_document && <button type="button" onClick={() => void openKycDocument(merchant.id, "business-registration")} className="text-xs font-bold text-gold">View registration</button>}
                  {merchant.status !== "active" && <button type="button" disabled={busy != null} onClick={() => run(`activate-${merchant.id}`, () => api.adminSetMerchantStatus(merchant.id, "active"))} className="text-xs font-bold text-green">Approve and activate</button>}
                  {merchant.status !== "suspended" && <button type="button" disabled={busy != null} onClick={() => run(`suspend-${merchant.id}`, () => api.adminSetMerchantStatus(merchant.id, "suspended"))} className="text-xs font-bold text-red-600">Suspend</button>}
                  {merchant.status === "pending_approval" && <button type="button" disabled={busy != null} onClick={() => run(`provisional-${merchant.id}`, () => api.adminSetMerchantStatus(merchant.id, "provisional"))} className="text-xs font-bold text-gold">Set provisional</button>}
                </div>
              )}
            </div>
          ))}
        </section>

        <section className="home-card space-y-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Regulated custody approval</h2>
            <p className="mt-1 text-xs text-ink-500">Record the signed provider arrangement; this is an operational gate, not legal advice.</p>
          </div>
          {activeApproval ? (
            <div className="rounded-xl border border-green/30 bg-green/5 p-3 text-sm">
              <p className="font-semibold text-ink">{activeApproval.custody_provider} custody · {activeApproval.payout_provider} payouts</p>
              <p className="mt-1 text-xs text-ink-500">Effective {new Date(activeApproval.effective_at).toLocaleString()}</p>
              <button
                type="button"
                disabled={busy != null}
                onClick={() => run("revoke", () => api.adminRevokeMerchantCustody(activeApproval.id))}
                className="mt-3 text-xs font-bold text-red-600"
              >
                {busy === "revoke" ? "Revoking…" : "Revoke approval and disable flow"}
              </button>
            </div>
          ) : (
            <form
              className="space-y-2"
              onSubmit={(event) => {
                event.preventDefault();
                void run("custody", async () => {
                  await api.adminApproveMerchantCustody({
                    custodyProvider,
                    payoutProvider,
                    safeguardingReference: reference,
                    effectiveAt: new Date().toISOString(),
                  });
                  setCustodyProvider("");
                  setPayoutProvider("");
                  setReference("");
                });
              }}
            >
              <input required value={custodyProvider} onChange={(e) => setCustodyProvider(e.target.value)} placeholder="Custody provider" className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] bg-transparent px-3 text-sm" />
              <input required value={payoutProvider} onChange={(e) => setPayoutProvider(e.target.value)} placeholder="Payout provider" className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] bg-transparent px-3 text-sm" />
              <input required minLength={4} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Signed agreement / safeguarding reference" className="min-h-11 w-full rounded-xl border border-[var(--border-faint)] bg-transparent px-3 text-sm" />
              <button disabled={busy != null} className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60">
                {busy === "custody" ? "Recording…" : "Record approval"}
              </button>
            </form>
          )}
        </section>

        <section className="home-card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-ink">Reconciliation circuit breaker</h2>
              <p className="mt-1 text-xs text-ink-500">{reconciled ? "All cached balances match the ledger." : "Mismatch detected. Withdrawals must remain frozen."}</p>
            </div>
            <button
              type="button"
              disabled={busy != null || (!frozen && !reconciled)}
              onClick={() => run("freeze", () => api.adminSetMerchantWithdrawalsFrozen(!frozen))}
              className={`shrink-0 rounded-full px-3 py-2 text-xs font-bold ${frozen ? "bg-red-100 text-red-700" : "bg-green/15 text-green"}`}
            >
              {busy === "freeze" ? "Saving…" : frozen ? "Withdrawals frozen" : "Withdrawals open"}
            </button>
          </div>
          {balances.slice(0, 20).map((row) => (
            <div key={`${row.merchant_id}-${row.environment}`} className="flex items-center justify-between border-t border-[var(--border-faint)] pt-2 text-xs">
              <span><span className="font-semibold text-ink">{row.display_name}</span><span className="block text-ink-500">{money(row.available)} available · {money(row.settling)} settling</span></span>
              <span className={row.reconciled ? "text-green" : "text-red-600"}>{row.reconciled ? "Matched" : "Mismatch"}</span>
            </div>
          ))}
          {operations.length > 0 && <p className="text-xs text-ink-500">{operations.length} provider operation{operations.length === 1 ? "" : "s"} awaiting a final status. The poller checks these without blindly resending money.</p>}
        </section>

        <section className="home-card space-y-3">
          <div>
            <h2 className="text-sm font-bold text-ink">Settlement destinations</h2>
            <p className="mt-1 text-xs text-ink-500">Verify ownership before a merchant can withdraw. New destinations also have a 24-hour cooling period.</p>
          </div>
          {accounts.length === 0 && <p className="text-xs text-ink-500">No settlement destinations submitted yet.</p>}
          {accounts.map((account) => (
            <div key={account.id} className="rounded-xl border border-[var(--border-faint)] p-3 text-sm">
              <p className="font-semibold text-ink">{account.display_name}</p>
              <p className="text-xs text-ink-500">{account.provider} · {account.masked_account_ref} · {account.status.replaceAll("_", " ")}</p>
              <div className="mt-2 flex gap-3">
                {account.status === "pending_verification" && (
                  <button type="button" disabled={busy != null} onClick={() => run(`verify-${account.id}`, () => api.adminSetMerchantSettlementAccountStatus(account.id, "verified"))} className="text-xs font-bold text-green">
                    {busy === `verify-${account.id}` ? "Verifying…" : environment === "sandbox" ? "Verify for sandbox" : "Verify"}
                  </button>
                )}
                {account.status !== "disabled" && (
                  <button type="button" disabled={busy != null} onClick={() => run(`disable-${account.id}`, () => api.adminSetMerchantSettlementAccountStatus(account.id, "disabled"))} className="text-xs font-bold text-red-600">
                    {busy === `disable-${account.id}` ? "Disabling…" : "Disable"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </section>
      </div>
    </SettingsPageShell>
  );
}
