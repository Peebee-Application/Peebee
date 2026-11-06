"use client";

import type { FuelCode, FuelProduct, FuelReceipt, FuelStationOutlet } from "@peebee/shared";
import {
  ArrowLeft,
  Building2,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Fuel,
  Info,
  MapPin,
  QrCode,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Accordion } from "../../components/Accordion";
import { FuelQrCode } from "../../components/FuelQrCode";
import { TabBar } from "../../components/TabBar";
import { api, errorMessage } from "../../lib/api";

export default function RiderFuelPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<FuelCode | null>(null);
  const [stations, setStations] = useState<FuelStationOutlet[]>([]);
  const [products, setProducts] = useState<FuelProduct[]>([]);
  const [dispenses, setDispenses] = useState<FuelReceipt[]>([]);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"voucher" | "stations" | "receipts">("voucher");

  // New Voucher Generation Form State
  const [amountUgx, setAmountUgx] = useState<number>(20_000);
  const [selectedProductId, setSelectedProductId] = useState<string>("prod_petrol");
  const [generating, setGenerating] = useState<boolean>(false);
  const [plate, setPlate] = useState<string>("");
  useEffect(() => {
    try { setPlate(window.localStorage.getItem("peebee_fuel_plate") ?? ""); } catch { /* private mode */ }
  }, []);
  const [remainingTime, setRemainingTime] = useState<string>("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [codeRes, stationsRes, productsRes, dispensesRes] = await Promise.all([
        api.getActiveRiderFuelCode().catch(() => ({ code: null })),
        api.gasStations().catch(() => ({ outlets: [] })),
        api.gasProducts().catch(() => ({ products: [] })),
        api.gasRiderDispenses().catch(() => ({ dispenses: [] })),
      ]);

      setActiveCode(codeRes.code);
      setStations(stationsRes.outlets);
      setProducts(productsRes.products);
      setDispenses(dispensesRes.dispenses);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Expiry countdown timer
  useEffect(() => {
    if (!activeCode?.expires_at) {
      setRemainingTime("");
      return;
    }

    function updateCountdown() {
      const diff = new Date(activeCode!.expires_at).getTime() - Date.now();
      if (diff <= 0) {
        setRemainingTime("Expired");
        return;
      }
      const mins = Math.floor(diff / 60_000);
      const secs = Math.floor((diff % 60_000) / 1000);
      setRemainingTime(`${mins}m ${secs.toString().padStart(2, "0")}s`);
    }

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [activeCode]);

  async function handleGenerateCode() {
    setGenerating(true);
    setError(null);
    try {
      try { window.localStorage.setItem("peebee_fuel_plate", plate.trim()); } catch { /* private mode */ }
      const res = await api.generateRiderFuelCode({
        vehiclePlate: plate.trim() || undefined,
        amountUgx,
        productId: selectedProductId,
      });
      if (res.ok && res.code) {
        setActiveCode(res.code);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setGenerating(false);
    }
  }

  function handleCopyCode() {
    if (!activeCode) return;
    const cleanPin = activeCode.code.replace(/^PBGAS-/, "");
    void navigator.clipboard.writeText(cleanPin);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const cleanDisplayPin = activeCode?.code
    ? activeCode.code.replace(/^PBGAS-/, "").replace(/(\d{3})(\d{3})/, "$1 $2")
    : "";

  return (
    <div className="space-y-4 px-4 pb-6 pt-4">
      <header className="flex items-center gap-3">
        <Link
          href="/"
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"
          aria-label="Back to Jobs"
        >
          <ArrowLeft className="h-6 w-6" aria-hidden />
        </Link>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-2xl font-extrabold tracking-tight text-ink">
          <Fuel className="h-7 w-7 shrink-0 text-gold" aria-hidden /> <span className="truncate">Peebee Gas</span>
        </h1>
        <button
          type="button"
          onClick={loadData}
          disabled={loading}
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink"
          aria-label="Refresh"
        >
          <RotateCcw className={`h-6 w-6 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </header>

      {error && (
        <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-base text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      <TabBar
        label="Peebee Gas"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: "voucher", label: "Voucher", icon: QrCode },
          { id: "stations", label: "Stations", icon: Building2 },
          { id: "receipts", label: "Receipts", icon: Receipt },
        ]}
      />

      {tab === "voucher" && (
        <div className="space-y-4" role="tabpanel" aria-label="Voucher">
      {/* ACTIVE VOUCHER SECTION */}
      {activeCode && remainingTime !== "Expired" ? (
        <section className="home-card space-y-4 border-2 border-gold/40 bg-[rgb(var(--surface-card))] text-center">
          <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3 text-xs">
            <span className="flex items-center gap-1.5 font-bold text-green">
              <ShieldCheck className="h-4 w-4" />
              Active Fuel Voucher
            </span>
            <span className="flex items-center gap-1 font-mono font-bold text-ink-500">
              <Clock className="h-3.5 w-3.5 text-gold" />
              {remainingTime}
            </span>
          </div>

          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-ink-500">
              Verbal 6-Digit Pump PIN
            </span>
            <div className="mt-1 flex items-center justify-center gap-3">
              <span className="font-mono text-3xl font-black tracking-widest text-ink">
                {cleanDisplayPin}
              </span>
              <button
                type="button"
                onClick={handleCopyCode}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink hover:bg-gold/15 hover:text-gold"
                title="Copy PIN"
              >
                {copied ? <Check className="h-4 w-4 text-green" /> : <Copy className="h-4 w-4" />}
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-500">
              Read this PIN aloud to the petrol station attendant
            </p>
          </div>

          {/* QR Code Presentation */}
          <div className="flex flex-col items-center justify-center pt-2">
            <FuelQrCode value={activeCode.code} size={180} />
            <span className="mt-2 text-[11px] font-bold text-ink-500">
              or let the attendant scan this QR code
            </span>
          </div>

          {/* Authorized Details Box */}
          <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-3 text-left text-xs space-y-1.5">
            <div className="flex justify-between">
              <span className="text-ink-500">Plate Number:</span>
              <strong className="font-mono text-ink">{activeCode.vehicle_plate}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">Authorized Fuel:</span>
              <strong className="text-ink">
                {activeCode.fuel_product_id === "prod_diesel"
                  ? "Automotive Diesel"
                  : "Unleaded Petrol"}
              </strong>
            </div>
            <div className="flex justify-between border-t border-[var(--border-faint)] pt-1.5 font-bold">
              <span className="text-ink-500">Amount Limit:</span>
              <span className="text-gold">
                UGX {activeCode.authorized_amount_ugx.toLocaleString()}
              </span>
            </div>
          </div>
        </section>
      ) : (
        /* GENERATE VOUCHER CARD */
        <section className="home-card space-y-4">
          <div className="flex items-start gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gold/15 text-gold">
              <QrCode className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-sm font-black text-ink">Get Pump Fuel Voucher</h2>
              <p className="text-xs text-ink-500">
                Instant 6-digit PIN and QR code accepted at partner pump stations
              </p>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-bold text-ink-500">Motorcycle number plate</label>
            <input
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="e.g. UFE 123A"
              maxLength={14}
              autoCapitalize="characters"
              className="w-full text-sm font-bold text-ink outline-none"
            />
          </div>

          {/* Amount selector chips */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-ink-500">
              Select Fuel Allowance (UGX)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[10_000, 20_000, 30_000, 50_000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAmountUgx(amt)}
                  className={`rounded-xl border py-2 text-xs font-bold transition ${
                    amountUgx === amt
                      ? "border-gold bg-gold text-ink-gold font-black"
                      : "border-[var(--border-faint)] bg-[rgb(var(--surface-input))] text-ink"
                  }`}
                >
                  {amt / 1000}k
                </button>
              ))}
            </div>
          </div>

          {/* Fuel Product Selector */}
          <div>
            <label className="mb-1.5 block text-xs font-bold text-ink-500">
              Fuel Type
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedProductId("prod_petrol")}
                aria-pressed={selectedProductId === "prod_petrol"}
                className="select-card !flex-row items-center justify-center gap-2"
              >
                <Fuel className="h-4 w-4 text-gold" />
                <span className="select-card__title text-sm text-ink">Petrol</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedProductId("prod_diesel")}
                aria-pressed={selectedProductId === "prod_diesel"}
                className="select-card !flex-row items-center justify-center gap-2"
              >
                <Fuel className="h-4 w-4 text-navy" />
                <span className="select-card__title text-sm text-ink">Diesel</span>
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGenerateCode}
            disabled={generating}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gold font-bold text-ink-gold shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            <span>{generating ? "Generating..." : "Generate Fuel Code"}</span>
          </button>
        </section>
      )}

      <Accordion title="How it works" icon={Info}>
        <ol className="list-decimal space-y-2 pl-5 text-base leading-relaxed text-ink-500">
          <li>Drive into any partner petrol station lane.</li>
          <li>Show your 6-digit PIN or let the attendant scan your QR code.</li>
          <li>The attendant checks your plate and pumps the fuel.</li>
          <li>Your receipt is saved. No cash needed.</li>
        </ol>
      </Accordion>
        </div>
      )}

      {tab === "stations" && (
        <div className="space-y-4" role="tabpanel" aria-label="Stations">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gold" />
            <h2 className="text-sm font-black text-ink">Partner Petrol Stations</h2>
          </div>
          <span className="text-xs font-bold text-ink-500">{stations.length} locations</span>
        </div>

        <div className="space-y-2.5">
          {stations.map((st) => (
            <article
              key={st.id}
              className="home-card flex items-start justify-between p-3.5 transition hover:border-gold/50"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-gold/15 px-2 py-0.5 text-[10px] font-black uppercase text-gold">
                    {st.station_name}
                  </span>
                  <h3 className="text-xs font-black text-ink">{st.name}</h3>
                </div>
                <p className="flex items-center gap-1 text-[11px] text-ink-500">
                  <MapPin className="h-3 w-3 shrink-0 text-ink-500" />
                  <span>{st.address}</span>
                </p>
                <div className="flex items-center gap-3 pt-1 text-[11px]">
                  <span className="font-bold text-ink">
                    Petrol: <strong className="text-gold">UGX 5,450/L</strong>
                  </span>
                  <span className="font-bold text-ink">
                    Diesel: <strong className="text-navy">UGX 5,200/L</strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end justify-between">
                <span className="rounded-full bg-green/15 px-2 py-0.5 text-[10px] font-bold text-green">
                  Open 24/7
                </span>
                <span className="mt-4 font-mono text-[11px] text-ink-500">
                  {st.code}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>
        </div>
      )}

      {tab === "receipts" && (
        <div className="space-y-4" role="tabpanel" aria-label="Receipts">
          {dispenses.length === 0 ? (
            <div className="home-card flex flex-col items-center gap-2 py-10 text-center">
              <Receipt className="h-12 w-12 text-ink-500" aria-hidden />
              <p className="text-lg font-bold text-ink-500">No receipts yet</p>
            </div>
          ) : (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-gold" />
            <h2 className="text-sm font-black text-ink">Recent Fuel Receipts</h2>
          </div>

          <div className="space-y-2">
            {dispenses.slice(0, 5).map((d) => (
              <div
                key={d.id}
                className="home-card flex items-center justify-between p-3 text-xs"
              >
                <div className="space-y-0.5">
                  <span className="font-mono text-[11px] font-bold text-gold">
                    {d.receipt_ref}
                  </span>
                  <div className="font-bold text-ink">
                    {d.litres_dispensed}L {d.product_name}
                  </div>
                  <p className="text-[10px] text-ink-500">
                    {new Date(d.created_at).toLocaleDateString()} · {d.outlet_name}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-black text-green">
                    UGX {d.total_ugx.toLocaleString()}
                  </div>
                  <span className="text-[10px] text-ink-500 font-mono">
                    Pump #{d.pump_number}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
          )}
        </div>
      )}
    </div>
  );
}
