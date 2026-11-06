"use client";

import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock,
  ExternalLink,
  Eye,
  FileCheck,
  FileText,
  HeartPulse,
  PackageCheck,
  Pill,
  Plus,
  ShieldCheck,
  Thermometer,
  TrendingUp,
  Truck,
  UserCheck,
  LifeBuoy,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import type { PharmacyPrescription } from "@peebee/shared";
import { useEffect, useState } from "react";
import { Accordion } from "../components/Accordion";
import { useAuth } from "../lib/auth-context";
import { api } from "../lib/api";

const ugx = (val: number) => `UGX ${val.toLocaleString()}`;

const timeAgo = (iso: string) => {
  const then = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 1440) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} d ago`;
};

const RECENT_DISPENSED_ORDERS = [
  {
    id: "ord_pharma_881",
    customer: "David Otim",
    items: "Panadol Extra (24s), Redoxon Vit C 1000mg",
    amount: 34500,
    status: "Ready for Pickup",
    time: "10 mins ago",
  },
  {
    id: "ord_pharma_880",
    customer: "Grace Nakato",
    items: "Piriton 4mg, Strepsils Honey & Lemon",
    amount: 17500,
    status: "Rider En Route",
    time: "25 mins ago",
  },
  {
    id: "ord_pharma_879",
    customer: "Arthur Ssemwanga",
    items: "Savlon Antiseptic 250ml, Bandages",
    amount: 21500,
    status: "Delivered",
    time: "48 mins ago",
  },
];

export default function PharmacyDashboardPage() {
  const { pharmacy, pharmacist } = useAuth();
  const [prescriptions, setPrescriptions] = useState<PharmacyPrescription[]>([]);
  const [rxLoaded, setRxLoaded] = useState(false);

  useEffect(() => {
    api
      .getPharmacistPrescriptions("pending_review")
      .then((res) => setPrescriptions(res.prescriptions))
      .catch(() => setPrescriptions([]))
      .finally(() => setRxLoaded(true));
  }, []);

  const [showAllRx, setShowAllRx] = useState(false);
  const shownRx = showAllRx ? prescriptions : prescriptions.slice(0, 3);

  return (
    <div className="space-y-4">
      <section className="home-card !p-4 flex items-center gap-3 !bg-black-700 text-white dark:!bg-black">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gold text-ink-gold">
          <UserCheck className="h-7 w-7" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-black text-white">{pharmacist?.name}</h1>
          <p className="truncate text-base text-white/70">{pharmacy?.name}</p>
          <p className="truncate text-sm text-white/60">{pharmacist?.role === "owner" ? "Owner" : "Manager"} · {pharmacy?.ndaLicenseNumber}</p>
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <Link href="/prescriptions" className="home-card !p-4 active:scale-[0.98]">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold"><FileText className="h-6 w-6" aria-hidden /></span>
          <p className="mt-3 text-3xl font-black text-ink">{prescriptions.length}</p>
          <p className="text-lg font-bold text-ink-500">To review</p>
        </Link>
        <Link href="/inventory" className="home-card !p-4 active:scale-[0.98]">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold"><Pill className="h-6 w-6" aria-hidden /></span>
          <p className="mt-3 text-3xl font-black text-ink">45</p>
          <p className="text-lg font-bold text-ink-500">Medicines</p>
        </Link>
        <Link href="/wallet" className="home-card !p-4 active:scale-[0.98]">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-green-600/15 text-green-600"><TrendingUp className="h-6 w-6" aria-hidden /></span>
          <p className="mt-3 text-xl font-black text-ink">{ugx(485000)}</p>
          <p className="text-lg font-bold text-ink-500">Today (sample)</p>
        </Link>
        <Link href="/license" className="home-card !p-4 active:scale-[0.98]">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-500/15 text-blue-500"><Thermometer className="h-6 w-6" aria-hidden /></span>
          <p className="mt-3 text-3xl font-black text-ink">4.2°C</p>
          <p className="text-lg font-bold text-ink-500">Fridge · normal</p>
        </Link>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-ink">Prescriptions</h2>
          <Link href="/prescriptions" className="flex min-h-12 items-center text-lg font-black text-gold">See all</Link>
        </div>
        {rxLoaded && prescriptions.length === 0 && (
          <p className="home-card !p-5 text-center text-lg text-ink-500">None waiting</p>
        )}
        {shownRx.map((rx) => (
          <article key={rx.id} className="space-y-3 home-card !p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-black/5 text-gold"><FileText className="h-6 w-6" aria-hidden /></div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-xl font-black text-ink">{rx.customerName}</h3>
                <p className="truncate text-base text-ink-500">{[rx.patientAge != null ? `${rx.patientAge} yrs` : null, rx.patientGender, timeAgo(rx.createdAt)].filter(Boolean).join(" · ")}</p>
              </div>
            </div>
            <Link href={`/prescriptions?id=${rx.id}`} className="flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gold text-lg font-black text-ink-gold active:scale-95">
              Review <ArrowRight className="h-5 w-5" aria-hidden />
            </Link>
          </article>
        ))}
        {prescriptions.length > 3 && !showAllRx && (
          <button type="button" onClick={() => setShowAllRx(true)} className="flex min-h-14 w-full items-center justify-center text-lg font-bold text-gold">Show all {prescriptions.length}</button>
        )}
      </section>

      <Accordion title="Recent orders" icon={PackageCheck} summary="sample">
        <p className="text-base text-ink-500">Sample data, not connected yet.</p>
        <div className="divide-y divide-[var(--border-faint)]">
          {RECENT_DISPENSED_ORDERS.map((ord) => (
            <div key={ord.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-lg font-bold text-ink">{ord.customer}</p>
                <p className="text-base text-ink-500">{ord.status} · {ord.time}</p>
              </div>
              <span className="shrink-0 font-mono text-lg font-black text-ink">{ugx(ord.amount)}</span>
            </div>
          ))}
        </div>
      </Accordion>

      <Link href="/help" className="flex min-h-16 items-center gap-3 home-card !p-4 text-xl font-bold text-ink">
        <LifeBuoy className="h-7 w-7 text-gold" strokeWidth={1.75} aria-hidden />
        <span className="flex-1">Help &amp; support</span>
        <ChevronRight className="h-5 w-5 text-ink-500" aria-hidden />
      </Link>
    </div>
  );
}
