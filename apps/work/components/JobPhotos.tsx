"use client";

import type { WorkPhoto } from "@peebee/shared";
import { Camera } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { shrinkPhoto } from "../lib/image";

const PHASE_LABEL: Record<WorkPhoto["phase"], string> = { request: "From the customer", before: "Before", after: "After" };

function Thumb({ photo }: { photo: WorkPhoto }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    api.workPhotoBlob(photo.id).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    }).catch(() => {});
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [photo.id]);
  return (
    <figure className="space-y-1">
      <div className="aspect-square overflow-hidden rounded-2xl bg-black/5">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {src ? <img src={src} alt={photo.note || PHASE_LABEL[photo.phase]} className="h-full w-full object-cover" /> : null}
      </div>
      <figcaption className="text-sm font-bold text-ink-500">{PHASE_LABEL[photo.phase]}{photo.note ? ` · ${photo.note}` : ""}</figcaption>
    </figure>
  );
}

/** Photos on a job. The provider can add before/after photos once the job is theirs and still active. */
export function JobPhotos({ jobId, canAdd, maxPhotos }: { jobId: string; canAdd: boolean; maxPhotos?: number }) {
  const [photos, setPhotos] = useState<WorkPhoto[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<"before" | "after">("before");
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(() => api.workProviderJobPhotos(jobId).then((r) => setPhotos(r.photos)).catch(() => {}), [jobId]);
  useEffect(() => { load(); }, [load]);

  async function pick(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      await api.workProviderUploadPhoto(jobId, await shrinkPhoto(file), phase);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  if (photos.length === 0 && !canAdd) return null;
  return (
    <section className="home-card space-y-3 p-4">
      <h2 className="text-base font-black uppercase tracking-wider text-ink-500">Photos</h2>
      {error && <div className="rounded-2xl bg-red-500/10 p-3 text-base font-bold text-red-600" role="alert">{error}</div>}
      {photos.length > 0 && <div className="grid grid-cols-3 gap-2">{photos.map((p) => <Thumb key={p.id} photo={p} />)}</div>}
      {canAdd && (!maxPhotos || photos.length < maxPhotos) && (
        <div className="flex items-center gap-2">
          <select value={phase} onChange={(e) => setPhase(e.target.value as "before" | "after")} aria-label="Photo type" className="rounded-full border border-[var(--border-faint)] px-3 py-2 text-base font-bold text-ink outline-none">
            <option value="before">Before</option>
            <option value="after">After</option>
          </select>
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex flex-1 items-center justify-center gap-2 min-h-14 rounded-2xl bg-gold text-lg font-black text-ink-gold transition active:scale-[0.98] disabled:opacity-50">
            <Camera className="h-4 w-4" aria-hidden />{busy ? "Uploading…" : "Add a photo"}
          </button>
          <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
      )}
    </section>
  );
}
