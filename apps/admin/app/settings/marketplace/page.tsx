"use client";

import { Fold } from "../../../components/Fold";
import { ModuleState } from "../../../components/ModuleState";
import { hasPermission, type MarketplaceSettings } from "@peebee/shared";
import { AlertCircle, CheckCircle2, Crown, Flame, Layers, Radio, ShoppingBag, Sparkles, Store, Tv, Video } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SettingsPageShell } from "../../../components/SettingsPageShell";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";

export default function MarketplaceSettingsPage() {
  const { user } = useAuth();
  const canManage = hasPermission(user?.adminRole ?? null, "settings.manage");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form State
  const [enabled, setEnabled] = useState(true);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [commissionPercent, setCommissionPercent] = useState(10);
  const [proPricingMode, setProPricingMode] = useState<"free" | "paid">("free");
  const [proStorePriceUgx, setProStorePriceUgx] = useState(35000);
  const [proLivePriceUgx, setProLivePriceUgx] = useState(75000);
  const [proTrialDays, setProTrialDays] = useState(14);
  const [minOrderAmountUgx, setMinOrderAmountUgx] = useState(5000);
  const [deliveryBaseFeeUgx, setDeliveryBaseFeeUgx] = useState(3000);
  const [liveMaxDurationMins, setLiveMaxDurationMins] = useState(180);
  const [adMinBudgetUgx, setAdMinBudgetUgx] = useState(10000);
  const [adFeePercent, setAdFeePercent] = useState(5);
  const [cartExpiryHours, setCartExpiryHours] = useState(12);

  // Tier 3: Merchant Elite (Shopify / Shopify Plus level) state
  const [eliteEnabled, setEliteEnabled] = useState(true);
  const [elitePriceUgx, setElitePriceUgx] = useState(150000);
  const [eliteCommissionPercent, setEliteCommissionPercent] = useState(5);
  const [proMaxProducts, setProMaxProducts] = useState(50);
  const [eliteMaxProducts, setEliteMaxProducts] = useState(5000);
  const [proMaxCollections, setProMaxCollections] = useState(3);
  const [eliteMaxCollections, setEliteMaxCollections] = useState(100);
  const [proMaxDiscounts, setProMaxDiscounts] = useState(2);
  const [eliteMaxDiscounts, setEliteMaxDiscounts] = useState(200);
  const [eliteB2bEnabled, setEliteB2bEnabled] = useState(true);
  const [eliteMultiOutletInventoryEnabled, setEliteMultiOutletInventoryEnabled] = useState(true);
  const [eliteCustomDomainEnabled, setEliteCustomDomainEnabled] = useState(true);
  const [eliteLoyaltyEnabled, setEliteLoyaltyEnabled] = useState(true);
  const [eliteMaxLoyaltyCashbackPercent, setEliteMaxLoyaltyCashbackPercent] = useState(15);
  const [elitePosEnabled, setElitePosEnabled] = useState(true);
  const [eliteStockTransfersEnabled, setEliteStockTransfersEnabled] = useState(true);
  const [eliteCrmEnabled, setEliteCrmEnabled] = useState(true);
  const [elitePurchaseOrdersEnabled, setElitePurchaseOrdersEnabled] = useState(true);
  const [eliteBundlesEnabled, setEliteBundlesEnabled] = useState(true);
  const [eliteWinbackEnabled, setEliteWinbackEnabled] = useState(true);
  const [eliteStorefrontSectionsEnabled, setEliteStorefrontSectionsEnabled] = useState(true);
  const [eliteSmsAlertsEnabled, setEliteSmsAlertsEnabled] = useState(true);
  const [eliteSmsCostPerMessageUgx, setEliteSmsCostPerMessageUgx] = useState(35);
  const [smsProvider, setSmsProvider] = useState<"simulator" | "africas_talking" | "twilio">("simulator");
  const [eliteDigitalProductsEnabled, setEliteDigitalProductsEnabled] = useState(true);
  const [eliteLmsSyncEnabled, setEliteLmsSyncEnabled] = useState(true);
  const [eliteMaxCourses, setEliteMaxCourses] = useState(50);
  const [eliteMaxDigitalProducts, setEliteMaxDigitalProducts] = useState(200);

  const load = useCallback(async () => {
    const res = await api.adminGetMarketplaceSettings();
    const m = res.marketplace;
    setEnabled(m.enabled);
    setLiveEnabled(m.liveEnabled);
    setCommissionPercent(m.commissionPercent);
    setProPricingMode(m.proPricingMode);
    setProStorePriceUgx(m.proStorePriceUgx);
    setProLivePriceUgx(m.proLivePriceUgx);
    setProTrialDays(m.proTrialDays);
    setMinOrderAmountUgx(m.minOrderAmountUgx);
    setDeliveryBaseFeeUgx(m.deliveryBaseFeeUgx);
    setLiveMaxDurationMins(m.liveMaxDurationMins);
    setAdMinBudgetUgx(m.adMinBudgetUgx);
    setAdFeePercent(m.adFeePercent);
    setCartExpiryHours(m.cartExpiryHours ?? 12);
    setEliteEnabled(m.eliteEnabled ?? true);
    setElitePriceUgx(m.elitePriceUgx ?? 150000);
    setEliteCommissionPercent(m.eliteCommissionPercent ?? 5);
    setProMaxProducts(m.proMaxProducts ?? 50);
    setEliteMaxProducts(m.eliteMaxProducts ?? 5000);
    setProMaxCollections(m.proMaxCollections ?? 3);
    setEliteMaxCollections(m.eliteMaxCollections ?? 100);
    setProMaxDiscounts(m.proMaxDiscounts ?? 2);
    setEliteMaxDiscounts(m.eliteMaxDiscounts ?? 200);
    setEliteB2bEnabled(m.eliteB2bEnabled ?? true);
    setEliteMultiOutletInventoryEnabled(m.eliteMultiOutletInventoryEnabled ?? true);
    setEliteCustomDomainEnabled(m.eliteCustomDomainEnabled ?? true);
    setEliteLoyaltyEnabled(m.eliteLoyaltyEnabled ?? true);
    setEliteMaxLoyaltyCashbackPercent(m.eliteMaxLoyaltyCashbackPercent ?? 15);
    setElitePosEnabled(m.elitePosEnabled ?? true);
    setEliteStockTransfersEnabled(m.eliteStockTransfersEnabled ?? true);
    setEliteCrmEnabled(m.eliteCrmEnabled ?? true);
    setElitePurchaseOrdersEnabled(m.elitePurchaseOrdersEnabled ?? true);
    setEliteBundlesEnabled(m.eliteBundlesEnabled ?? true);
    setEliteWinbackEnabled(m.eliteWinbackEnabled ?? true);
    setEliteStorefrontSectionsEnabled(m.eliteStorefrontSectionsEnabled ?? true);
    setEliteSmsAlertsEnabled(m.eliteSmsAlertsEnabled ?? true);
    setEliteSmsCostPerMessageUgx(m.eliteSmsCostPerMessageUgx ?? 35);
    setSmsProvider(m.smsProvider ?? "simulator");
    setEliteDigitalProductsEnabled(m.eliteDigitalProductsEnabled ?? true);
    setEliteLmsSyncEnabled(m.eliteLmsSyncEnabled ?? true);
    setEliteMaxCourses(m.eliteMaxCourses ?? 50);
    setEliteMaxDigitalProducts(m.eliteMaxDigitalProducts ?? 200);
  }, []);

  useEffect(() => {
    load()
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setLoading(false));
  }, [load]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) return;
    if (!Number.isInteger(cartExpiryHours) || cartExpiryHours < 1 || cartExpiryHours > 720) {
      setError("Earlier carts after (hours) must be a whole number from 1 to 720.");
      return;
    }

    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const payload: Partial<MarketplaceSettings> = {
        enabled,
        liveEnabled,
        commissionPercent,
        proPricingMode,
        proStorePriceUgx,
        proLivePriceUgx,
        proTrialDays,
        minOrderAmountUgx,
        deliveryBaseFeeUgx,
        liveMaxDurationMins,
        adMinBudgetUgx,
        adFeePercent,
        cartExpiryHours,
        eliteEnabled,
        elitePriceUgx,
        eliteCommissionPercent,
        proMaxProducts,
        eliteMaxProducts,
        proMaxCollections,
        eliteMaxCollections,
        proMaxDiscounts,
        eliteMaxDiscounts,
        eliteB2bEnabled,
        eliteMultiOutletInventoryEnabled,
        eliteCustomDomainEnabled,
        eliteLoyaltyEnabled,
        eliteMaxLoyaltyCashbackPercent,
        elitePosEnabled,
        eliteStockTransfersEnabled,
        eliteCrmEnabled,
        elitePurchaseOrdersEnabled,
        eliteBundlesEnabled,
        eliteWinbackEnabled,
        eliteStorefrontSectionsEnabled,
        eliteSmsAlertsEnabled,
        eliteSmsCostPerMessageUgx,
        smsProvider,
        eliteDigitalProductsEnabled,
        eliteLmsSyncEnabled,
        eliteMaxCourses,
        eliteMaxDigitalProducts,
      };

      await api.adminUpdateMarketplaceSettings(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsPageShell title="Marketplace, Pro & Elite Stores" loading={loading}>
      <form onSubmit={handleSave} className="space-y-6 pb-12">
        {error && (
          <div className="flex items-center gap-3 rounded-2xl bg-red-50 p-4 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {saved && (
          <div className="flex items-center gap-3 rounded-2xl bg-green/10 p-4 text-sm font-semibold text-green">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            <p>Marketplace, Pro & Elite settings successfully saved.</p>
          </div>
        )}

        {/* Master Switches */}
        <Fold head={<div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold">
              <Store className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Marketplace Service</h2>
              <p className="text-xs text-ink-500">Groceries & Stores customer channels and merchant storefronts</p>
            </div>
          </div>}>

          <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-4">
            <div>
              <span className="block text-sm font-bold text-ink">Enable Marketplace</span>
              <span className="text-xs text-ink-500">Allow customers to browse stores and merchants to sell</span>
            </div>
            <ModuleState on={enabled} />
          </div>

          <div className="flex items-center justify-between border-t border-[var(--border-faint)] pt-4">
            <div>
              <span className="block text-sm font-bold text-ink">Enable TikTok Live Commerce</span>
              <span className="text-xs text-ink-500">In-stream video selling, pinned catalog items & real-time chat</span>
            </div>
            <ModuleState on={liveEnabled} />
          </div>
        </Fold>

        {/* Pro & Elite Monetization & Paywall Gate */}
        <section className="rounded-[24px] border border-gold/30 bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-ink">Merchant Tier Paywall (Free / Pro / Elite)</h2>
                <p className="text-xs text-ink-500">Control whether Pro & Elite features are free or require subscription</p>
              </div>
            </div>

            {/* Free vs Paid Toggle */}
            <div className="flex rounded-full bg-[rgb(var(--surface-muted))] p-1 border border-[var(--border-faint)]">
              <button
                type="button"
                onClick={() => setProPricingMode("free")}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  proPricingMode === "free"
                    ? "bg-gold text-ink-gold shadow-sm"
                    : "text-ink-500 hover:text-ink"
                }`}
              >
                Free Mode
              </button>
              <button
                type="button"
                onClick={() => setProPricingMode("paid")}
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  proPricingMode === "paid"
                    ? "bg-gold text-ink-gold shadow-sm"
                    : "text-ink-500 hover:text-ink"
                }`}
              >
                Paid Paywall
              </button>
            </div>
          </div>

          {proPricingMode === "free" ? (
            <div className="rounded-2xl bg-gold/10 p-4 text-xs text-ink space-y-1">
              <p className="font-bold text-gold">Promotional Launch Mode Active</p>
              <p className="text-ink-500">
                All merchants currently enjoy Pro Store, Live Selling, and Elite Shopify Plus features for free without paying a subscription.
              </p>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
                  <label className="text-xs font-bold text-ink-500 mb-1">Pro Store Monthly (UGX)</label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={proStorePriceUgx}
                    onChange={(e) => setProStorePriceUgx(Number(e.target.value))}
                    className="w-full bg-transparent font-bold text-ink outline-none text-base"
                  />
                  <span className="text-[10px] text-ink-500 mt-1">Marketplace catalog & variants</span>
                </div>

                <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
                  <label className="text-xs font-bold text-ink-500 mb-1">Pro Live Monthly (UGX)</label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={proLivePriceUgx}
                    onChange={(e) => setProLivePriceUgx(Number(e.target.value))}
                    className="w-full bg-transparent font-bold text-ink outline-none text-base"
                  />
                  <span className="text-[10px] text-ink-500 mt-1">TikTok Live & in-stream checkout</span>
                </div>

                <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
                  <label className="text-xs font-bold text-ink-500 mb-1">Elite Monthly (UGX)</label>
                  <input
                    type="number"
                    min={0}
                    step={5000}
                    value={elitePriceUgx}
                    onChange={(e) => setElitePriceUgx(Number(e.target.value))}
                    className="w-full bg-transparent font-bold text-ink outline-none text-base"
                  />
                  <span className="text-[10px] text-ink-500 mt-1">Shopify Plus OS, B2B & Multi-Outlet</span>
                </div>

                <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
                  <label className="text-xs font-bold text-ink-500 mb-1">Free Trial Length (Days)</label>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={proTrialDays}
                    onChange={(e) => setProTrialDays(Number(e.target.value))}
                    className="w-full bg-transparent font-bold text-ink outline-none text-base"
                  />
                  <span className="text-[10px] text-ink-500 mt-1">Automatic trial for new stores</span>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Tier 3: Merchant Advanced Marketplace (Elite — Shopify Plus level) */}
        <section className="rounded-[24px] border border-gold/40 bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold">
                <Crown className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-ink">Tier 3: Merchant Advanced Marketplace (Elite)</h2>
                <p className="text-xs text-ink-500">Shopify & Shopify Pro capabilities, quotas, and module switches</p>
              </div>
            </div>

            <button
              type="button"
              disabled={!canManage}
              onClick={() => setEliteEnabled(!eliteEnabled)}
              className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out ${
                eliteEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  eliteEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-[var(--border-faint)] pt-4">
            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Elite Commission Rate (%)</label>
              <input
                type="number"
                min={0}
                max={50}
                value={eliteCommissionPercent}
                onChange={(e) => setEliteCommissionPercent(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">Lower take-rate for Elite subscribers</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Pro vs Elite Max Products</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={proMaxProducts}
                  onChange={(e) => setProMaxProducts(Number(e.target.value))}
                  aria-label="Pro Max Products"
                  className="w-1/2 bg-transparent font-bold text-ink outline-none text-base"
                />
                <span className="text-xs text-ink-500">/</span>
                <input
                  type="number"
                  min={10}
                  value={eliteMaxProducts}
                  onChange={(e) => setEliteMaxProducts(Number(e.target.value))}
                  aria-label="Elite Max Products"
                  className="w-1/2 bg-transparent font-bold text-gold outline-none text-base"
                />
              </div>
              <span className="text-[10px] text-ink-500 mt-1">Pro limit / Elite limit</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Pro vs Elite Max Collections</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  value={proMaxCollections}
                  onChange={(e) => setProMaxCollections(Number(e.target.value))}
                  aria-label="Pro Max Collections"
                  className="w-1/2 bg-transparent font-bold text-ink outline-none text-base"
                />
                <span className="text-xs text-ink-500">/</span>
                <input
                  type="number"
                  min={1}
                  value={eliteMaxCollections}
                  onChange={(e) => setEliteMaxCollections(Number(e.target.value))}
                  aria-label="Elite Max Collections"
                  className="w-1/2 bg-transparent font-bold text-gold outline-none text-base"
                />
              </div>
              <span className="text-[10px] text-ink-500 mt-1">Smart & manual collections cap</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Pro vs Elite Max Discounts</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  value={proMaxDiscounts}
                  onChange={(e) => setProMaxDiscounts(Number(e.target.value))}
                  aria-label="Pro Max Discounts"
                  className="w-1/2 bg-transparent font-bold text-ink outline-none text-base"
                />
                <span className="text-xs text-ink-500">/</span>
                <input
                  type="number"
                  min={1}
                  value={eliteMaxDiscounts}
                  onChange={(e) => setEliteMaxDiscounts(Number(e.target.value))}
                  aria-label="Elite Max Discounts"
                  className="w-1/2 bg-transparent font-bold text-gold outline-none text-base"
                />
              </div>
              <span className="text-[10px] text-ink-500 mt-1">Active coupon & BOGO campaigns</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Max Loyalty Cashback (%)</label>
              <input
                type="number"
                min={0}
                max={50}
                value={eliteMaxLoyaltyCashbackPercent}
                onChange={(e) => setEliteMaxLoyaltyCashbackPercent(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">Ceiling on store VIP points reward</span>
            </div>
          </div>

          {/* Elite Module Switches */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-[var(--border-faint)] pt-4">
            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Custom Domains & Theme Builder</span>
                <span className="text-[10px] text-ink-500">Standalone storefront URLs & Online Store 2.0 layouts</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteCustomDomainEnabled(!eliteCustomDomainEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteCustomDomainEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteCustomDomainEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Multi-Outlet Inventory Matrix</span>
                <span className="text-[10px] text-ink-500">Per-branch stock tracking across merchant_outlets</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteMultiOutletInventoryEnabled(!eliteMultiOutletInventoryEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteMultiOutletInventoryEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteMultiOutletInventoryEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">B2B Wholesale & Draft Orders</span>
                <span className="text-[10px] text-ink-500">Custom quotes, Net-7/14/30 terms & 1-tap WhatsApp invoices</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteB2bEnabled(!eliteB2bEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteB2bEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteB2bEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">VIP Customer Loyalty Cashback</span>
                <span className="text-[10px] text-ink-500">Allow Elite stores to reward repeat buyers with store points</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteLoyaltyEnabled(!eliteLoyaltyEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteLoyaltyEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteLoyaltyEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Omnichannel POS Register</span>
                <span className="text-[10px] text-ink-500">Walk-in cashier checkout synced with outlet inventory</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setElitePosEnabled(!elitePosEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  elitePosEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    elitePosEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Branch-to-Branch Stock Transfers</span>
                <span className="text-[10px] text-ink-500">Move inventory between merchant_outlets with audit trail</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteStockTransfersEnabled(!eliteStockTransfersEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteStockTransfersEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteStockTransfersEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">VIP Customer CRM & Segments</span>
                <span className="text-[10px] text-ink-500">Customer directory, VIP/Repeat segments & loyalty ledger</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteCrmEnabled(!eliteCrmEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteCrmEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteCrmEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Supplier Purchase Orders & Receiving</span>
                <span className="text-[10px] text-ink-500">Supplier POs, 1-tap stock receiving into branch inventory</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setElitePurchaseOrdersEnabled(!elitePurchaseOrdersEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  elitePurchaseOrdersEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    elitePurchaseOrdersEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Product Bundles & Hampers</span>
                <span className="text-[10px] text-ink-500">Bundled gift hampers & kits with automatic component stock deduction</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteBundlesEnabled(!eliteBundlesEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteBundlesEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteBundlesEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Abandoned Cart & Win-Back Automation</span>
                <span className="text-[10px] text-ink-500">1-click WhatsApp win-back campaigns with attached promo codes</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteWinbackEnabled(!eliteWinbackEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteWinbackEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteWinbackEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Store 2.0 Visual Section Page Builder</span>
                <span className="text-[10px] text-ink-500">Allow merchants to toggle, reorder, and customize storefront sections</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteStorefrontSectionsEnabled(!eliteStorefrontSectionsEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteStorefrontSectionsEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteStorefrontSectionsEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
              <div>
                <span className="block text-xs font-bold text-ink">Automated SMS Receipts & Order Alerts</span>
                <span className="text-[10px] text-ink-500">Digital POS receipt SMS, order notifications, and delivery SMS alerts</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteSmsAlertsEnabled(!eliteSmsAlertsEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteSmsAlertsEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteSmsAlertsEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between py-2 border-t border-[var(--border-faint)]">
              <div>
                <span className="block text-xs font-bold text-ink">Dynamic Digital Products Management</span>
                <span className="text-[10px] text-ink-500">Allow Tier 3 merchants to sell downloadable files, templates, guides, and software license keys</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteDigitalProductsEnabled(!eliteDigitalProductsEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteDigitalProductsEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteDigitalProductsEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="flex items-center justify-between py-2 border-t border-[var(--border-faint)]">
              <div>
                <span className="block text-xs font-bold text-ink">Robust LMS & Peebee Learn Direct Sync</span>
                <span className="text-[10px] text-ink-500">Enable in-store courses, masterclasses, and auto-enrollment into Peebee Learn classroom</span>
              </div>
              <button
                type="button"
                disabled={!canManage}
                onClick={() => setEliteLmsSyncEnabled(!eliteLmsSyncEnabled)}
                className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  eliteLmsSyncEnabled ? "bg-gold" : "bg-neutral-300 dark:bg-neutral-700"
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
                    eliteLmsSyncEnabled ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <label className="block text-xs font-semibold text-ink">
                Max LMS Courses per Tier 3 Merchant
                <input
                  type="number"
                  min="1"
                  max="500"
                  disabled={!canManage}
                  value={eliteMaxCourses}
                  onChange={(e) => setEliteMaxCourses(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs font-mono font-bold text-ink"
                />
              </label>

              <label className="block text-xs font-semibold text-ink">
                Max Digital Products per Tier 3 Merchant
                <input
                  type="number"
                  min="1"
                  max="1000"
                  disabled={!canManage}
                  value={eliteMaxDigitalProducts}
                  onChange={(e) => setEliteMaxDigitalProducts(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs font-mono font-bold text-ink"
                />
              </label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
              <label className="block text-xs font-semibold text-ink">
                SMS Provider Gateway
                <select
                  disabled={!canManage}
                  value={smsProvider}
                  onChange={(e) => setSmsProvider(e.target.value as any)}
                  className="mt-1 w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs font-bold text-ink"
                >
                  <option value="simulator">SMS Simulator + WhatsApp Web (Zero Carrier Cost)</option>
                  <option value="africas_talking">Africa's Talking Uganda Gateway</option>
                  <option value="twilio">Twilio Global SMS</option>
                </select>
              </label>

              <label className="block text-xs font-semibold text-ink">
                Cost Per SMS Message (UGX)
                <input
                  type="number"
                  min="0"
                  max="500"
                  disabled={!canManage}
                  value={eliteSmsCostPerMessageUgx}
                  onChange={(e) => setEliteSmsCostPerMessageUgx(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs font-mono font-bold text-ink"
                />
              </label>
            </div>
          </div>
        </section>

        {/* Commissions & Delivery Rules */}
        <Fold head={<div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold">
              <ShoppingBag className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Commissions & Order Rules</h2>
              <p className="text-xs text-ink-500">Platform take rates and checkout minimums</p>
            </div>
          </div>}>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Standard Pro Commission (%)</label>
              <input
                type="number"
                min={0}
                max={50}
                value={commissionPercent}
                onChange={(e) => setCommissionPercent(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">Share deducted from Pro orders</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Minimum Order Value (UGX)</label>
              <input
                type="number"
                min={0}
                step={1000}
                value={minOrderAmountUgx}
                onChange={(e) => setMinOrderAmountUgx(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">Default store checkout floor</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Base Delivery Fee (UGX)</label>
              <input
                type="number"
                min={0}
                step={500}
                value={deliveryBaseFeeUgx}
                onChange={(e) => setDeliveryBaseFeeUgx(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">Rider collection & dispatch floor</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Earlier carts after (hours)</label>
              <input
                type="number"
                min={1}
                max={720}
                step={1}
                value={cartExpiryHours}
                onChange={(e) => setCartExpiryHours(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">
                A cart left this long is set aside as an earlier cart when the customer starts a new one. It stays retrievable.
              </span>
            </div>
          </div>
        </Fold>

        {/* Live Selling & Social Ads Engine Limits */}
        <Fold head={<div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold/15 text-gold">
              <Tv className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-ink">Live Broadcasts & Social Ads</h2>
              <p className="text-xs text-ink-500">Stream session windows and 1-click social ads budgets</p>
            </div>
          </div>}>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Max Stream Duration (Mins)</label>
              <input
                type="number"
                min={15}
                max={720}
                value={liveMaxDurationMins}
                onChange={(e) => setLiveMaxDurationMins(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">Continuous live broadcast limit</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Min Ad Campaign Budget (UGX)</label>
              <input
                type="number"
                min={1000}
                step={5000}
                value={adMinBudgetUgx}
                onChange={(e) => setAdMinBudgetUgx(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">WhatsApp/Meta 1-click ads floor</span>
            </div>

            <div className="field-box flex flex-col p-3 rounded-2xl bg-[rgb(var(--surface-muted))]">
              <label className="text-xs font-bold text-ink-500 mb-1">Social Ads Platform Fee (%)</label>
              <input
                type="number"
                min={0}
                max={25}
                value={adFeePercent}
                onChange={(e) => setAdFeePercent(Number(e.target.value))}
                className="w-full bg-transparent font-bold text-ink outline-none text-base"
              />
              <span className="text-[10px] text-ink-500 mt-1">Ad management markup</span>
            </div>
          </div>
        </Fold>

        {/* Submit Actions */}
        <div className="sticky bottom-4 z-20 flex gap-3">
          <button
            type="submit"
            disabled={!canManage || saving}
            className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-full bg-gold px-6 text-sm font-bold text-ink-gold shadow-[var(--shadow-glow-gold)] transition active:scale-95 disabled:opacity-50"
          >
            {saving ? "Saving Changes..." : "Save Marketplace Settings"}
          </button>
        </div>
      </form>
    </SettingsPageShell>
  );
}
