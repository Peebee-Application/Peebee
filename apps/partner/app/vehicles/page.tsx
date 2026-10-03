"use client";

import type { CarCategory } from "@tuma/shared";
import { useEffect, useState } from "react";
import { ApplyCard } from "../../components/ApplyCard";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

const field = "min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3";

export default function VehiclesPage() {
  const { me, mode, refreshMe } = useAuth();
  const [categories, setCategories] = useState<CarCategory[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getCarConfig().then((c) => setCategories(c.categories)).catch(() => undefined);
  }, []);

  if (mode !== "owner") return <p className="px-4 py-5 text-sm text-ink-500">Switch to Owner (top right) to manage vehicles.</p>;
  if (me?.ownerStatus !== "approved") return <div className="px-4 py-5"><ApplyCard mode="owner" /></div>;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.carAddVehicle({ categoryId, plate, make: make || undefined, model: model || undefined });
      setPlate("");
      setMake("");
      setModel("");
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 px-4 py-5">
      <h1 className="text-2xl font-black text-ink">My vehicles</h1>
      {me.vehicles.length === 0 && <p className="text-sm text-ink-500">No vehicles yet — add your first below.</p>}
      {me.vehicles.map((v) => (
        <section key={v.id} className="home-card space-y-1">
          <p className="font-bold text-ink">{v.plate} <span className="font-normal text-ink-500">· {v.category_name}</span></p>
          <p className="text-xs text-ink-500">{[v.make, v.model].filter(Boolean).join(" ")}</p>
          <p className="text-xs text-ink-500">
            {v.status === "approved" ? (v.driver_name ? `Driver: ${v.driver_name}` : "Approved — waiting for Tuma to assign a driver") : `Status: ${v.status}`}
          </p>
        </section>
      ))}
      <form onSubmit={add} className="home-card space-y-3">
        <h2 className="font-bold">Put a vehicle up for service</h2>
        <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={field} aria-label="Vehicle type">
          <option value="">Vehicle type…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.kind === "passenger" && c.seats ? ` (${c.seats} seats)` : ""}</option>
          ))}
        </select>
        <input required value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Number plate" className={field} />
        <div className="grid grid-cols-2 gap-3">
          <input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Make" className={field} />
          <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="Model" className={field} />
        </div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <button disabled={busy} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Please wait…" : "Submit for approval"}</button>
      </form>
    </div>
  );
}
