"use client";

import { Select } from "@peebee/shared/select";

import { CAR_MODEL_CATALOG, getCarBodyType, getCarDefaults, isVipRate, type CarCategory, type OwnerDeals } from "@peebee/shared";
import { Camera, CarFront, Crown, Fuel, Plus, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Accordion } from "../../components/Accordion";
import { ApplyCard } from "../../components/ApplyCard";
import { TabBar } from "../../components/TabBar";
import { AuthImage } from "../../components/AuthImage";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { compressImage } from "../../lib/image-compress";
import { TermsEditor } from "../../components/TermsEditor";

const field = "min-h-14 w-full rounded-xl border border-[var(--border-faint)] px-3 text-lg";

type Picked = { id: string; file: File; preview: string };

/** Order the vehicle types: ordinary taxis, then Luxury, Ambulance, and cargo last. */
const groupRank = (c: { kind: string; service_group?: string }) => (c.kind === "cargo" ? 3 : c.service_group === "luxury" ? 1 : c.service_group === "ambulance" ? 2 : 0);

export default function VehiclesPage() {
  const { me, mode, refreshMe, user } = useAuth();
  const [categories, setCategories] = useState<CarCategory[]>([]);
  const [limits, setLimits] = useState({ max: 8, minRequired: 0 });
  const [tiersEnabled, setTiersEnabled] = useState(false);
  const [dealLimits, setDealLimits] = useState<NonNullable<Awaited<ReturnType<typeof api.getCarConfig>>["deals"]> | null>(null);
  const [dealVehicles, setDealVehicles] = useState<OwnerDeals["vehicles"]>([]);
  const [categoryId, setCategoryId] = useState("");
  const specialSelected = (() => { const c = categories.find((x) => x.id === categoryId); return c && c.service_group && c.service_group !== "standard" ? c : undefined; })();
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [customMake, setCustomMake] = useState("");
  const [model, setModel] = useState("");
  const [modelCatalogId, setModelCatalogId] = useState("");
  const [bodyTypeFilter, setBodyTypeFilter] = useState("All");
  const [systemHelperInfo, setSystemHelperInfo] = useState<{
    model: string;
    bodyType: string;
    seatCapacity: string;
    pseudoPlate: string;
    townDailyUgx: number;
    upcountryDailyUgx: number;
    isVip: boolean;
  } | null>(null);
  const [year, setYear] = useState("");
  const [colour, setColour] = useState("");
  const [lastServiceDate, setLastServiceDate] = useState("");
  const [serviceClass, setServiceClass] = useState<"convenient" | "comfort">("convenient");
  const [acceptsConvenient, setAcceptsConvenient] = useState(false);
  const [conditionGrade, setConditionGrade] = useState<"excellent" | "good" | "fair">("good");
  const [seatCapacity, setSeatCapacity] = useState("");
  const [features, setFeatures] = useState<string[]>([]);
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"cars" | "add">("cars");
  const [step, setStep] = useState(1);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);

  function applyCarProfile(profile: (typeof CAR_MODEL_CATALOG)[number]) {
    const defaults = getCarDefaults(profile);
    setModelCatalogId(defaults.modelCatalogId);
    setModel(defaults.model);
    setSeatCapacity(defaults.seatCapacity);
    if (!year || year === "2018") setYear(defaults.year);
    setServiceClass(defaults.serviceClass);
    setConditionGrade(defaults.conditionGrade);
    setFeatures((prev) => Array.from(new Set([...prev, ...defaults.features])));
    if (!plate) setPlate(defaults.pseudoPlate);

    if (defaults.isVip) {
      const luxuryCat = categories.find((c) => c.service_group === "luxury" || /luxury/i.test(c.name));
      if (luxuryCat) setCategoryId(luxuryCat.id);
    } else {
      const matchedCat = categories.find(
        (c) => c.kind === "passenger" && c.service_group !== "luxury" && c.seats && c.seats >= profile.seats
      ) || categories.find((c) => c.kind === "passenger" && c.service_group !== "luxury");
      if (matchedCat && !categoryId) setCategoryId(matchedCat.id);
    }

    setSystemHelperInfo({
      model: defaults.model,
      bodyType: defaults.bodyType,
      seatCapacity: defaults.seatCapacity,
      pseudoPlate: defaults.pseudoPlate,
      townDailyUgx: defaults.townDailyUgx,
      upcountryDailyUgx: defaults.upcountryDailyUgx,
      isVip: defaults.isVip,
    });
  }

  function handleMakeChange(newMake: string) {
    setMake(newMake);
    setBodyTypeFilter("All");
    setModel("");
    setModelCatalogId("");
    setSeatCapacity("");
    setSystemHelperInfo(null);
  }

  function handleBodyTypeChange(type: string) {
    setBodyTypeFilter(type);
    const available = CAR_MODEL_CATALOG.filter(
      (m) => m.make === make && (type === "All" || getCarBodyType(m) === type)
    );
    if (available.length === 1) {
      applyCarProfile(available[0]);
    } else if (modelCatalogId && !available.some((m) => m.id === modelCatalogId)) {
      setModel("");
      setModelCatalogId("");
      setSystemHelperInfo(null);
    }
  }

  function handleModelSelect(catalogId: string) {
    const profile = CAR_MODEL_CATALOG.find((m) => m.id === catalogId);
    if (profile) {
      setBodyTypeFilter(getCarBodyType(profile));
      applyCarProfile(profile);
    } else {
      setModelCatalogId("");
      setModel("");
      setSystemHelperInfo(null);
    }
  }

  useEffect(() => {
    api.getCarConfig().then((c) => {
      setCategories(c.categories);
      setTiersEnabled(Boolean(c.serviceTiers));
      if (c.vehiclePhotos) setLimits(c.vehiclePhotos);
      setDealLimits(c.deals ?? null);
    }).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!dealLimits) return;
    api.dealsOwner().then((d) => setDealVehicles(d.vehicles)).catch(() => undefined);
  }, [dealLimits, me?.vehicles.length]);
  useEffect(() => () => picked.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Owners and drivers both bring cars; each profile works on its own.
  const canAdd = ["approved", "pending"].includes(me?.ownerStatus ?? "") || ["approved", "pending"].includes(me?.driverStatus ?? "");
  if (!me || !canAdd) return <div className="px-4 py-5"><ApplyCard mode={mode} /></div>;
  const approvedDriver = me.driverStatus === "approved";

  function pick(files: FileList | null, existing = 0) {
    if (!files) return;
    const room = Math.max(0, limits.max - existing - picked.length);
    const next = Array.from(files).slice(0, room).map((file) => ({ id: `${file.name}-${file.size}-${Math.random()}`, file, preview: URL.createObjectURL(file) }));
    if (files.length > room) setError(`A vehicle can have up to ${limits.max} photos.`);
    else setError("");
    setPicked((cur) => [...cur, ...next]);
  }
  function drop(id: string) {
    setPicked((cur) => {
      const gone = cur.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.preview);
      return cur.filter((p) => p.id !== id);
    });
  }

  /** Uploads the chosen photos one by one; returns how many went through. */
  async function uploadAll(vehicleId: string, files: Picked[]): Promise<number> {
    let done = 0;
    for (const p of files) {
      setProgress(`Uploading photo ${done + 1} of ${files.length}…`);
      try {
        await api.carUploadVehiclePhoto(vehicleId, await compressImage(p.file));
        done += 1;
      } catch (err) {
        setError(errorMessage(err));
      }
    }
    return done;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api.carAddVehicle({ categoryId, plate, make: (make === "Other" ? customMake : make) || undefined, model: model || undefined, modelCatalogId: modelCatalogId || undefined, year: Number(year) || undefined, colour: colour || undefined, lastServiceDate, serviceClass: specialSelected ? "convenient" : serviceClass, acceptsConvenient: specialSelected ? false : acceptsConvenient, conditionGrade, seatCapacity: Number(seatCapacity) || undefined, features });
      const sent = await uploadAll(id, picked);
      if (sent < picked.length) setError(`The vehicle was submitted, but only ${sent} of ${picked.length} photos uploaded. You can add the rest from its card below.`);
      picked.forEach((p) => URL.revokeObjectURL(p.preview));
      setPicked([]);
      setPlate("");
      setMake("");
      setModel("");
      setCustomMake(""); setBodyTypeFilter("All"); setSystemHelperInfo(null);
      setYear(""); setColour(""); setLastServiceDate("");
      setModelCatalogId(""); setServiceClass("convenient"); setAcceptsConvenient(false); setConditionGrade("good"); setSeatCapacity(""); setFeatures([]);
      await refreshMe();
      setStep(1);
      setTab("cars");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  async function addToExisting(vehicleId: string, files: FileList | null, have: number) {
    if (!files || files.length === 0) return;
    const room = Math.max(0, limits.max - have);
    const chosen = Array.from(files).slice(0, room).map((file) => ({ id: file.name, file, preview: "" }));
    setBusy(true);
    setError(files.length > room ? `A vehicle can have up to ${limits.max} photos.` : "");
    try {
      await uploadAll(vehicleId, chosen);
      await refreshMe();
    } finally {
      setBusy(false);
      setProgress("");
      setAddingTo(null);
    }
  }

  async function act(fn: () => Promise<unknown>) {
    setError("");
    try {
      await fn();
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function remove(vehicleId: string, photoId: string) {
    setError("");
    try {
      await api.carDeleteVehiclePhoto(vehicleId, photoId);
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const step1Ok = Boolean(categoryId && plate && (make === "Other" ? customMake && model : modelCatalogId || model) && year);
  const step2Ok = Boolean(seatCapacity && lastServiceDate);
  const pill = (on: boolean) => `min-h-12 rounded-full px-4 text-base font-bold ${on ? "bg-gold text-ink-gold" : "bg-gold/15 text-ink"}`;
  return (
    <div className="space-y-4 px-4 py-5">
      <TabBar label="Vehicles" active={tab} onChange={setTab} tabs={[{ id: "cars", label: "My cars", icon: CarFront, count: me.vehicles.length }, { id: "add", label: "Add a car", icon: Plus }]} />
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-base text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
      {tab === "cars" && me.ownerStatus !== "approved" && <p className="text-base text-ink-500">Your owner profile is being checked.</p>}
      {tab === "cars" && me.vehicles.length === 0 && (
        <button type="button" onClick={() => setTab("add")} className="home-card flex min-h-20 w-full items-center justify-center gap-3 text-xl font-bold text-gold"><Plus className="h-7 w-7" aria-hidden /> Add your first car</button>
      )}
      {tab === "cars" && me.vehicles.map((v) => (
        <section key={v.id} className="home-card space-y-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-2xl font-black text-ink">{v.plate}</p>
              <p className="text-lg text-ink-500">{[v.make, v.model].filter(Boolean).join(" ") || v.category_name}</p>
            </div>
            <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold capitalize ${v.status === "approved" ? "bg-green/15 text-green" : "bg-amber-500/15 text-amber-600"}`}>{v.status}</span>
          </div>
          <p className="text-lg text-ink">
            {v.status === "approved" ? (v.driver_name ? `Driver: ${v.driver_name}` : "Waiting for a driver") : "Being checked"}
          </p>
          {v.status === "approved" && approvedDriver && (!v.driver_id || v.driver_id === user?.id) && (
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => (v.driver_id === user?.id ? api.carReleaseVehicle(v.id) : api.carDriveVehicle(v.id)))}
              className="min-h-14 w-full rounded-full bg-gold/15 px-4 text-lg font-bold text-ink disabled:opacity-50"
            >
              {v.driver_id === user?.id ? "Stop driving" : "Drive it myself"}
            </button>
          )}
          {v.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {v.photos.slice(0, 3).map((photoId) => (
                <AuthImage key={photoId} vehicleId={v.id} photoId={photoId} className="block aspect-[4/3] w-full rounded-lg object-cover" />
              ))}
            </div>
          )}
          <Accordion title="Details" summary={`${v.photos.length} photo${v.photos.length === 1 ? "" : "s"}`}>
            <p className="text-lg text-ink-500">{v.service_class === "comfort" ? "Comfort" : "Convenient"}{v.condition_grade ? ` · ${v.condition_grade}` : ""}{v.seat_capacity ? ` · ${v.seat_capacity} seats` : ""}{v.last_service_date ? ` · serviced ${v.last_service_date}` : ""}</p>
            {tiersEnabled && <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => act(() => api.carUpdateRideService(v.id, "convenient", false))} className={pill(v.service_class !== "comfort")}>Convenient first</button>
              <button type="button" disabled={busy} onClick={() => act(() => api.carUpdateRideService(v.id, "comfort", false))} className={pill(v.service_class === "comfort" && !v.accepts_convenient)}>Comfort only</button>
              <button type="button" disabled={busy} onClick={() => act(() => api.carUpdateRideService(v.id, "comfort", true))} className={pill(v.service_class === "comfort" && !!v.accepts_convenient)}>Comfort + Convenient</button>
            </div>}
            {dealLimits && dealVehicles.find((d) => d.id === v.id) && (
              <TermsEditor
                key={`${v.id}-${dealVehicles.find((d) => d.id === v.id)?.terms?.open}`}
                vehicle={dealVehicles.find((d) => d.id === v.id)!}
                limits={dealLimits}
                onSaved={() => api.dealsOwner().then((d) => setDealVehicles(d.vehicles)).catch(() => undefined)}
              />
            )}
            {v.photos.length > 0 && (
              <div className="grid grid-cols-3 gap-2">
                {v.photos.map((photoId) => (
                  <div key={photoId} className="relative">
                    <AuthImage vehicleId={v.id} photoId={photoId} className="block aspect-[4/3] w-full rounded-lg object-cover" />
                    <button type="button" onClick={() => remove(v.id, photoId)} aria-label="Remove photo" className="absolute right-1 top-1 flex h-9 w-9 items-center justify-center rounded-full bg-ink/70 text-white">
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {v.photos.length < limits.max && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { setAddingTo(v.id); addInput.current?.click(); }}
                  className="flex min-h-14 items-center gap-2 text-lg font-bold text-gold disabled:opacity-50"
                >
                  <Camera className="h-6 w-6" aria-hidden />Add photos ({v.photos.length}/{limits.max})
                </button>
                {limits.minRequired > v.photos.length && v.status === "pending" && (
                  <p className="text-base text-ink-500">Add {limits.minRequired - v.photos.length} more photo{limits.minRequired - v.photos.length === 1 ? "" : "s"} for approval.</p>
                )}
              </>
            )}
          </Accordion>
          <Link href="/fuel" className="flex min-h-14 items-center justify-center gap-2 rounded-xl bg-[rgb(var(--surface-muted))] text-lg font-bold text-ink">
            <Fuel className="h-5 w-5 text-gold" aria-hidden /> Fuel
          </Link>
        </section>
      ))}
      <input
        ref={addInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const vehicle = me.vehicles.find((v) => v.id === addingTo);
          void addToExisting(addingTo ?? "", e.target.files, vehicle?.photos.length ?? 0);
          e.target.value = "";
        }}
      />

      {tab === "add" && <form onSubmit={add} className="home-card space-y-3">
        <p className="text-lg font-bold text-ink">Step {step} of 3 · {step === 1 ? "The car" : step === 2 ? "Condition" : "Photos"}</p>
        <div className="flex gap-1.5" aria-hidden>{[1, 2, 3].map((n) => <span key={n} className={`h-1.5 flex-1 rounded-full ${n <= step ? "bg-gold" : "bg-[rgb(var(--surface-muted))]"}`} />)}</div>
        {step === 1 && <>
        <Select sizing="stretch" required value={categoryId} onValueChange={(value) => setCategoryId(value)} className={field} aria-label="Vehicle type">
          <option value="">Choose vehicle type…</option>
          {[...categories].sort((a, b) => groupRank(a) - groupRank(b)).map((c) => (
            <option key={c.id} value={c.id}>{c.name}{c.kind === "passenger" && c.seats ? ` (${c.seats} seats)` : ""}{c.service_group === "luxury" ? " · Luxury" : c.service_group === "ambulance" ? " · Ambulance" : ""}</option>
          ))}
        </Select>
        {specialSelected?.service_group === "luxury" && <p className="rounded-xl bg-gold/10 p-3 text-xs text-ink">Luxury cars get weddings, parties, red carpet and VIP bookings. Peebee checks the car and its condition before it can take them.</p>}
        {specialSelected?.service_group === "ambulance" && <p className="rounded-xl bg-red-50 p-3 text-xs text-red-700 dark:bg-red-950/40 dark:text-red-300">Ambulances get emergency requests and are sent at once. Peebee checks the vehicle, its medical equipment and the crew&apos;s qualifications before it can take any. Add clear photos and keep your documents ready.</p>}
        <input required value={plate} onChange={(e) => setPlate(e.target.value)} placeholder="Number plate" className={field} />
        <div className="grid grid-cols-1 gap-3">
          <Select sizing="stretch" required value={make} onValueChange={handleMakeChange} className={field} aria-label="Vehicle make">
            <option value="">Choose make…</option>
            {[...new Set(CAR_MODEL_CATALOG.map((m) => m.make))].sort().map((name) => <option key={name} value={name}>{name}</option>)}
            <option value="Other">Other / not listed</option>
          </Select>
          {make && make !== "Other" ? (
            <Select sizing="stretch" required value={modelCatalogId} onValueChange={handleModelSelect} className={field} aria-label="Vehicle model">
              <option value="">Choose model…</option>
              {CAR_MODEL_CATALOG.filter((m) => m.make === make && (bodyTypeFilter === "All" || getCarBodyType(m) === bodyTypeFilter)).map((m) => {
                const isVip = m.isVip ?? isVipRate(m.townDailyUgx ?? m.standardDailyUgx);
                return (
                  <option key={m.id} value={m.id}>
                    {isVip ? "👑 " : ""}{m.model}{m.variant ? ` · ${m.variant}` : ""} ({getCarBodyType(m)})
                  </option>
                );
              })}
            </Select>
          ) : <div className="space-y-2">{make === "Other" && <input required value={customMake} onChange={(e) => setCustomMake(e.target.value)} placeholder="Enter make name" className={field} />}<input required value={model} onChange={(e) => setModel(e.target.value)} placeholder="Enter model name" className={field} /></div>}
        </div>
        {make && make !== "Other" && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs text-ink-500">
              <span>Body type helper</span>
              {bodyTypeFilter !== "All" && (
                <button type="button" onClick={() => handleBodyTypeChange("All")} className="text-xs font-semibold text-gold hover:underline">
                  Show all types
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {["All", ...Array.from(new Set(CAR_MODEL_CATALOG.filter((m) => m.make === make).map((m) => getCarBodyType(m))))].map((bt) => (
                <button
                  key={bt}
                  type="button"
                  onClick={() => handleBodyTypeChange(bt)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors ${
                    bodyTypeFilter === bt
                      ? "bg-gold text-ink-gold"
                      : "bg-[rgb(var(--surface-muted))] text-ink hover:bg-gold/15"
                  }`}
                >
                  {bt === "All" ? "All types" : bt}
                </button>
              ))}
            </div>
          </div>
        )}
        {systemHelperInfo && (
          <div className={`space-y-2 rounded-xl border p-3 text-xs ${
            systemHelperInfo.isVip ? "border-gold/40 bg-gold/15 text-ink" : "border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] text-ink"
          }`}>
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div className="flex items-center gap-1.5 font-bold">
                {systemHelperInfo.isVip ? <Crown className="h-4 w-4 shrink-0 text-gold" /> : <Sparkles className="h-4 w-4 shrink-0 text-gold" />}
                <span>System Helper: {systemHelperInfo.model}</span>
              </div>
              {systemHelperInfo.isVip ? (
                <span className="rounded-full bg-gold/25 px-2 py-0.5 text-[11px] font-bold text-ink">
                  👑 VIP Fleet (≥ 500k/day)
                </span>
              ) : (
                <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[11px] font-semibold text-ink-500">
                  Standard Fleet (&lt; 500k/day)
                </span>
              )}
            </div>
            <p className="text-ink-500">
              Body: <strong className="text-ink">{systemHelperInfo.bodyType}</strong> · Seats: <strong className="text-ink">{systemHelperInfo.seatCapacity}</strong> · Suggested Plate: <strong className="font-mono text-ink">{systemHelperInfo.pseudoPlate}</strong>
            </p>
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
              <span className="rounded bg-black/5 px-2 py-0.5 dark:bg-white/10">
                Town benchmark: <strong>{systemHelperInfo.townDailyUgx.toLocaleString()} UGX/day</strong>
              </span>
              <span className="rounded bg-black/5 px-2 py-0.5 dark:bg-white/10">
                Upcountry benchmark: <strong>{systemHelperInfo.upcountryDailyUgx.toLocaleString()} UGX/day</strong>
              </span>
            </div>
            <p className="text-[10px] text-ink-500 italic">
              Category, seats, condition, and features were automatically populated. You can edit any value below.
            </p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3">
          <Select sizing="stretch" required value={year} onValueChange={setYear} className={field} aria-label="Vehicle model year"><option value="">Choose model year…</option>{Array.from({ length: new Date().getFullYear() - 1989 }, (_, i) => new Date().getFullYear() - i).map((y) => <option key={y} value={String(y)}>{y}</option>)}</Select>
          <Select sizing="stretch" value={colour} onValueChange={setColour} className={field} aria-label="Vehicle colour"><option value="">Choose colour…</option>{["White","Black","Silver","Grey","Blue","Red","Green","Brown","Gold","Other"].map((x) => <option key={x}>{x}</option>)}</Select>
        </div>
        {modelCatalogId && <p className="text-xs text-ink-500">Reference profile: {CAR_MODEL_CATALOG.find((m) => m.id === modelCatalogId)?.seats} seats · {Math.round((CAR_MODEL_CATALOG.find((m) => m.id === modelCatalogId)?.fuelLitresPerKm ?? 0) * 1000)} L/100 km. Actual fuel use varies by year, trim and condition.</p>}
        <button type="button" disabled={!step1Ok} onClick={() => setStep(2)} className="min-h-16 w-full rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-50">Next</button>
        </>}
        {step === 2 && <>
        <div className="grid grid-cols-1 gap-3">
          {!specialSelected && <Select sizing="stretch" value={serviceClass} onValueChange={(v) => setServiceClass(v as typeof serviceClass)} className={field} aria-label="Vehicle class"><option value="convenient">Convenient · ordinary</option><option value="comfort">Comfort · newer or extra features</option></Select>}
          <Select sizing="stretch" value={conditionGrade} onValueChange={(v) => setConditionGrade(v as typeof conditionGrade)} className={field} aria-label="Vehicle condition"><option value="excellent">Excellent condition</option><option value="good">Good condition</option><option value="fair">Fair condition</option></Select>
        </div>
        {serviceClass === "comfort" && <label className="flex items-center gap-2 text-lg text-ink"><input type="checkbox" checked={acceptsConvenient} onChange={(e) => setAcceptsConvenient(e.target.checked)} />Also accept Convenient fares when no Comfort ride is available</label>}
        <Select sizing="stretch" required value={seatCapacity} onValueChange={setSeatCapacity} className={field} aria-label="Total seat capacity"><option value="">Choose total seats…</option>{Array.from({ length: 50 }, (_, i) => i + 1).map((n) => <option key={n} value={String(n)}>{n} seats</option>)}</Select>
        <label className="block space-y-1 text-base font-semibold text-ink-500">Most recent service date<input required type="date" max={new Date().toISOString().slice(0, 10)} value={lastServiceDate} onChange={(e) => setLastServiceDate(e.target.value)} className={field} /></label>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-lg text-ink-500">{["Air conditioning", "Bluetooth", "USB charging", "Child seat", "Automatic", "4WD"].map((feature) => <label key={feature} className="flex items-center gap-1.5"><input type="checkbox" checked={features.includes(feature)} onChange={(e) => setFeatures((prev) => e.target.checked ? [...prev, feature] : prev.filter((x) => x !== feature))} />{feature}</label>)}</div>

        <div className="flex gap-2"><button type="button" onClick={() => setStep(1)} className="min-h-16 rounded-full bg-gold/15 px-6 text-xl font-bold text-ink">Back</button><button type="button" disabled={!step2Ok} onClick={() => setStep(3)} className="min-h-16 flex-1 rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-50">Next</button></div>
        </>}
        {step === 3 && <>
        <div className="space-y-2">
          <p className="text-base font-semibold text-ink-500">
            Photos ({picked.length}/{limits.max}){limits.minRequired > 0 ? ` — at least ${limits.minRequired} needed` : ""}. Show the front, back, sides, inside and number plate.
          </p>
          <div className="grid grid-cols-3 gap-2">
            {picked.map((p) => (
              <div key={p.id} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.preview} alt="" className="block aspect-[4/3] w-full rounded-lg object-cover" />
                <button type="button" onClick={() => drop(p.id)} aria-label="Remove photo" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-white">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {picked.length < limits.max && (
              <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-faint)] text-base font-semibold text-ink-500">
                <Camera className="h-5 w-5" />
                Add
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </div>

        <div className="flex gap-2"><button type="button" onClick={() => setStep(2)} className="min-h-16 rounded-full bg-gold/15 px-6 text-xl font-bold text-ink">Back</button><button disabled={busy} className="min-h-16 flex-1 rounded-full bg-gold text-xl font-extrabold text-ink-gold disabled:opacity-50">{busy ? progress || "Please wait…" : "Submit"}</button></div>
        </>}
      </form>}
    </div>
  );
}
