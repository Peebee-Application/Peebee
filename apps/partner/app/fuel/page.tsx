"use client";

import type { FuelCode, FuelProduct, FuelReceipt, FuelStationOutlet } from "@peebee/shared";
import {
  ArrowLeft,
  Building2,
  CarFront,
  Check,
  Clock,
  Copy,
  Fuel,
  MapPin,
  QrCode,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Ticket,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Accordion } from "../../components/Accordion";
import { TabBar } from "../../components/TabBar";
import { FuelQrCode } from "../../components/FuelQrCode";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function PartnerFuelPage() {
  const { me } = useAuth();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState<FuelCode | null>(null);
  const [stations, setStations] = useState<FuelStationOutlet[]>([]);
  const [products, setProducts] = useState<FuelProduct[]>([]);
  const [dispenses, setDispenses] = useState<FuelReceipt[]>([]);
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<"voucher" | "stations" | "receipts">("voucher");

  // Available vehicles for this driver / partner
  const allVehicles = [
    ...(me?.vehicles ?? []),
    ...(me?.assignedVehicles ?? []),
  ].filter((v, i, all) => all.findIndex((x) => x.id === v.id) === i);
  const [selectedVehiclePlate, setSelectedVehiclePlate] = useState<string>(
    allVehicles[0]?.plate ?? "UBK 902F"
  );

  // Generation form
  const [amountUgx, setAmountUgx] = useState<number>(50_000);
  const [selectedProductId, setSelectedProductId] = useState<string>("prod_petrol");
  const [generating, setGenerating] = useState<boolean>(false);
  const [remainingTime, setRemainingTime] = useState<string>("");

  useEffect(() => {
    if (allVehicles.length > 0 && !allVehicles.some((v) => v.plate === selectedVehiclePlate)) {
      setSelectedVehiclePlate(allVehicles[0].plate);
    }
  }, [allVehicles, selectedVehiclePlate]);

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
      const res = await api.generateRiderFuelCode({
        vehiclePlate: selectedVehiclePlate,
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
    <div className="mx-auto max-w-xl space-y-4 px-4 py-4 pb-20">
      <header className="flex items-center gap-3">
        <Link href="/" className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface))] text-ink" aria-label="Back to Home">
          <ArrowLeft className="h-6 w-6" aria-hidden />
        </Link>
        <h1 className="flex min-w-0 flex-1 items-center gap-2 text-2xl font-black text-ink"><Fuel className="h-7 w-7 text-gold" aria-hidden /> Fuel</h1>
        <button type="button" onClick={loadData} disabled={loading} className="flex h-14 w-14 items-center justify-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface))] text-ink" aria-label="Refresh">
          <RotateCcw className={`h-6 w-6 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </header>

      <TabBar label="Fuel" active={tab} onChange={setTab} tabs={[{ id: "voucher", label: "Voucher", icon: Ticket }, { id: "stations", label: "Stations", icon: Building2, count: stations.length }, { id: "receipts", label: "Receipts", icon: Receipt, count: dispenses.length }]} />

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3.5 text-base text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      )}

      {/* ACTIVE FUEL VOUCHER SECTION */}
      {tab === "voucher" && (activeCode && remainingTime !== "Expired" ? (
        <section className="home-card space-y-4 border-2 border-gold/40 bg-[rgb(var(--surface))] text-center">
          <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3 text-base">
            <span className="flex items-center gap-1.5 font-bold text-green">
              <ShieldCheck className="h-4 w-4" />
              Active voucher
            </span>
            <span className="flex items-center gap-1 font-mono font-bold text-ink-500">
              <Clock className="h-3.5 w-3.5 text-gold" />
              {remainingTime}
            </span>
          </div>

          <div>
            <span className="text-sm font-bold uppercase tracking-wider text-ink-500">
              Pump PIN
            </span>
            <div className="mt-1 flex items-center justify-center gap-3">
              <span className="font-mono text-5xl font-black tracking-widest text-ink">
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
            <p className="mt-1 text-base text-ink-500">
              Show this to the attendant
            </p>
          </div>

          {/* QR Code Presentation */}
          <div className="flex flex-col items-center justify-center pt-2">
            <FuelQrCode value={activeCode.code} size={220} />
            <span className="mt-2 text-sm font-bold text-ink-500">
              or let them scan this
            </span>
          </div>

          {/* Authorized Details Box */}
          <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-3 text-left text-base space-y-1.5">
            <div className="flex justify-between">
              <span className="text-ink-500">Vehicle Plate:</span>
              <strong className="font-mono text-ink">{activeCode.vehicle_plate}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">Fuel Grade:</span>
              <strong className="text-ink">
                {activeCode.fuel_product_id === "prod_diesel"
                  ? "Automotive Diesel"
                  : "Unleaded Petrol"}
              </strong>
            </div>
            <div className="flex justify-between border-t border-[var(--border-faint)] pt-1.5 font-bold">
              <span className="text-ink-500">Allowance Limit:</span>
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
              <CarFront className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-ink">Fuel voucher</h2>
              <p className="text-base text-ink-500">
                Pump without cash
              </p>
            </div>
          </div>

          {/* Vehicle Selector */}
          <div>
            <label className="mb-1.5 block text-base font-bold text-ink-500">
              Car
            </label>
            {allVehicles.length > 0 ? (
              <select
                value={selectedVehiclePlate}
                onChange={(e) => setSelectedVehiclePlate(e.target.value)}
                className="min-h-14 w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 text-lg font-bold text-ink outline-none"
              >
                {allVehicles.map((v) => (
                  <option key={v.id} value={v.plate}>
                    {v.plate} — {v.make ?? "Car"} {v.model ?? ""} ({v.category_name})
                  </option>
                ))}
              </select>
            ) : (
              <div className="field-box flex items-center gap-2 p-3">
                <CarFront className="h-4 w-4 text-gold" />
                <input
                  type="text"
                  value={selectedVehiclePlate}
                  onChange={(e) => setSelectedVehiclePlate(e.target.value.toUpperCase())}
                  placeholder="e.g. UBK 902F"
                  className="w-full font-mono text-base font-bold text-ink"
                />
              </div>
            )}
          </div>

          {/* Amount selector chips (tuned for cars) */}
          <div>
            <label className="mb-1.5 block text-base font-bold text-ink-500">
              Amount (UGX)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[30_000, 50_000, 100_000, 150_000].map((amt) => (
                <button
                  key={amt}
                  type="button"
                  onClick={() => setAmountUgx(amt)}
                  className={`min-h-14 rounded-xl border py-2 text-lg font-bold transition ${
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
            <label className="mb-1.5 block text-base font-bold text-ink-500">
              Fuel
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setSelectedProductId("prod_petrol")}
                className={`flex items-center justify-center min-h-14 gap-2 rounded-xl border p-2.5 text-lg transition ${
                  selectedProductId === "prod_petrol"
                    ? "border-gold bg-gold/10 font-black text-ink"
                    : "border-[var(--border-faint)] bg-[rgb(var(--surface-input))] font-bold text-ink-500"
                }`}
              >
                <Fuel className="h-4 w-4 text-gold" />
                <span className="select-card__title text-sm text-ink">Petrol</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedProductId("prod_diesel")}
                className={`flex items-center justify-center min-h-14 gap-2 rounded-xl border p-2.5 text-lg transition ${
                  selectedProductId === "prod_diesel"
                    ? "border-navy bg-navy/10 font-black text-ink"
                    : "border-[var(--border-faint)] bg-[rgb(var(--surface-input))] font-bold text-ink-500"
                }`}
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
            className="flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl bg-gold text-xl font-extrabold text-ink-gold shadow-sm hover:opacity-95 disabled:opacity-50"
          >
            <Sparkles className="h-4 w-4" />
            <span>{generating ? "Please wait…" : "Get voucher"}</span>
          </button>
        </section>
      ))}

      {/* HOW IT WORKS / GUIDE */}
      {tab === "voucher" && (
        <Accordion title="How it works" icon={ShieldCheck}>
          <ol className="list-decimal space-y-2 pl-5 text-lg text-ink-500">
            <li>Drive into a partner station.</li>
            <li>Say you pay with Peebee Gas.</li>
            <li>Give the PIN or show the QR.</li>
          </ol>
        </Accordion>
      )}

      {/* NEARBY PARTNER PETROL STATIONS */}
      {tab === "stations" && <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gold" />
            <h2 className="text-xl font-black text-ink">Stations</h2>
          </div>
          <span className="text-base font-bold text-ink-500">{stations.length} stations</span>
        </div>

        <div className="space-y-2.5">
          {stations.map((st) => (
            <article
              key={st.id}
              className="home-card flex items-start justify-between p-3.5 transition hover:border-gold/50"
            >
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-gold/15 px-2 py-0.5 text-sm font-black uppercase text-gold">
                    {st.station_name}
                  </span>
                  <h3 className="text-base font-black text-ink">{st.name}</h3>
                </div>
                <p className="flex items-center gap-1 text-sm text-ink-500">
                  <MapPin className="h-3 w-3 shrink-0 text-ink-500" />
                  <span>{st.address}</span>
                </p>
                <div className="flex items-center gap-3 pt-1 text-sm">
                  <span className="font-bold text-ink">
                    Petrol: <strong className="text-gold">UGX 5,450/L</strong>
                  </span>
                  <span className="font-bold text-ink">
                    Diesel: <strong className="text-navy">UGX 5,200/L</strong>
                  </span>
                </div>
              </div>

              <div className="flex flex-col items-end justify-between">
                <span className="rounded-full bg-green/15 px-2 py-0.5 text-sm font-bold text-green">
                  Open 24/7
                </span>
                <span className="mt-4 font-mono text-sm text-ink-500">
                  {st.code}
                </span>
              </div>
            </article>
          ))}
        </div>
      </section>}

      {/* RECENT FUEL DISPENSES */}
      {tab === "receipts" && dispenses.length === 0 && <p className="home-card py-8 text-center text-lg text-ink-500">None yet</p>}
      {tab === "receipts" && dispenses.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-gold" />
            <h2 className="text-xl font-black text-ink">Receipts</h2>
          </div>

          <div className="space-y-2">
            {dispenses.slice(0, 5).map((d) => (
              <div
                key={d.id}
                className="home-card flex items-center justify-between p-3 text-base"
              >
                <div className="space-y-0.5">
                  <span className="font-mono text-sm font-bold text-gold">
                    {d.receipt_ref}
                  </span>
                  <div className="font-bold text-ink">
                    {d.litres_dispensed}L {d.product_name}
                  </div>
                  <p className="text-sm text-ink-500">
                    {new Date(d.created_at).toLocaleDateString()} · {d.outlet_name}
                  </p>
                </div>
                <div className="text-right">
                  <div className="font-black text-green">
                    UGX {d.total_ugx.toLocaleString()}
                  </div>
                  <span className="text-sm text-ink-500 font-mono">
                    Pump #{d.pump_number}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
