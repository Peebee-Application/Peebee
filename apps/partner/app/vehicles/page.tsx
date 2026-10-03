"use client";

import type { CarCategory } from "@tuma/shared";
import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApplyCard } from "../../components/ApplyCard";
import { AuthImage } from "../../components/AuthImage";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { compressImage } from "../../lib/image-compress";

const field = "min-h-12 w-full rounded-xl border border-[var(--border-faint)] px-3";

type Picked = { id: string; file: File; preview: string };

export default function VehiclesPage() {
  const { me, mode, refreshMe } = useAuth();
  const [categories, setCategories] = useState<CarCategory[]>([]);
  const [limits, setLimits] = useState({ max: 8, minRequired: 0 });
  const [categoryId, setCategoryId] = useState("");
  const [plate, setPlate] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [picked, setPicked] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const addInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.getCarConfig().then((c) => {
      setCategories(c.categories);
      if (c.vehiclePhotos) setLimits(c.vehiclePhotos);
    }).catch(() => undefined);
  }, []);
  useEffect(() => () => picked.forEach((p) => URL.revokeObjectURL(p.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (mode !== "owner") return <p className="px-4 py-5 text-sm text-ink-500">Switch to Owner (top right) to manage vehicles.</p>;
  if (me?.ownerStatus !== "approved") return <div className="px-4 py-5"><ApplyCard mode="owner" /></div>;

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
      const { id } = await api.carAddVehicle({ categoryId, plate, make: make || undefined, model: model || undefined });
      const sent = await uploadAll(id, picked);
      if (sent < picked.length) setError(`The vehicle was submitted, but only ${sent} of ${picked.length} photos uploaded. You can add the rest from its card below.`);
      picked.forEach((p) => URL.revokeObjectURL(p.preview));
      setPicked([]);
      setPlate("");
      setMake("");
      setModel("");
      await refreshMe();
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

  async function remove(vehicleId: string, photoId: string) {
    setError("");
    try {
      await api.carDeleteVehiclePhoto(vehicleId, photoId);
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-5 px-4 py-5">
      <h1 className="text-2xl font-black text-ink">My vehicles</h1>
      {me.vehicles.length === 0 && <p className="text-sm text-ink-500">No vehicles yet — add your first below.</p>}
      {me.vehicles.map((v) => (
        <section key={v.id} className="home-card space-y-2">
          <p className="font-bold text-ink">{v.plate} <span className="font-normal text-ink-500">· {v.category_name}</span></p>
          <p className="text-xs text-ink-500">{[v.make, v.model].filter(Boolean).join(" ")}</p>
          <p className="text-xs text-ink-500">
            {v.status === "approved" ? (v.driver_name ? `Driver: ${v.driver_name}` : "Approved — waiting for Tuma to assign a driver") : `Status: ${v.status}`}
          </p>
          {v.photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {v.photos.map((photoId) => (
                <div key={photoId} className="relative">
                  <AuthImage vehicleId={v.id} photoId={photoId} className="block aspect-[4/3] w-full rounded-lg object-cover" />
                  <button type="button" onClick={() => remove(v.id, photoId)} aria-label="Remove photo" className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-ink/70 text-white">
                    <X className="h-3.5 w-3.5" />
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
                className="flex min-h-10 items-center gap-2 text-sm font-bold text-gold disabled:opacity-50"
              >
                <Camera className="h-4 w-4" />Add photos ({v.photos.length}/{limits.max})
              </button>
              {limits.minRequired > v.photos.length && v.status === "pending" && (
                <p className="text-xs text-ink-500">Add at least {limits.minRequired - v.photos.length} more photo{limits.minRequired - v.photos.length === 1 ? "" : "s"} so Tuma can approve it.</p>
              )}
            </>
          )}
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

        <div className="space-y-2">
          <p className="text-xs font-semibold text-ink-500">
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
              <label className="flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-[var(--border-faint)] text-xs font-semibold text-ink-500">
                <Camera className="h-5 w-5" />
                Add
                <input type="file" accept="image/*" multiple hidden onChange={(e) => { pick(e.target.files); e.target.value = ""; }} />
              </label>
            )}
          </div>
        </div>

        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
        <button disabled={busy} className="min-h-12 w-full rounded-full bg-gold font-bold text-ink-gold disabled:opacity-50">{busy ? progress || "Please wait…" : "Submit for approval"}</button>
      </form>
    </div>
  );
}
