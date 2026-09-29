"use client";

import {
  hasPermission,
  type VslaAdminLedgerVisibility,
  type VslaContributionRecorderRole,
  type VslaFeaturePlacement,
} from "@tuma/shared";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

export default function StageSavingsSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");

  const [loanInterestEnabled, setLoanInterestEnabled] = useState(true);
  const [defaultInterestRate, setDefaultInterestRate] = useState("8");
  const [defaultLoanableMultiple, setDefaultLoanableMultiple] = useState("2");
  const [defaultCycleMonths, setDefaultCycleMonths] = useState("12");
  const [defaultMaxLoanMonths, setDefaultMaxLoanMonths] = useState("3");
  const [contributionRecorderRole, setContributionRecorderRole] = useState<VslaContributionRecorderRole>("any_officer");
  const [cashDoubleCheckRequired, setCashDoubleCheckRequired] = useState(false);
  const [adminLedgerVisibility, setAdminLedgerVisibility] = useState<VslaAdminLedgerVisibility>("read_only_all");
  const [unconfirmedIntentEscalationHours, setUnconfirmedIntentEscalationHours] = useState("6");
  const [featurePlacement, setFeaturePlacement] = useState<VslaFeaturePlacement>("home_card_and_screen");
  const [defaultSharePrice, setDefaultSharePrice] = useState("1000");
  const [requiresPro, setRequiresPro] = useState(false);

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setLoanInterestEnabled(settings.vslaLoanInterestEnabled);
        setDefaultInterestRate(String(settings.vslaDefaultInterestRate));
        setDefaultLoanableMultiple(String(settings.vslaDefaultLoanableMultiple));
        setDefaultCycleMonths(String(settings.vslaDefaultCycleMonths));
        setDefaultMaxLoanMonths(String(settings.vslaDefaultMaxLoanMonths));
        setContributionRecorderRole(settings.vslaContributionRecorderRole);
        setCashDoubleCheckRequired(settings.vslaCashDoubleCheckRequired);
        setAdminLedgerVisibility(settings.vslaAdminLedgerVisibility);
        setUnconfirmedIntentEscalationHours(String(settings.vslaUnconfirmedIntentEscalationHours));
        setFeaturePlacement(settings.vslaFeaturePlacement);
        setDefaultSharePrice(String(settings.vslaDefaultSharePrice));
        setRequiresPro(settings.vslaRequiresPro);
      })
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.adminUpdateSettings({
        vslaLoanInterestEnabled: loanInterestEnabled,
        vslaDefaultInterestRate: Number(defaultInterestRate),
        vslaDefaultLoanableMultiple: Number(defaultLoanableMultiple),
        vslaDefaultCycleMonths: Number(defaultCycleMonths),
        vslaDefaultMaxLoanMonths: Number(defaultMaxLoanMonths),
        vslaContributionRecorderRole: contributionRecorderRole,
        vslaCashDoubleCheckRequired: cashDoubleCheckRequired,
        vslaAdminLedgerVisibility: adminLedgerVisibility,
        vslaUnconfirmedIntentEscalationHours: Number(unconfirmedIntentEscalationHours),
        vslaFeaturePlacement: featurePlacement,
        vslaDefaultSharePrice: Number(defaultSharePrice),
        vslaRequiresPro: requiresPro,
      });
      setLoanInterestEnabled(res.settings.vslaLoanInterestEnabled);
      setDefaultInterestRate(String(res.settings.vslaDefaultInterestRate));
      setDefaultLoanableMultiple(String(res.settings.vslaDefaultLoanableMultiple));
      setDefaultCycleMonths(String(res.settings.vslaDefaultCycleMonths));
      setDefaultMaxLoanMonths(String(res.settings.vslaDefaultMaxLoanMonths));
      setContributionRecorderRole(res.settings.vslaContributionRecorderRole);
      setCashDoubleCheckRequired(res.settings.vslaCashDoubleCheckRequired);
      setAdminLedgerVisibility(res.settings.vslaAdminLedgerVisibility);
      setUnconfirmedIntentEscalationHours(String(res.settings.vslaUnconfirmedIntentEscalationHours));
      setFeaturePlacement(res.settings.vslaFeaturePlacement);
      setDefaultSharePrice(String(res.settings.vslaDefaultSharePrice));
      setRequiresPro(res.settings.vslaRequiresPro);
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !canManagePayments) {
    return (
      <SettingsPageShell title="Stage savings circles" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Stage savings circles" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <p className="rounded-lg bg-[rgb(var(--surface-muted))] px-3 py-2 text-xs text-ink-500">
          A rider can propose any stage; every proposal goes through the <Link href="/stages/pending" className="font-bold text-gold">pending stages</Link> approval
          queue before it can have an RSLA. There&apos;s no separate on/off switch for that anymore.
        </p>

        <section className="home-card space-y-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={loanInterestEnabled}
              onChange={(e) => setLoanInterestEnabled(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">Loans carry interest</span>
              <span className="block text-xs text-ink-500">
                Interest is paid back into the group&apos;s own pot, never to Tuma — it&apos;s how the group&apos;s
                savings grow before share-out.
              </span>
            </span>
          </label>
          {loanInterestEnabled && (
            <div className="space-y-1 pl-6.5">
              <label className="text-xs font-semibold text-ink-500" htmlFor="defaultInterestRate">
                Default interest rate (%) — a stage&apos;s officers can adjust this for their own cycle
              </label>
              <input
                id="defaultInterestRate"
                inputMode="numeric"
                value={defaultInterestRate}
                onChange={(e) => setDefaultInterestRate(e.target.value.replace(/[^\d.]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
          )}
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">Default cycle numbers</h2>
          <p className="text-xs text-ink-500">
            Applied when a stage starts a new cycle; its officers can adjust these for their own circle.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="loanableMultiple">
                Loanable multiple
              </label>
              <input
                id="loanableMultiple"
                inputMode="numeric"
                value={defaultLoanableMultiple}
                onChange={(e) => setDefaultLoanableMultiple(e.target.value.replace(/[^\d.]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
              <p className="text-[11px] text-ink-500">Max loan = savings × this.</p>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="cycleMonths">
                Cycle length (months)
              </label>
              <input
                id="cycleMonths"
                inputMode="numeric"
                value={defaultCycleMonths}
                onChange={(e) => setDefaultCycleMonths(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="maxLoanMonths">
                Max loan duration (months)
              </label>
              <input
                id="maxLoanMonths"
                inputMode="numeric"
                value={defaultMaxLoanMonths}
                onChange={(e) => setDefaultMaxLoanMonths(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500" htmlFor="sharePrice">
                Default share price (UGX)
              </label>
              <input
                id="sharePrice"
                inputMode="numeric"
                value={defaultSharePrice}
                onChange={(e) => setDefaultSharePrice(e.target.value.replace(/[^\d]/g, ""))}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              />
              <p className="text-[11px] text-ink-500">Contributions are declared in shares × this price.</p>
            </div>
          </div>
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">Who can confirm cash received</h2>
          <select
            value={contributionRecorderRole}
            onChange={(e) => setContributionRecorderRole(e.target.value as VslaContributionRecorderRole)}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          >
            <option value="any_officer">Any elected officer</option>
            <option value="treasurer_only">Treasurer only</option>
          </select>

          <label className="flex items-start gap-2.5 pt-2">
            <input
              type="checkbox"
              checked={cashDoubleCheckRequired}
              onChange={(e) => setCashDoubleCheckRequired(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">Require a second officer to confirm</span>
              <span className="block text-xs text-ink-500">
                Adds friction to every entry, but catches mistakes/disputes earlier.
              </span>
            </span>
          </label>
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">Unconfirmed savings/repayment intents</h2>
          <label className="text-xs font-semibold text-ink-500" htmlFor="escalationHours">
            Hours before the app prompts a member to call/message the treasurer
          </label>
          <input
            id="escalationHours"
            inputMode="numeric"
            value={unconfirmedIntentEscalationHours}
            onChange={(e) => setUnconfirmedIntentEscalationHours(e.target.value.replace(/[^\d]/g, ""))}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          />
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">Admin visibility</h2>
          <select
            value={adminLedgerVisibility}
            onChange={(e) => setAdminLedgerVisibility(e.target.value as VslaAdminLedgerVisibility)}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          >
            <option value="read_only_all">Tuma admin can view every stage&apos;s ledger (read-only)</option>
            <option value="private_per_stage">Fully private — only each stage&apos;s own members can see it</option>
          </select>
          <p className="text-xs text-ink-500">
            Read-only visibility is for support and technical issues only — money disagreements between members
            stay inside the group.
          </p>
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">Where it shows up in the rider app</h2>
          <select
            value={featurePlacement}
            onChange={(e) => setFeaturePlacement(e.target.value as VslaFeaturePlacement)}
            className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
          >
            <option value="home_card_and_screen">A card on Home, plus its own screen</option>
            <option value="bottom_nav_tab">Its own bottom-nav tab</option>
            <option value="account_only">Tucked under Account</option>
            <option value="wallet_card">A card on Wallet, below the balance</option>
          </select>
        </section>

        <section className="home-card space-y-3">
          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={requiresPro}
              onChange={(e) => setRequiresPro(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
            />
            <span>
              <span className="block text-sm font-semibold text-ink">Require a Pro subscription</span>
              <span className="block text-xs text-ink-500">
                Only affects joining or creating a stage from here on — a rider who already belongs to a stage
                keeps free access, forever. Set the Pro price under Settings → Monetization.
              </span>
            </span>
          </label>
        </section>

        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>

      {adminLedgerVisibility === "read_only_all" && (
        <Link href="/stages" className="mt-5 block text-center text-sm font-bold text-gold">
          View all stage circles →
        </Link>
      )}
    </SettingsPageShell>
  );
}
