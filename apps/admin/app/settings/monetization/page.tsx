"use client";

import {
  hasPermission,
  type CashFeeSource,
  type ProcessingFeeMode,
  type ServiceFeeType,
  type SubscriptionCadence,
  type SubscriptionMode,
} from "@tuma/shared";
import { useEffect, useState } from "react";
import { SettingsPageShell, SettingsSaveBar } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

export default function MonetizationSettingsPage() {
  const { user } = useAuth();
  const canManagePayments = hasPermission(user?.adminRole ?? null, "payments.manage");
  const [deliveryCommissionEnabled, setDeliveryCommissionEnabled] = useState(false);
  const [deliveryCommissionParcelPercent, setDeliveryCommissionParcelPercent] = useState("0");
  const [deliveryCommissionShoppingPercent, setDeliveryCommissionShoppingPercent] = useState("0");
  const [serviceFeeEnabled, setServiceFeeEnabled] = useState(false);
  const [serviceFeeType, setServiceFeeType] = useState<ServiceFeeType>("flat");
  const [serviceFeeValue, setServiceFeeValue] = useState("0");
  const [processingFeeEnabled, setProcessingFeeEnabled] = useState(false);
  const [processingFeePercent, setProcessingFeePercent] = useState("0");
  const [processingFeeMode, setProcessingFeeMode] = useState<ProcessingFeeMode>("customer");
  const [processingFeeSplitCustomerPercent, setProcessingFeeSplitCustomerPercent] = useState("50");
  const [cashFeeSource, setCashFeeSource] = useState<CashFeeSource>("wallet");
  const [subscriptionEnabled, setSubscriptionEnabled] = useState(false);
  const [subscriptionMode, setSubscriptionMode] = useState<SubscriptionMode>("recurring");
  const [subscriptionAmount, setSubscriptionAmount] = useState("0");
  const [subscriptionCadence, setSubscriptionCadence] = useState<SubscriptionCadence>("weekly");
  const [proEnabled, setProEnabled] = useState(false);
  const [proRecurringEnabled, setProRecurringEnabled] = useState(false);
  const [proRecurringAmount, setProRecurringAmount] = useState("0");
  const [proRecurringCadence, setProRecurringCadence] = useState<SubscriptionCadence>("weekly");
  const [proOnetimeEnabled, setProOnetimeEnabled] = useState(false);
  const [proOnetimeAmount, setProOnetimeAmount] = useState("0");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => {
        setDeliveryCommissionEnabled(settings.deliveryCommissionEnabled);
        setDeliveryCommissionParcelPercent(String(settings.deliveryCommissionParcelPercent));
        setDeliveryCommissionShoppingPercent(String(settings.deliveryCommissionShoppingPercent));
        setServiceFeeEnabled(settings.serviceFeeEnabled);
        setServiceFeeType(settings.serviceFeeType);
        setServiceFeeValue(String(settings.serviceFeeValue));
        setProcessingFeeEnabled(settings.processingFeeEnabled);
        setProcessingFeePercent(String(settings.processingFeePercent));
        setProcessingFeeMode(settings.processingFeeMode);
        setProcessingFeeSplitCustomerPercent(String(settings.processingFeeSplitCustomerPercent));
        setCashFeeSource(settings.cashFeeSource);
        setSubscriptionEnabled(settings.subscriptionEnabled);
        setSubscriptionMode(settings.subscriptionMode);
        setSubscriptionAmount(String(settings.subscriptionAmount));
        setSubscriptionCadence(settings.subscriptionCadence);
        setProEnabled(settings.proSubscriptionEnabled);
        setProRecurringEnabled(settings.proRecurringEnabled);
        setProRecurringAmount(String(settings.proRecurringAmount));
        setProRecurringCadence(settings.proRecurringCadence);
        setProOnetimeEnabled(settings.proOnetimeEnabled);
        setProOnetimeAmount(String(settings.proOnetimeAmount));
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
        deliveryCommissionEnabled,
        deliveryCommissionParcelPercent: Number(deliveryCommissionParcelPercent),
        deliveryCommissionShoppingPercent: Number(deliveryCommissionShoppingPercent),
        serviceFeeEnabled,
        serviceFeeType,
        serviceFeeValue: Number(serviceFeeValue),
        processingFeeEnabled,
        processingFeePercent: Number(processingFeePercent),
        processingFeeMode,
        processingFeeSplitCustomerPercent: Number(processingFeeSplitCustomerPercent),
        cashFeeSource,
        subscriptionEnabled,
        subscriptionMode,
        subscriptionAmount: Number(subscriptionAmount),
        subscriptionCadence,
        proSubscriptionEnabled: proEnabled,
        proRecurringEnabled,
        proRecurringAmount: Number(proRecurringAmount),
        proRecurringCadence,
        proOnetimeEnabled,
        proOnetimeAmount: Number(proOnetimeAmount),
      });
      setDeliveryCommissionEnabled(res.settings.deliveryCommissionEnabled);
      setDeliveryCommissionParcelPercent(String(res.settings.deliveryCommissionParcelPercent));
      setDeliveryCommissionShoppingPercent(String(res.settings.deliveryCommissionShoppingPercent));
      setServiceFeeEnabled(res.settings.serviceFeeEnabled);
      setServiceFeeType(res.settings.serviceFeeType);
      setServiceFeeValue(String(res.settings.serviceFeeValue));
      setProcessingFeeEnabled(res.settings.processingFeeEnabled);
      setProcessingFeePercent(String(res.settings.processingFeePercent));
      setProcessingFeeMode(res.settings.processingFeeMode);
      setProcessingFeeSplitCustomerPercent(String(res.settings.processingFeeSplitCustomerPercent));
      setCashFeeSource(res.settings.cashFeeSource);
      setSubscriptionEnabled(res.settings.subscriptionEnabled);
      setSubscriptionMode(res.settings.subscriptionMode);
      setSubscriptionAmount(String(res.settings.subscriptionAmount));
      setSubscriptionCadence(res.settings.subscriptionCadence);
      setProEnabled(res.settings.proSubscriptionEnabled);
      setProRecurringEnabled(res.settings.proRecurringEnabled);
      setProRecurringAmount(String(res.settings.proRecurringAmount));
      setProRecurringCadence(res.settings.proRecurringCadence);
      setProOnetimeEnabled(res.settings.proOnetimeEnabled);
      setProOnetimeAmount(String(res.settings.proOnetimeAmount));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!loading && !canManagePayments) {
    return (
      <SettingsPageShell title="Monetization" loading={false}>
        <p className="text-sm text-ink-500">You don&apos;t have permission to manage this.</p>
      </SettingsPageShell>
    );
  }

  return (
    <SettingsPageShell title="Monetization" loading={loading}>
      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <p className="text-xs text-ink-500">
            Every mechanism below is independent — turn on whichever ones should be active and set their own rate.
            Off means exactly what it was before: 100% of what&apos;s collected goes to the rider.
          </p>

          {/* Delivery commission */}
          <div className="rounded-xl border border-[var(--border-faint)] p-3 space-y-2.5">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={deliveryCommissionEnabled}
                onChange={(e) => setDeliveryCommissionEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">Delivery commission</span>
                <span className="block text-xs text-ink-500">
                  A % of the delivery fee only — never the item cost — withheld from the rider&apos;s payout at
                  settle. Set separately per order type since a parcel ride&apos;s whole total is its delivery fee.
                </span>
              </span>
            </label>
            {deliveryCommissionEnabled && (
              <div className="grid grid-cols-2 gap-3 pl-6.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="commissionParcel">
                    Parcel orders (%)
                  </label>
                  <input
                    id="commissionParcel"
                    inputMode="numeric"
                    value={deliveryCommissionParcelPercent}
                    onChange={(e) => setDeliveryCommissionParcelPercent(e.target.value.replace(/[^\d.]/g, ""))}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="commissionShopping">
                    Shopping orders (%)
                  </label>
                  <input
                    id="commissionShopping"
                    inputMode="numeric"
                    value={deliveryCommissionShoppingPercent}
                    onChange={(e) => setDeliveryCommissionShoppingPercent(e.target.value.replace(/[^\d.]/g, ""))}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Customer service fee */}
          <div className="rounded-xl border border-[var(--border-faint)] p-3 space-y-2.5">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={serviceFeeEnabled}
                onChange={(e) => setServiceFeeEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">Customer service fee</span>
                <span className="block text-xs text-ink-500">
                  Added on top of what the customer pays at checkout — 100% platform revenue, doesn&apos;t touch
                  the rider&apos;s payout at all.
                </span>
              </span>
            </label>
            {serviceFeeEnabled && (
              <div className="grid grid-cols-2 gap-3 pl-6.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="serviceFeeType">
                    Type
                  </label>
                  <select
                    id="serviceFeeType"
                    value={serviceFeeType}
                    onChange={(e) => setServiceFeeType(e.target.value as ServiceFeeType)}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                  >
                    <option value="flat">Flat amount</option>
                    <option value="percent">Percentage</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="serviceFeeValue">
                    {serviceFeeType === "flat" ? "Amount (UGX)" : "Rate (%)"}
                  </label>
                  <input
                    id="serviceFeeValue"
                    inputMode="numeric"
                    value={serviceFeeValue}
                    onChange={(e) => setServiceFeeValue(e.target.value.replace(/[^\d.]/g, ""))}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Processing / transaction fee */}
          <div className="rounded-xl border border-[var(--border-faint)] p-3 space-y-2.5">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={processingFeeEnabled}
                onChange={(e) => setProcessingFeeEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
              />
              <span>
                <span className="block text-sm font-semibold text-ink">Transaction / processing fee</span>
                <span className="block text-xs text-ink-500">
                  Recovers the real cost of moving money through a payment rail — charge it to the customer, to the
                  rider, or split between both. Skipped automatically for wallet-funded and cash/float orders,
                  since neither touches an external payment rail.
                </span>
              </span>
            </label>
            {processingFeeEnabled && (
              <div className="space-y-2.5 pl-6.5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-500" htmlFor="processingFeePercent">
                      Rate (%)
                    </label>
                    <input
                      id="processingFeePercent"
                      inputMode="numeric"
                      value={processingFeePercent}
                      onChange={(e) => setProcessingFeePercent(e.target.value.replace(/[^\d.]/g, ""))}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-500" htmlFor="processingFeeMode">
                      Who bears it
                    </label>
                    <select
                      id="processingFeeMode"
                      value={processingFeeMode}
                      onChange={(e) => setProcessingFeeMode(e.target.value as ProcessingFeeMode)}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                    >
                      <option value="customer">Customer (added at checkout)</option>
                      <option value="rider">Rider (withheld at settle)</option>
                      <option value="split">Split between both</option>
                    </select>
                  </div>
                </div>
                {processingFeeMode === "split" && (
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-500" htmlFor="processingFeeSplit">
                      Customer&apos;s share of the split (%) — rider bears the rest
                    </label>
                    <input
                      id="processingFeeSplit"
                      inputMode="numeric"
                      value={processingFeeSplitCustomerPercent}
                      onChange={(e) => setProcessingFeeSplitCustomerPercent(e.target.value.replace(/[^\d.]/g, ""))}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cash-order platform fee source */}
          <div className="rounded-xl border border-[var(--border-faint)] p-3 space-y-2.5">
            <span className="text-sm font-semibold text-ink">Cash-order platform fee</span>
            <p className="text-xs text-ink-500">
              On a cash order the customer pays the rider everything in person — items, delivery, and Tuma&apos;s
              own cut all together. Pick where that cut comes back out of.
            </p>
            <div className="space-y-1">
              <select
                value={cashFeeSource}
                onChange={(e) => setCashFeeSource(e.target.value as CashFeeSource)}
                className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
              >
                <option value="wallet">Rider&apos;s wallet (can go negative, nets against their next payout)</option>
                <option value="deposit">Rider&apos;s deposit (blocks new jobs until topped back up)</option>
              </select>
              <p className="text-xs text-ink-500">
                {cashFeeSource === "deposit"
                  ? "Uses the rider minimum-balance reserve as the required deposit — once a rider's balance drops below it, they can't claim or apply for anything new until they top back up."
                  : "The fee is simply deducted from the rider's wallet balance, same one their escrow payouts land in — no restriction on taking new jobs either way."}
              </p>
            </div>
          </div>

          {/* Rider subscription */}
          <div className="rounded-xl border border-[var(--border-faint)] p-3 space-y-2.5">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={subscriptionEnabled}
                onChange={(e) => setSubscriptionEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
              />
              <span>
                <span className="text-sm font-semibold text-ink">Rider subscription</span>
                <span className="block text-xs text-ink-500">
                  Riders pay this from their own mobile money number before they can claim or apply for jobs.
                  Charged and enforced automatically — a lapsed rider is blocked from matching until they pay.
                </span>
              </span>
            </label>
            {subscriptionEnabled && (
              <div className="space-y-2.5 pl-6.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-ink-500" htmlFor="subscriptionMode">
                    Billing mode
                  </label>
                  <select
                    id="subscriptionMode"
                    value={subscriptionMode}
                    onChange={(e) => setSubscriptionMode(e.target.value as SubscriptionMode)}
                    className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                  >
                    <option value="recurring">Recurring — bills every cadence</option>
                    <option value="once">One-time — a single lifetime fee at activation</option>
                  </select>
                  <p className="text-xs text-ink-500">
                    {subscriptionMode === "once"
                      ? "Charged once. A rider who pays never needs to renew — their subscription stays active for good."
                      : "Renewed automatically by a daily check — a rider whose payment fails is blocked from matching until it succeeds."}
                  </p>
                </div>
                <div className={`grid gap-3 ${subscriptionMode === "recurring" ? "grid-cols-2" : "grid-cols-1"}`}>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-ink-500" htmlFor="subscriptionAmount">
                      Amount (UGX)
                    </label>
                    <input
                      id="subscriptionAmount"
                      inputMode="numeric"
                      value={subscriptionAmount}
                      onChange={(e) => setSubscriptionAmount(e.target.value.replace(/[^\d.]/g, ""))}
                      className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                    />
                  </div>
                  {subscriptionMode === "recurring" && (
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-ink-500" htmlFor="subscriptionCadence">
                        Cadence
                      </label>
                      <select
                        id="subscriptionCadence"
                        value={subscriptionCadence}
                        onChange={(e) => setSubscriptionCadence(e.target.value as SubscriptionCadence)}
                        className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                      </select>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Rider Pro — a separate, optional paid tier from the rider
              subscription above, which gates job matching itself. Pro
              instead unlocks premium perks (Luganda list reading, Stage
              Savings) that each have their own "Require a Pro subscription"
              switch on their own settings page. */}
          <div className="rounded-xl border border-[var(--border-faint)] p-3 space-y-2.5">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={proEnabled}
                onChange={(e) => setProEnabled(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
              />
              <span>
                <span className="text-sm font-semibold text-ink">Rider Pro</span>
                <span className="block text-xs text-ink-500">
                  A separate paid tier from the rider subscription above — unlocks premium perks rather than
                  gating job matching. Charged to the rider&apos;s own mobile money number.
                </span>
              </span>
            </label>
            {proEnabled && (
              <div className="space-y-3 pl-6.5">
                <div className="rounded-xl border border-[var(--border-faint)] p-2.5 space-y-2">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={proRecurringEnabled}
                      onChange={(e) => setProRecurringEnabled(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
                    />
                    <span>
                      <span className="text-sm font-semibold text-ink">Recurring plan</span>
                      <span className="block text-xs text-ink-500">Bills every cadence until cancelled.</span>
                    </span>
                  </label>
                  {proRecurringEnabled && (
                    <div className="grid grid-cols-2 gap-3 pl-6.5">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-ink-500" htmlFor="proRecurringAmount">
                          Amount (UGX)
                        </label>
                        <input
                          id="proRecurringAmount"
                          inputMode="numeric"
                          value={proRecurringAmount}
                          onChange={(e) => setProRecurringAmount(e.target.value.replace(/[^\d.]/g, ""))}
                          className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-ink-500" htmlFor="proRecurringCadence">
                          Cadence
                        </label>
                        <select
                          id="proRecurringCadence"
                          value={proRecurringCadence}
                          onChange={(e) => setProRecurringCadence(e.target.value as SubscriptionCadence)}
                          className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                        >
                          <option value="daily">Daily</option>
                          <option value="weekly">Weekly</option>
                          <option value="monthly">Monthly</option>
                        </select>
                      </div>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--border-faint)] p-2.5 space-y-2">
                  <label className="flex items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={proOnetimeEnabled}
                      onChange={(e) => setProOnetimeEnabled(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-gold"
                    />
                    <span>
                      <span className="text-sm font-semibold text-ink">One-time plan</span>
                      <span className="block text-xs text-ink-500">
                        A single lifetime charge — a rider who pays never needs to renew.
                      </span>
                    </span>
                  </label>
                  {proOnetimeEnabled && (
                    <div className="pl-6.5">
                      <label className="text-xs font-semibold text-ink-500" htmlFor="proOnetimeAmount">
                        Amount (UGX)
                      </label>
                      <input
                        id="proOnetimeAmount"
                        inputMode="numeric"
                        value={proOnetimeAmount}
                        onChange={(e) => setProOnetimeAmount(e.target.value.replace(/[^\d.]/g, ""))}
                        className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
                      />
                    </div>
                  )}
                </div>

                {proRecurringEnabled && proOnetimeEnabled && (
                  <p className="text-xs text-ink-500">
                    Both plans are on — a rider will see both prices and choose which one to buy.
                  </p>
                )}
                {!proRecurringEnabled && !proOnetimeEnabled && (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                    Turn on at least one plan, or riders won&apos;t be able to buy Pro at all.
                  </p>
                )}
              </div>
            )}
          </div>
        </section>
        <SettingsSaveBar busy={busy} error={error} saved={saved} />
      </form>
    </SettingsPageShell>
  );
}
