"use client";

import type {
  FuelPumpAttendant,
  FuelStationPayoutAccount,
  FuelStationSalesSummary,
  FuelStationWithdrawal,
  FuelReceipt,
} from "@peebee/shared";
import {
  AlertCircle,
  ArrowDownToLine,
  ArrowUpRight,
  Banknote,
  Building2,
  Check,
  CheckCircle2,
  Clock,
  Fuel,
  KeyRound,
  Plus,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Store,
  UserCheck,
  Users,
  Wallet,
  X,
  CreditCard,
  Briefcase,
  ChevronRight,
  Package,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Accordion } from "../../components/Accordion";
import { TabBar } from "../../components/TabBar";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

type TabMode = "attendants" | "sales" | "withdrawals";

export default function StationManagerPage() {
  const router = useRouter();
  const {
    manager,
    outlet,
    outlets,
    selectOutlet,
    isManager,
    role,
    activeMode,
    switchToPumpMode,
    ready,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<TabMode>("attendants");
  const [showAllStaff, setShowAllStaff] = useState(false);
  const [salesPeriod, setSalesPeriod] = useState<"today" | "week" | "month" | "all">("today");

  // Attendants State
  const [attendants, setAttendants] = useState<FuelPumpAttendant[]>([]);
  const [attendantFilter, setAttendantFilter] = useState<"all" | "approved" | "pending" | "suspended">("all");
  const [loadingAttendants, setLoadingAttendants] = useState(false);
  const [commissionModalOpen, setCommissionModalOpen] = useState(false);

  // Commission Form State
  const [newFullName, setNewFullName] = useState("");
  const [newPhone, setNewPhone] = useState("+256 ");
  const [newCode, setNewCode] = useState("");
  const [newPumpLane, setNewPumpLane] = useState("Pump 1");
  const [newPin, setNewPin] = useState("");
  const [newApproveImmediately, setNewApproveImmediately] = useState(true);
  const [commissioningBusy, setCommissioningBusy] = useState(false);

  // Sales & Transactions State
  const [salesSummary, setSalesSummary] = useState<FuelStationSalesSummary | null>(null);
  const [transactions, setTransactions] = useState<FuelReceipt[]>([]);
  const [loadingSales, setLoadingSales] = useState(false);

  // Withdrawals & Accounts State
  const [withdrawals, setWithdrawals] = useState<FuelStationWithdrawal[]>([]);
  const [payoutAccounts, setPayoutAccounts] = useState<FuelStationPayoutAccount[]>([]);
  const [loadingWithdrawals, setLoadingWithdrawals] = useState(false);
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [addAccountModalOpen, setAddAccountModalOpen] = useState(false);

  // Withdraw Form State
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawDestType, setWithdrawDestType] = useState<"momo" | "bank">("momo");
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [momoNetwork, setMomoNetwork] = useState<"MTN" | "Airtel">("MTN");
  const [momoPhone, setMomoPhone] = useState("+256 ");
  const [momoName, setMomoName] = useState("");
  const [bankName, setBankName] = useState("Stanbic Bank");
  const [bankAccNum, setBankAccNum] = useState("");
  const [bankAccName, setBankAccName] = useState("");
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  // Shared Action Feedback State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const outletId = outlet?.id ?? "fout_total_lugogo";

  const ugx = (amount: number) => `UGX ${Number(amount).toLocaleString()}`;

  // Redirect if not logged in
  useEffect(() => {
    if (ready && !manager && !role) {
      router.replace("/login");
    }
  }, [ready, manager, role, router]);

  // Load Attendants
  const fetchAttendants = useCallback(async () => {
    setLoadingAttendants(true);
    try {
      const res = await api.gasManagerAttendants(outletId);
      if (res.ok) {
        setAttendants(res.attendants);
      }
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setLoadingAttendants(false);
    }
  }, [outletId]);

  // Load Sales Summary & Transactions
  const fetchSales = useCallback(async () => {
    setLoadingSales(true);
    try {
      const [sumRes, txRes] = await Promise.all([
        api.gasManagerSalesSummary(outletId, salesPeriod),
        api.gasManagerTransactions(outletId, 30),
      ]);
      if (sumRes.ok) setSalesSummary(sumRes.summary);
      if (txRes.ok) setTransactions(txRes.transactions);
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setLoadingSales(false);
    }
  }, [outletId, salesPeriod]);

  // Load Withdrawals & Accounts
  const fetchWithdrawals = useCallback(async () => {
    setLoadingWithdrawals(true);
    try {
      const [wdRes, payRes] = await Promise.all([
        api.gasManagerWithdrawals(outletId),
        api.gasManagerPayoutAccounts(outletId),
      ]);
      if (wdRes.ok) setWithdrawals(wdRes.withdrawals);
      if (payRes.ok) {
        setPayoutAccounts(payRes.accounts);
        if (payRes.accounts[0] && !selectedAccountId) {
          setSelectedAccountId(payRes.accounts[0].id);
        }
      }
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setLoadingWithdrawals(false);
    }
  }, [outletId, selectedAccountId]);

  useEffect(() => {
    if (outletId) {
      void fetchAttendants();
      void fetchSales();
      void fetchWithdrawals();
    }
  }, [outletId, fetchAttendants, fetchSales, fetchWithdrawals]);

  // Dismiss Toast helper
  function showToast(msg: string) {
    setToastMessage(msg);
    setActionError(null);
    setTimeout(() => setToastMessage(null), 4000);
  }

  // Handle Commission Form Submit
  async function handleCommissionAttendant(e: React.FormEvent) {
    e.preventDefault();
    if (!newFullName.trim() || !newPhone.trim()) {
      setActionError("Please provide attendant name and phone number.");
      return;
    }
    setCommissioningBusy(true);
    setActionError(null);
    try {
      const res = await api.gasManagerCommissionAttendant({
        outletId,
        fullName: newFullName.trim(),
        phone: newPhone.trim(),
        attendantCode: newCode.trim() || undefined,
        pumpLane: newPumpLane.trim() || undefined,
        pin: newPin.trim() || undefined,
        approveImmediately: newApproveImmediately,
      });
      if (res.ok) {
        showToast(`Commissioned ${res.attendant.full_name} (${res.attendant.attendant_code}) successfully.`);
        if (res.temporary_pin) {
          window.alert(`Staff PIN for ${res.attendant.full_name}: ${res.temporary_pin}\n\nGive it to them privately. It will not be shown again.`);
        }
        setNewPin("");
        setCommissionModalOpen(false);
        setNewFullName("");
        setNewPhone("+256 ");
        setNewCode("");
        void fetchAttendants();
      }
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setCommissioningBusy(false);
    }
  }

  // Attendant Action Handlers
  async function handleApproveAttendant(id: string) {
    try {
      const res = await api.gasManagerApproveAttendant(id);
      if (res.ok) {
        showToast(`Approved attendant ${res.attendant.full_name}. They can now login.`);
        void fetchAttendants();
      }
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleSuspendAttendant(id: string) {
    try {
      const res = await api.gasManagerSuspendAttendant(id);
      if (res.ok) {
        showToast(`Suspended attendant access.`);
        void fetchAttendants();
      }
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleReactivateAttendant(id: string) {
    try {
      const res = await api.gasManagerReactivateAttendant(id);
      if (res.ok) {
        showToast(`Reactivated attendant.`);
        void fetchAttendants();
      }
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  async function handleResetPin(id: string) {
    const pin = window.prompt("Enter a new 4 to 8 digit PIN for this attendant, or leave blank to generate one:", "");
    if (pin === null) return;
    try {
      const res = await api.gasManagerResetPin(id, pin.trim() || undefined);
      if (res.temporary_pin) {
        window.alert(`New staff PIN: ${res.temporary_pin}\n\nGive it to them privately. It will not be shown again.`);
      }
      showToast("PIN reset.");
      void fetchAttendants();
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // Handle Withdrawal Submit
  async function handleWithdrawSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(withdrawAmount.replace(/[^\d]/g, ""));
    if (!amount || amount < 5000) {
      setActionError("Minimum withdrawal amount is UGX 5,000.");
      return;
    }

    let destDetails: any;
    if (selectedAccountId) {
      const selectedAcc = payoutAccounts.find((a) => a.id === selectedAccountId);
      if (selectedAcc) {
        destDetails = {
          accountRef: selectedAcc.account_ref,
          accountName: selectedAcc.account_name,
          networkOrBank: selectedAcc.network_or_bank,
          type: selectedAcc.type,
        };
      }
    }

    if (!destDetails) {
      if (withdrawDestType === "momo") {
        if (!momoPhone.trim() || !momoName.trim()) {
          setActionError("Please provide Mobile Money phone and registered account name.");
          return;
        }
        destDetails = {
          phone: momoPhone.trim(),
          network: momoNetwork,
          accountName: momoName.trim(),
        };
      } else {
        if (!bankAccNum.trim() || !bankAccName.trim()) {
          setActionError("Please enter Bank account number and registered name.");
          return;
        }
        destDetails = {
          bankName,
          accountNumber: bankAccNum.trim(),
          accountName: bankAccName.trim(),
        };
      }
    }

    setWithdrawBusy(true);
    setActionError(null);
    try {
      const res = await api.gasManagerRequestWithdrawal({
        outletId,
        amountUgx: amount,
        destinationType: withdrawDestType,
        destinationDetails: destDetails,
      });
      if (res.ok) {
        showToast(`Withdrawal of ${ugx(amount)} submitted successfully! (Ref: ${res.withdrawal.reference})`);
        setWithdrawModalOpen(false);
        setWithdrawAmount("");
        void fetchWithdrawals();
        void fetchSales();
      }
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setWithdrawBusy(false);
    }
  }

  // Filter attendants list
  const filteredAttendants = attendants.filter((a) => {
    if (attendantFilter === "approved") return a.commission_status === "approved" || a.status === "on_duty";
    if (attendantFilter === "pending") return a.commission_status === "pending";
    if (attendantFilter === "suspended") return a.commission_status === "suspended" || a.status === "suspended";
    return true;
  });

  const pendingCount = attendants.filter((a) => a.commission_status === "pending").length;

  return (
    <div className="space-y-4 pb-12">
      {/* Toast Alert */}
      {toastMessage && (
        <div className="fixed top-4 inset-x-4 z-50 mx-auto max-w-sm rounded-2xl bg-green/90 p-3.5 text-xs font-bold text-white shadow-lg backdrop-blur flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Error Alert */}
      {actionError && (
        <div className="rounded-2xl border border-red-500/20 bg-red-50 p-3.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-500 mt-0.5" />
          <div className="flex-1">{actionError}</div>
          <button type="button" onClick={() => setActionError(null)}>
            <X className="h-3.5 w-3.5 opacity-60 hover:opacity-100" />
          </button>
        </div>
      )}

      <section className="home-card flex items-center gap-3 !bg-black-700 text-white dark:!bg-black">
        <div className="min-w-0 flex-1">
          <h1 className="line-clamp-2 text-2xl font-black leading-tight text-white">{outlet?.name ?? "Station"}</h1>
          <p className="truncate text-base text-white/70">{manager?.full_name ?? "Manager"}</p>
        </div>
        <button
          type="button"
          onClick={() => {
            switchToPumpMode();
            router.push("/");
          }}
          className="flex min-h-14 shrink-0 items-center gap-2 rounded-2xl bg-gold px-4 text-lg font-bold text-ink-gold active:scale-95"
        >
          <Fuel className="h-6 w-6" aria-hidden /> Pump
        </button>
      </section>

      {/* Station Selector dropdown if multiple outlets */}
      {outlets.length > 1 && (
        <div className="home-card min-h-16 flex items-center justify-between gap-3 text-base">
          <div className="flex items-center gap-2 text-ink-500 font-bold">
            <Building2 className="h-4 w-4 text-gold" />
            <span>Station</span>
          </div>
          <div className="field-box px-2 py-1 max-w-[220px]">
            <select
              value={outlet?.id ?? ""}
              onChange={(e) => selectOutlet(e.target.value)}
              className="min-h-10 w-full cursor-pointer bg-transparent text-base font-bold text-ink outline-none"
            >
              {outlets.map((o) => (
                <option key={o.id} value={o.id} className="text-black bg-white">
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      <TabBar
        label="Manager sections"
        active={activeTab}
        onChange={setActiveTab}
        tabs={[
          { id: "attendants", label: "Staff", icon: Users, count: pendingCount },
          { id: "sales", label: "Sales", icon: Banknote },
          { id: "withdrawals", label: "Cash out", icon: Wallet },
        ]}
      />

      {/* ============================================================== */}
      {/* TAB 1: ATTENDANTS & COMMISSIONING */}
      {/* ============================================================== */}
      {activeTab === "attendants" && (
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => setCommissionModalOpen(true)}
            className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-gold text-xl font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] transition active:scale-[0.98]"
          >
            <Plus className="h-6 w-6" aria-hidden />
            <span>Add attendant</span>
          </button>

          <div className="grid grid-cols-4 gap-1.5" role="group" aria-label="Filter attendants">
            {(["all", "approved", "pending", "suspended"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setAttendantFilter(mode)}
                aria-pressed={attendantFilter === mode}
                className={`flex min-h-12 items-center justify-center rounded-full px-1 text-base font-bold capitalize transition ${
                  attendantFilter === mode
                    ? "bg-gold text-ink-gold"
                    : "border border-[var(--border-faint)] bg-[var(--surface-raised)] text-ink-500"
                }`}
              >
                {mode === "all" ? "All" : mode === "approved" ? "Active" : mode === "pending" ? `New${pendingCount ? ` ${pendingCount}` : ""}` : "Off"}
              </button>
            ))}
          </div>

          {loadingAttendants ? (
            <div className="home-card p-8 text-center text-lg font-bold text-ink-500">Loading…</div>
          ) : filteredAttendants.length === 0 ? (
            <div className="home-card space-y-2 p-8 text-center">
              <Users className="mx-auto h-10 w-10 text-ink-500/50" aria-hidden />
              <p className="text-lg font-bold text-ink">No attendants</p>
            </div>
          ) : (
            <div className="space-y-3">
              {(showAllStaff ? filteredAttendants : filteredAttendants.slice(0, 6)).map((att) => {
                const isPending = att.commission_status === "pending";
                const isSuspended = att.commission_status === "suspended" || att.status === "suspended";

                return (
                  <div key={att.id} className="home-card space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
                        <UserCheck className="h-6 w-6" aria-hidden />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-xl font-black text-ink">{att.full_name}</h3>
                        <p className="truncate text-base text-ink-500">{att.pump_lane ?? "Pump 1"} · {att.phone}</p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${
                          isPending ? "bg-amber-500/15 text-amber-600" : isSuspended ? "bg-red-500/15 text-red-600" : "bg-green/15 text-green"
                        }`}
                      >
                        {isPending ? "New" : isSuspended ? "Off" : "Active"}
                      </span>
                    </div>

                    <p className="text-lg text-ink-500">
                      <strong className="text-2xl font-black tabular-nums text-ink">{ugx(att.total_ugx_today ?? 0)}</strong>
                      <span> · {Number(att.total_litres_today ?? 0).toFixed(1)} L · {att.total_dispenses_today ?? 0}×</span>
                    </p>

                    <div className="flex gap-2">
                      {isPending ? (
                        <button
                          type="button"
                          onClick={() => handleApproveAttendant(att.id)}
                          className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-gold text-lg font-bold text-ink-gold active:scale-95"
                        >
                          <Check className="h-6 w-6" aria-hidden /> Approve
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleResetPin(att.id)}
                            className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-[var(--surface-muted)] text-lg font-bold text-ink active:scale-95"
                          >
                            <KeyRound className="h-5 w-5" aria-hidden /> PIN
                          </button>
                          {isSuspended ? (
                            <button
                              type="button"
                              onClick={() => handleReactivateAttendant(att.id)}
                              className="min-h-14 flex-1 rounded-2xl bg-green/15 text-lg font-bold text-green active:scale-95"
                            >
                              Reactivate
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleSuspendAttendant(att.id)}
                              className="min-h-14 flex-1 rounded-2xl bg-red-500/10 text-lg font-bold text-red-600 active:scale-95"
                            >
                              Suspend
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
              {filteredAttendants.length > 6 && !showAllStaff && (
                <button type="button" onClick={() => setShowAllStaff(true)} className="flex min-h-14 w-full items-center justify-center text-lg font-bold text-gold">
                  Show all {filteredAttendants.length}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === "sales" && (
        <div className="space-y-4">
          <div role="group" aria-label="Period" className="grid grid-cols-4 gap-1 rounded-2xl bg-[var(--surface-muted)] p-1">
            {(["today", "week", "month", "all"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setSalesPeriod(p)}
                aria-pressed={salesPeriod === p}
                className={`min-h-12 rounded-xl text-base font-bold transition ${
                  salesPeriod === p ? "bg-gold text-ink-gold shadow-sm" : "text-ink-500"
                }`}
              >
                {p === "today" ? "Today" : p === "week" ? "7d" : p === "month" ? "30d" : "All"}
              </button>
            ))}
          </div>

          <section className="home-card !bg-black-700 text-white dark:!bg-black">
            <p className="text-4xl font-black tabular-nums">{ugx(salesSummary?.totalRevenueUgx ?? 0)}</p>
            <p className="mt-1 text-lg text-white/70">
              {(salesSummary?.totalLitres ?? 0).toFixed(1)} L · {salesSummary?.totalTransactions ?? 0} refuels
            </p>
          </section>

          <div className="grid grid-cols-2 gap-3">
            <div className="home-card !bg-green/10 border-green/20">
              <span className="flex items-center gap-1.5 text-base font-bold text-green"><Wallet className="h-5 w-5" aria-hidden /> Balance</span>
              <p className="mt-1 text-xl font-black tabular-nums text-green">{ugx(salesSummary?.availableBalanceUgx ?? 0)}</p>
            </div>
            <div className="home-card">
              <span className="flex items-center gap-1.5 text-base font-bold text-ink-500"><ArrowDownToLine className="h-5 w-5" aria-hidden /> Paid out</span>
              <p className="mt-1 text-xl font-black tabular-nums text-ink">{ugx(salesSummary?.withdrawnTotalUgx ?? 0)}</p>
            </div>
          </div>

          <Accordion title="By fuel" icon={Fuel} summary={salesSummary?.productBreakdown?.length ?? 0}>
            {salesSummary?.productBreakdown && salesSummary.productBreakdown.length > 0 ? (
              <div className="divide-y divide-[var(--border-faint)]">
                {salesSummary.productBreakdown.map((item) => (
                  <div key={item.product_id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <span className="block truncate text-lg font-bold text-ink">{item.product_name}</span>
                      <span className="text-base text-ink-500">{item.total_litres.toFixed(1)} L</span>
                    </div>
                    <span className="shrink-0 text-lg font-bold tabular-nums text-ink">{ugx(item.total_ugx)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-2 text-lg text-ink-500">None yet</p>
            )}
          </Accordion>

          <Accordion title="By attendant" icon={Users} summary={salesSummary?.attendantBreakdown?.length ?? 0}>
            {salesSummary?.attendantBreakdown && salesSummary.attendantBreakdown.length > 0 ? (
              <div className="divide-y divide-[var(--border-faint)]">
                {salesSummary.attendantBreakdown.map((item) => (
                  <div key={item.attendant_id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <span className="block truncate text-lg font-bold text-ink">{item.attendant_name}</span>
                      <span className="text-base text-ink-500">{item.total_dispenses}× · {item.total_litres.toFixed(1)} L</span>
                    </div>
                    <span className="shrink-0 text-lg font-bold tabular-nums text-ink">{ugx(item.total_ugx)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-2 text-lg text-ink-500">None yet</p>
            )}
          </Accordion>

          <Accordion title="Recent refuels" icon={Clock} summary={transactions.length}>
            {transactions.length > 0 ? (
              <div className="divide-y divide-[var(--border-faint)]">
                {transactions.slice(0, 8).map((tx) => (
                  <div key={tx.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <span className="block truncate text-lg font-bold text-ink">{tx.vehicle_plate}</span>
                      <span className="text-base text-ink-500">{tx.product_name} · {tx.litres_dispensed} L</span>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className="block text-lg font-bold tabular-nums text-ink">{ugx(tx.total_ugx)}</span>
                      <span className="text-base text-ink-500">
                        {new Date(tx.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-2 text-lg text-ink-500">None yet</p>
            )}
          </Accordion>
        </div>
      )}

      {activeTab === "withdrawals" && (
        <div className="space-y-4">
          <div className="home-card space-y-4 !bg-black-700 text-white dark:!bg-black">
            <div>
              <span className="text-base font-semibold text-white/70">Available</span>
              <h2 className="mt-1 text-4xl font-black tabular-nums text-white">{ugx(salesSummary?.availableBalanceUgx ?? 0)}</h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setWithdrawModalOpen(true);
                setWithdrawAmount(String(salesSummary?.availableBalanceUgx ?? 50000));
              }}
              disabled={(salesSummary?.availableBalanceUgx ?? 0) < 5000}
              className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-gold text-xl font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] transition active:scale-[0.98] disabled:opacity-50"
            >
              <ArrowDownToLine className="h-6 w-6" aria-hidden />
              <span>Withdraw</span>
            </button>
          </div>

          <Accordion title="Payout accounts" icon={CreditCard} summary={payoutAccounts.length}>
            {payoutAccounts.length > 0 ? (
              <div className="space-y-2">
                {payoutAccounts.map((acc) => (
                  <div key={acc.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--surface-muted)] p-3">
                    <div className="min-w-0">
                      <span className="block truncate text-lg font-bold text-ink">
                        {acc.account_name}{acc.is_primary ? " ★" : ""}
                      </span>
                      <span className="block truncate text-base text-ink-500">{acc.network_or_bank} · {acc.account_ref}</span>
                    </div>
                    <span className="shrink-0 text-base font-bold uppercase text-ink-500">{acc.type}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-2 text-lg text-ink-500">None saved</p>
            )}
            <button
              type="button"
              onClick={() => setAddAccountModalOpen(true)}
              className="flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[var(--surface-muted)] text-lg font-bold text-ink active:scale-95"
            >
              <Plus className="h-5 w-5" aria-hidden /> Add account
            </button>
          </Accordion>

          <Accordion title="History" icon={Clock} summary={withdrawals.length}>
            {withdrawals.length > 0 ? (
              <div className="divide-y divide-[var(--border-faint)]">
                {withdrawals.slice(0, 8).map((wd) => (
                  <div key={wd.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <span className="block text-lg font-bold tabular-nums text-ink">{ugx(wd.amount_ugx)}</span>
                      <span className="text-base text-ink-500">{wd.destination_type.toUpperCase()} · {new Date(wd.created_at).toLocaleDateString()}</span>
                    </div>
                    <span className="shrink-0 rounded-full bg-green/15 px-3 py-1 text-sm font-bold capitalize text-green">{wd.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="py-2 text-lg text-ink-500">None yet</p>
            )}
          </Accordion>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 1: COMMISSION NEW PUMP ATTENDANT */}
      {/* ============================================================== */}
      {commissionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="home-card w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="h-5 w-5 text-gold" />
                <h3 className="text-sm font-black text-ink">Commission Pump Attendant</h3>
              </div>
              <button
                type="button"
                onClick={() => setCommissionModalOpen(false)}
                className="rounded-full p-1 text-ink-500 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCommissionAttendant} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-ink-500">Attendant Full Name</label>
                <div className="field-box mt-1 px-3 py-2">
                  <input
                    required
                    value={newFullName}
                    onChange={(e) => setNewFullName(e.target.value)}
                    placeholder="e.g. Kato Dennis"
                    className="w-full font-bold text-ink outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="font-bold text-ink-500">Phone Number</label>
                <div className="field-box mt-1 px-3 py-2">
                  <input
                    required
                    value={newPhone}
                    onChange={(e) => setNewPhone(e.target.value)}
                    placeholder="+256 701 000 000"
                    className="w-full font-bold text-ink outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-bold text-ink-500">Badge Code</label>
                  <div className="field-box mt-1 px-3 py-2">
                    <input
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value.toUpperCase())}
                      placeholder="Auto (ATT-XXXX)"
                      className="w-full font-bold uppercase text-ink outline-none font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="font-bold text-ink-500">Assigned Lane</label>
                  <div className="field-box mt-1 px-3 py-2">
                    <select
                      value={newPumpLane}
                      onChange={(e) => setNewPumpLane(e.target.value)}
                      className="w-full font-bold text-ink bg-transparent outline-none cursor-pointer"
                    >
                      <option value="Pump 1">Pump 1</option>
                      <option value="Pump 2 (Boda Lane)">Pump 2 (Boda Lane)</option>
                      <option value="Pump 3">Pump 3</option>
                      <option value="Pump 4">Pump 4</option>
                      <option value="Pump 5">Pump 5</option>
                      <option value="Pump 6">Pump 6</option>
                    </select>
                  </div>
                </div>
              </div>

              <div>
                <label className="font-bold text-ink-500">Initial Staff PIN</label>
                <div className="field-box mt-1 px-3 py-2">
                  <input
                    value={newPin}
                    onChange={(e) => setNewPin(e.target.value)}
                    placeholder="Leave blank to generate"
                    inputMode="numeric"
                    maxLength={8}
                    className="w-full font-bold text-ink outline-none font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="approveImmediately"
                  checked={newApproveImmediately}
                  onChange={(e) => setNewApproveImmediately(e.target.checked)}
                  className="rounded border-[var(--border-faint)] text-gold"
                />
                <label htmlFor="approveImmediately" className="font-semibold text-ink cursor-pointer">
                  Approve immediately for on-duty dispensing
                </label>
              </div>

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setCommissionModalOpen(false)}
                  className="flex-1 rounded-xl bg-[var(--surface-muted)] py-2.5 font-bold text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={commissioningBusy}
                  className="flex-1 rounded-xl bg-gold py-2.5 font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] transition active:scale-95 disabled:opacity-50"
                >
                  {commissioningBusy ? "Saving…" : "Commission"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 2: WITHDRAW FUNDS */}
      {/* ============================================================== */}
      {withdrawModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="home-card w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
              <div className="flex items-center gap-2">
                <ArrowDownToLine className="h-5 w-5 text-gold" />
                <h3 className="text-sm font-black text-ink">Withdraw Station Funds</h3>
              </div>
              <button
                type="button"
                onClick={() => setWithdrawModalOpen(false)}
                className="rounded-full p-1 text-ink-500 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleWithdrawSubmit} className="space-y-3 text-xs">
              <div>
                <label className="font-bold text-ink-500">Amount (UGX)</label>
                <div className="field-box mt-1 px-3 py-2">
                  <input
                    required
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value.replace(/[^\d]/g, ""))}
                    placeholder="e.g. 50000"
                    className="w-full font-bold text-ink outline-none text-base font-mono"
                  />
                </div>
                {/* Quick Chips */}
                <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                  {[50000, 100000, 250000, 500000].map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => setWithdrawAmount(String(amt))}
                      className="rounded-lg bg-[var(--surface-muted)] px-2 py-0.5 text-[10px] font-bold text-ink hover:text-gold"
                    >
                      {amt.toLocaleString()}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setWithdrawAmount(String(salesSummary?.availableBalanceUgx ?? 0))}
                    className="rounded-lg bg-gold/20 px-2 py-0.5 text-[10px] font-bold text-gold"
                  >
                    Max
                  </button>
                </div>
              </div>

              {/* Destination Type Selector */}
              <div>
                <label className="font-bold text-ink-500">Destination Method</label>
                <div className="flex rounded-xl bg-[var(--surface-muted)] p-1 border border-[var(--border-faint)] mt-1">
                  <button
                    type="button"
                    onClick={() => setWithdrawDestType("momo")}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                      withdrawDestType === "momo"
                        ? "bg-[var(--surface-raised)] text-ink shadow-sm"
                        : "text-ink-500"
                    }`}
                  >
                    Mobile Money
                  </button>
                  <button
                    type="button"
                    onClick={() => setWithdrawDestType("bank")}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                      withdrawDestType === "bank"
                        ? "bg-[var(--surface-raised)] text-ink shadow-sm"
                        : "text-ink-500"
                    }`}
                  >
                    Bank Account
                  </button>
                </div>
              </div>

              {/* Saved Account Option */}
              {payoutAccounts.filter((a) => a.type === withdrawDestType).length > 0 && (
                <div>
                  <label className="font-bold text-ink-500">Select Saved Account</label>
                  <div className="field-box mt-1 px-3 py-2">
                    <select
                      value={selectedAccountId}
                      onChange={(e) => setSelectedAccountId(e.target.value)}
                      className="w-full font-bold text-ink bg-transparent outline-none cursor-pointer"
                    >
                      {payoutAccounts
                        .filter((a) => a.type === withdrawDestType)
                        .map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.network_or_bank} · {acc.account_ref} ({acc.account_name})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
              )}

              {/* Manual Input if no saved account selected */}
              {!selectedAccountId && withdrawDestType === "momo" && (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="font-bold text-ink-500">Network</label>
                      <div className="field-box mt-1 px-3 py-2">
                        <select
                          value={momoNetwork}
                          onChange={(e) => setMomoNetwork(e.target.value as any)}
                          className="w-full font-bold text-ink bg-transparent outline-none cursor-pointer"
                        >
                          <option value="MTN">MTN MoMo</option>
                          <option value="Airtel">Airtel Money</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="font-bold text-ink-500">MoMo Number</label>
                      <div className="field-box mt-1 px-3 py-2">
                        <input
                          value={momoPhone}
                          onChange={(e) => setMomoPhone(e.target.value)}
                          placeholder="+256 700 000 000"
                          className="w-full font-bold text-ink outline-none"
                        />
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="font-bold text-ink-500">Registered Name</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <input
                        value={momoName}
                        onChange={(e) => setMomoName(e.target.value)}
                        placeholder="e.g. TotalEnergies Settlement"
                        className="w-full font-bold text-ink outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              {!selectedAccountId && withdrawDestType === "bank" && (
                <div className="space-y-2">
                  <div>
                    <label className="font-bold text-ink-500">Bank Name</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <select
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="w-full font-bold text-ink bg-transparent outline-none cursor-pointer"
                      >
                        <option value="Stanbic Bank">Stanbic Bank Uganda</option>
                        <option value="Centenary Bank">Centenary Bank</option>
                        <option value="Absa Bank">Absa Bank Uganda</option>
                        <option value="Equity Bank">Equity Bank</option>
                        <option value="DFCU Bank">DFCU Bank</option>
                        <option value="Standard Chartered">Standard Chartered</option>
                        <option value="PostBank Uganda">PostBank Uganda</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="font-bold text-ink-500">Account Number</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <input
                        value={bankAccNum}
                        onChange={(e) => setBankAccNum(e.target.value)}
                        placeholder="e.g. 9030018822331"
                        className="w-full font-bold text-ink outline-none font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="font-bold text-ink-500">Account Name</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <input
                        value={bankAccName}
                        onChange={(e) => setBankAccName(e.target.value)}
                        placeholder="Company or Dealer Account Name"
                        className="w-full font-bold text-ink outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setWithdrawModalOpen(false)}
                  className="flex-1 rounded-xl bg-[var(--surface-muted)] py-2.5 font-bold text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={withdrawBusy}
                  className="flex-1 rounded-xl bg-gold py-2.5 font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] transition active:scale-95 disabled:opacity-50"
                >
                  {withdrawBusy ? "Processing…" : "Submit Payout"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================== */}
      {/* MODAL 3: ADD PAYOUT ACCOUNT */}
      {/* ============================================================== */}
      {addAccountModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="home-card w-full max-w-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="h-5 w-5 text-gold" />
                <h3 className="text-sm font-black text-ink">Add Payout Account</h3>
              </div>
              <button
                type="button"
                onClick={() => setAddAccountModalOpen(false)}
                className="rounded-full p-1 text-ink-500 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                try {
                  await api.gasManagerAddPayoutAccount({
                    outletId,
                    type: withdrawDestType,
                    accountRef: withdrawDestType === "momo" ? momoPhone.trim() : bankAccNum.trim(),
                    accountName: withdrawDestType === "momo" ? momoName.trim() : bankAccName.trim(),
                    networkOrBank: withdrawDestType === "momo" ? momoNetwork : bankName,
                    isPrimary: true,
                  });
                  showToast("Payout account saved successfully.");
                  setAddAccountModalOpen(false);
                  void fetchWithdrawals();
                } catch (err) {
                  setActionError(errorMessage(err));
                }
              }}
              className="space-y-3 text-xs"
            >
              <div>
                <label className="font-bold text-ink-500">Account Type</label>
                <div className="flex rounded-xl bg-[var(--surface-muted)] p-1 border border-[var(--border-faint)] mt-1">
                  <button
                    type="button"
                    onClick={() => setWithdrawDestType("momo")}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                      withdrawDestType === "momo"
                        ? "bg-[var(--surface-raised)] text-ink shadow-sm"
                        : "text-ink-500"
                    }`}
                  >
                    Mobile Money
                  </button>
                  <button
                    type="button"
                    onClick={() => setWithdrawDestType("bank")}
                    className={`flex-1 rounded-lg py-1.5 text-xs font-bold transition ${
                      withdrawDestType === "bank"
                        ? "bg-[var(--surface-raised)] text-ink shadow-sm"
                        : "text-ink-500"
                    }`}
                  >
                    Bank
                  </button>
                </div>
              </div>

              {withdrawDestType === "momo" ? (
                <>
                  <div>
                    <label className="font-bold text-ink-500">Network</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <select
                        value={momoNetwork}
                        onChange={(e) => setMomoNetwork(e.target.value as any)}
                        className="w-full font-bold text-ink bg-transparent outline-none cursor-pointer"
                      >
                        <option value="MTN">MTN Uganda</option>
                        <option value="Airtel">Airtel Uganda</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="font-bold text-ink-500">Mobile Money Phone Number</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <input
                        required
                        value={momoPhone}
                        onChange={(e) => setMomoPhone(e.target.value)}
                        placeholder="+256 700 000 000"
                        className="w-full font-bold text-ink outline-none"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="font-bold text-ink-500">Registered Account Name</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <input
                        required
                        value={momoName}
                        onChange={(e) => setMomoName(e.target.value)}
                        placeholder="e.g. TotalEnergies Lugogo Settlement"
                        className="w-full font-bold text-ink outline-none"
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="font-bold text-ink-500">Bank Name</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <select
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="w-full font-bold text-ink bg-transparent outline-none cursor-pointer"
                      >
                        <option value="Stanbic Bank">Stanbic Bank Uganda</option>
                        <option value="Centenary Bank">Centenary Bank</option>
                        <option value="Absa Bank">Absa Bank Uganda</option>
                        <option value="Equity Bank">Equity Bank</option>
                        <option value="DFCU Bank">DFCU Bank</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="font-bold text-ink-500">Account Number</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <input
                        required
                        value={bankAccNum}
                        onChange={(e) => setBankAccNum(e.target.value)}
                        placeholder="Account Number"
                        className="w-full font-bold text-ink outline-none font-mono"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="font-bold text-ink-500">Registered Account Name</label>
                    <div className="field-box mt-1 px-3 py-2">
                      <input
                        required
                        value={bankAccName}
                        onChange={(e) => setBankAccName(e.target.value)}
                        placeholder="Company or Dealer Account Name"
                        className="w-full font-bold text-ink outline-none"
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setAddAccountModalOpen(false)}
                  className="flex-1 rounded-xl bg-[var(--surface-muted)] py-2.5 font-bold text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-gold py-2.5 font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] transition active:scale-95"
                >
                  Save Account
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
