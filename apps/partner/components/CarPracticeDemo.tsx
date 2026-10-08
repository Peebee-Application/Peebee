"use client";

import { useState } from "react";

const vehicles = [
  { name: "Comfort sedan", car: "Toyota Corolla", plate: "UFX 248P", seats: "4 seats" },
  { name: "Family SUV", car: "Toyota RAV4", plate: "UFX 316R", seats: "6 seats" },
  { name: "Small cargo van", car: "Nissan Caravan", plate: "UFX 529V", seats: "General goods · small" },
];
const stages = ["New ride request", "Daniel accepted · Toyota Corolla", "Driver at pickup", "Passenger on the way", "Ride completed"];

/** A local-only Peebee Car scenario for owners and drivers. */
export function CarPracticeDemo({ mode }: { mode: "owner" | "driver" }) {
  const [step, setStep] = useState(0);

  return (
    <section className="home-card space-y-3 border-2 border-gold/40">
      <div>
        <h2 className="font-bold">Demo fleet · {mode === "owner" ? "owner view" : "driver view"}</h2>
        <p className="mt-1 text-xs text-ink-500">Sample vehicles, owners, drivers and customer ride. These examples are separate from your real fleet and orders.</p>
      </div>
      <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-sm">
        <p className="font-bold">Demo owners</p><p className="text-ink-500">Amina N. · Peter O.</p>
        <p className="mt-2 font-bold">Demo drivers</p><p className="text-ink-500">Daniel Kato · Sarah Namusoke</p>
      </div>
      <div className="space-y-2">
        {vehicles.map((v) => <div key={v.plate} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-faint)] p-3 text-sm"><span><strong className="block">{v.name}</strong><span className="text-xs text-ink-500">{v.car} · {v.seats}</span></span><span className="shrink-0 text-right text-xs font-semibold">{v.plate}<span className="block font-normal text-ink-500">Demo car</span></span></div>)}
      </div>
      <div className="rounded-2xl bg-gold/10 p-3">
        <p className="text-xs font-semibold text-ink-500">Demo customer: Grace · Kitoro → Entebbe Airport</p>
        <p aria-live="polite" className="mt-1 font-bold">{stages[step]}</p>
      </div>
      <div className="flex gap-2"><button type="button" disabled={step === stages.length - 1} onClick={() => setStep((n) => Math.min(n + 1, stages.length - 1))} className="min-h-11 flex-1 rounded-full bg-gold px-4 text-sm font-bold text-ink-gold">{step === stages.length - 1 ? "Demo ride complete" : mode === "owner" ? "Advance demo ride" : "Continue demo ride"}</button><button type="button" onClick={() => setStep(0)} className="min-h-11 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold">Restart</button></div>
    </section>
  );
}
