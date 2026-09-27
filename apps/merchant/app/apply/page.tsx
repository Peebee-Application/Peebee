"use client";

import type { MerchantCategory } from "@tuma/shared";
import { LocateFixed, Store } from "lucide-react";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

export default function ApplyPage() {
  const { refreshMerchants, logout } = useAuth();
  const [categories, setCategories] = useState<MerchantCategory[]>([]);
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [outletName, setOutletName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api.merchantCategories().then((r) => { setCategories(r.categories); setCategoryId(r.categories[0]?.id ?? ""); }).catch((e) => setError(errorMessage(e))); }, []);

  function captureLocation() {
    setBusy(true);
    setError("");
    navigator.geolocation.getCurrentPosition(
      (position) => { setLocation({ lat: position.coords.latitude, lng: position.coords.longitude }); setBusy(false); },
      () => { setError("Location is required to register the outlet and protect in-store payments."); setBusy(false); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!location) { setError("Capture the outlet location before submitting."); return; }
    setBusy(true);
    setError("");
    try {
      await api.applyAsMerchant({ legalName, displayName, outletName, categoryId, phone: phone || undefined, address: address || undefined, ...location });
      await refreshMerchants();
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return <div className="space-y-5 px-4 py-6"><header className="text-center"><Store className="mx-auto h-9 w-9 text-gold"/><h1 className="mt-2 text-2xl font-black text-navy">Register your business</h1><p className="text-sm text-ink-500">The first rollout is for formal retailers with smartphones.</p></header>
    <form onSubmit={submit} className="home-card space-y-3">
      <input required value={legalName} onChange={(e) => setLegalName(e.target.value)} placeholder="Registered legal name" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Trading name customers know" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      <select required value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"><option value="">Business category</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
      <input required value={outletName} onChange={(e) => setOutletName(e.target.value)} placeholder="First outlet name" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Business phone" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Outlet address" className="min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3"/>
      <button type="button" onClick={captureLocation} disabled={busy} className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-gold font-bold text-gold"><LocateFixed className="h-4 w-4"/>{location ? `Location captured (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})` : "Capture outlet location"}</button>
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      <button disabled={busy || !location} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? "Submitting…" : "Submit for review"}</button>
    </form>
    <button type="button" onClick={logout} className="w-full text-sm font-semibold text-ink-500">Use another account</button>
  </div>;
}
