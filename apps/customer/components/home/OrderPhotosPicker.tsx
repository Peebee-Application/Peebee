"use client";

import { Camera, Check, CircleAlert, ClipboardPaste, Images, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { compressImage } from "../../lib/image-compress";

/** A photo the customer is attaching to an order, kept on the phone until the order exists. */
export type PhotoDraft = {
  id: string;
  blob: Blob;
  url: string;
  /** Hash of the original bytes, so the same clipboard image isn't offered twice. */
  hash: string;
  /** "local": not uploaded yet (guest checkout uploads after the order exists). */
  status: "uploading" | "done" | "failed" | "local";
  progress: number;
  key?: string;
  note: string;
  /** Index into the list items passed in, or null. */
  itemIndex: number | null;
};

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 6 * 1024 * 1024;
const NOTE_MAX = 80;
/** Clipboard images the customer already added or waved away (by hash), for this visit. */
const seenClipboard = new Set<string>();

async function hashBlob(blob: Blob): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return `${blob.size}-${blob.type}`;
  }
}

/** The first image on the clipboard, if the browser lets us read it. Throws NotAllowedError when it doesn't. */
async function readClipboardImage(): Promise<Blob | null> {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type) return item.getType(type);
  }
  return null;
}

function imageFromPaste(e: ClipboardEvent | React.ClipboardEvent): File | null {
  const data = e.clipboardData;
  if (!data) return null;
  for (const file of Array.from(data.files ?? [])) if (file.type.startsWith("image/")) return file;
  for (const item of Array.from(data.items ?? [])) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  return null;
}

function PhotoSheet({ label, onClose, children }: { label: string; onClose: () => void; children: React.ReactNode }) {
  return createPortal(
    <div className="fixed inset-0 z-[95] flex items-end justify-center" role="dialog" aria-modal="true" aria-label={label}>
      <button type="button" className="absolute inset-0 bg-black/50" aria-label="Close" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-t-[28px] bg-cream px-5 pb-[calc(1.75rem+env(safe-area-inset-bottom))] pt-2.5 text-ink">
        <span className="mx-auto block h-1.5 w-10 rounded-full bg-[rgb(var(--color-ink-500)/0.25)]" aria-hidden />
        <div className="mt-3 flex items-center justify-between">
          <b className="text-lg">{label}</b>
          <button type="button" onClick={onClose} className="grid h-8 w-8 place-items-center rounded-full bg-[rgb(var(--surface-muted))] text-ink-500" aria-label="Close">
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}


/** "Add a picture": camera or gallery (plus a quick-add tile when the clipboard
 * already holds an image, and paste anywhere); thumbnails with a note
 * and an optional link to a list item. With `upload`, each photo uploads as soon
 * as it's added (progress, retry); without it, photos stay local for the caller
 * to send once the order exists. */
export function OrderPhotosPicker({
  photos,
  onChange,
  maxPhotos,
  items,
  upload,
}: {
  photos: PhotoDraft[];
  onChange: (update: (prev: PhotoDraft[]) => PhotoDraft[]) => void;
  maxPhotos: number;
  /** List item names, for "Which item is this?". Omit in voice mode. */
  items?: string[];
  upload?: (blob: Blob) => Promise<{ key: string }>;
}) {
  const [detailId, setDetailId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [clip, setClip] = useState<{ blob: Blob; url: string; hash: string } | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const photosRef = useRef(photos);
  useEffect(() => {
    photosRef.current = photos;
  }, [photos]);
  const room = maxPhotos - photos.length;
  const linkable = items && items.length > 0 ? items : null;

  const update = useCallback((id: string, patch: Partial<PhotoDraft>) => onChange((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p))), [onChange]);

  const startUpload = useCallback(
    (draft: PhotoDraft) => {
      if (!upload) return;
      update(draft.id, { status: "uploading", progress: 0.08 });
      upload(draft.blob)
        .then(({ key }) => update(draft.id, { status: "done", progress: 1, key }))
        .catch(() => update(draft.id, { status: "failed", progress: 0 }));
    },
    [update, upload],
  );

  // fetch() can't report upload progress, so the ring eases towards 90% while a
  // photo is in flight and fills when the server confirms it (photos are small after compression).
  const uploading = photos.some((p) => p.status === "uploading");
  useEffect(() => {
    if (!uploading) return;
    const timer = setInterval(() => {
      onChange((prev) => prev.map((p) => (p.status === "uploading" ? { ...p, progress: p.progress + (0.9 - p.progress) * 0.18 } : p)));
    }, 160);
    return () => clearInterval(timer);
  }, [uploading, onChange]);

  const addBlobs = useCallback(
    async (blobs: Blob[]) => {
      setMessage(null);
      const free = maxPhotos - photosRef.current.length;
      if (free <= 0) {
        setMessage(`Max ${maxPhotos} photos.`);
        return;
      }
      if (blobs.length > free) setMessage(`Max ${maxPhotos} photos.`);
      const drafts: PhotoDraft[] = [];
      for (const raw of blobs.slice(0, free)) {
        const hash = await hashBlob(raw);
        seenClipboard.add(hash);
        const file = raw instanceof File ? raw : new File([raw], `photo.${(raw.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: raw.type });
        const blob = await compressImage(file);
        if (!ALLOWED.has(blob.type)) {
          setMessage("Use a JPEG, PNG or WebP photo.");
          continue;
        }
        if (blob.size > MAX_BYTES) {
          setMessage("That photo is too large (6 MB max).");
          continue;
        }
        drafts.push({ id: crypto.randomUUID(), blob, url: URL.createObjectURL(blob), hash, status: upload ? "uploading" : "local", progress: upload ? 0.08 : 1, note: "", itemIndex: null });
      }
      if (!drafts.length) return;
      onChange((prev) => [...prev, ...drafts]);
      drafts.forEach(startUpload);
      setClip((c) => (c && seenClipboard.has(c.hash) ? null : c));
    },
    [maxPhotos, onChange, startUpload, upload],
  );

  // Ctrl/Cmd+V anywhere on the screen, and long-press → Paste on phones that
  // deliver a paste event. In a text field, a plain-text paste stays text.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented) return;
      const file = imageFromPaste(e);
      if (!file) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']") && e.clipboardData?.getData("text/plain")) return;
      e.preventDefault();
      void addBlobs([file]);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [addBlobs]);

  // Quick-add tile: only where the browser already lets us read the clipboard
  // without asking (Chrome/Android after a one-time allow), and only when it
  // holds an image we haven't offered yet. Otherwise nothing shows.
  useEffect(() => {
    let alive = true;
    async function check() {
      if (!navigator.clipboard?.read || !navigator.permissions?.query) return;
      try {
        const status = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
        if (status.state !== "granted" || document.visibilityState !== "visible") return;
        const blob = await readClipboardImage();
        if (!alive || !blob) return;
        const hash = await hashBlob(blob);
        if (!alive || seenClipboard.has(hash) || photosRef.current.some((p) => p.hash === hash)) return;
        setClip((prev) => {
          if (prev?.hash === hash) return prev;
          if (prev) URL.revokeObjectURL(prev.url);
          return { blob, url: URL.createObjectURL(blob), hash };
        });
      } catch {
        // Not supported or not allowed: no tile.
      }
    }
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  // The sheets sit above the list modal: Escape closes the sheet, not the whole list.
  const sheetOpen = detailId != null;
  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "Tab") return;
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        setDetailId(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [sheetOpen]);

  function remove(id: string) {
    onChange((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });
    setDetailId(null);
  }

  const failed = photos.filter((p) => p.status === "failed");
  const detail = photos.find((p) => p.id === detailId) ?? null;

  const full = room <= 0;
  const srcBtn =
    "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] border border-[var(--border-faint)] bg-[rgb(var(--surface-muted)/0.7)] text-[13.5px] font-bold text-ink transition-opacity active:opacity-80 disabled:opacity-40";

  return (
    <div className="order-photos rounded-[18px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 pb-2 pt-1.5 shadow-[var(--shadow-card)]">
      <p className="mb-1.5 text-[13px] font-bold leading-tight text-ink">Add a picture</p>
      <div className="flex items-stretch gap-2">
        <button type="button" disabled={full} onClick={() => cameraRef.current?.click()} className={srcBtn}>
          <Camera className="h-5 w-5" strokeWidth={2} aria-hidden />
          Camera
        </button>
        <button type="button" disabled={full} onClick={() => galleryRef.current?.click()} className={srcBtn}>
          <Images className="h-5 w-5" strokeWidth={2} aria-hidden />
          Gallery
        </button>
        {clip && !full && (
          <button
            type="button"
            onClick={() => {
              const c = clip;
              setClip(null);
              void addBlobs([c.blob]);
            }}
            className="order-photos-clip relative h-12 w-12 shrink-0 overflow-hidden rounded-[14px] bg-cover bg-center shadow-[0_0_0_2px_rgb(var(--color-gold)/0.75),0_6px_16px_rgb(var(--color-gold)/0.28)]"
            style={{ backgroundImage: `url(${clip.url})` }}
            aria-label="Add copied image"
          >
            <span className="absolute right-[3px] top-[3px] grid h-[18px] w-[18px] place-items-center rounded-full bg-gold text-[#0a0a0a] shadow-[0_1px_3px_rgb(0_0_0/0.35)]">
              <ClipboardPaste className="h-2.5 w-2.5" strokeWidth={2.4} aria-hidden />
            </span>
          </button>
        )}
      </div>

      {photos.length > 0 && (
        <ul className="mt-2.5 flex gap-2.5 overflow-x-auto pb-0.5 pt-1.5" aria-label="Attached photos">
          {photos.map((p) => (
            <li key={p.id} className="relative h-16 w-16 shrink-0">
              <button
                type="button"
                onClick={() => (p.status === "failed" ? startUpload(p) : setDetailId(p.id))}
                className="block h-full w-full overflow-hidden rounded-[14px] shadow-[inset_0_0_0_1px_var(--border-faint)]"
                aria-label={p.status === "failed" ? "Retry this photo" : "Photo note"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                {p.status === "uploading" && (
                  <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-black/45" role="progressbar" aria-valuenow={Math.round(p.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                    <span className="grid h-[30px] w-[30px] place-items-center rounded-full" style={{ background: `conic-gradient(rgb(var(--color-gold)) ${p.progress * 360}deg, rgb(255 255 255 / .3) 0)` }}>
                      <span className="block h-[22px] w-[22px] rounded-full bg-black/55" />
                    </span>
                  </span>
                )}
                {p.status === "failed" && (
                  <span className="absolute inset-0 grid place-items-center rounded-[14px] bg-[rgb(200_40_40/0.55)] text-white">
                    <RotateCcw className="h-5 w-5" strokeWidth={2.5} aria-hidden />
                  </span>
                )}
                {p.status !== "uploading" && p.status !== "failed" && (
                  <span className={`absolute bottom-1 left-1 grid h-[20px] w-[20px] place-items-center rounded-full shadow-[0_1px_3px_rgb(0_0_0/0.35)] ${p.note.trim() || p.itemIndex != null ? "bg-gold text-[#0a0a0a]" : "bg-black/60 text-white"}`} aria-hidden>
                    <Pencil className="h-2.5 w-2.5" strokeWidth={2.5} />
                  </span>
                )}
              </button>
              <button
                type="button"
                onClick={() => remove(p.id)}
                className="absolute -right-1.5 -top-1.5 grid h-[22px] w-[22px] place-items-center rounded-full border-2 border-[rgb(var(--surface-card))] bg-[#0a0a0a] text-white"
                aria-label="Remove photo"
              >
                <X className="h-3 w-3" strokeWidth={3} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {failed.length > 0 && (
        <button type="button" onClick={() => failed.forEach(startUpload)} className="mt-2 flex h-8 items-center gap-1.5 rounded-full bg-danger/10 px-3 text-xs font-bold text-danger" role="alert">
          <CircleAlert className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          Retry
          <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />
        </button>
      )}

      {message && <p className="mt-1.5 text-xs font-semibold text-danger" role="status">{message}</p>}

      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void addBlobs(files);
        }}
        data-testid="photo-camera-input"
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length) void addBlobs(files);
        }}
        data-testid="photo-gallery-input"
      />

      {detail && (
        <PhotoSheet label="Photo details" onClose={() => setDetailId(null)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={detail.url} alt="" className="mb-1 mt-3 h-[250px] w-full rounded-[22px] object-cover" />
            <label className="mx-0.5 mb-1.5 mt-3 block text-[13px] font-semibold text-ink-500" htmlFor="photo-note">
              Note for your rider <span className="font-normal">(optional)</span>
            </label>
            <input
              id="photo-note"
              value={detail.note}
              maxLength={NOTE_MAX}
              onChange={(e) => update(detail.id, { note: e.target.value.slice(0, NOTE_MAX) })}
              placeholder="e.g. Same brand, the 5 kg bag"
              className="h-[50px] w-full rounded-[14px] border border-[var(--border-faint)] px-3.5 text-[15px] text-ink outline-none focus:border-gold"
            />
            {linkable && (
              <>
                <p className="mx-0.5 mb-1.5 mt-3 text-[13px] font-semibold text-ink-500">Which item is this?</p>
                <div className="flex flex-wrap gap-2">
                  {[...linkable.map((name, i) => ({ name, i: i as number | null })), { name: "None", i: null }].map(({ name, i }) => {
                    const on = detail.itemIndex === i;
                    return (
                      <button
                        key={`${name}-${i}`}
                        type="button"
                        onClick={() => update(detail.id, { itemIndex: i })}
                        aria-pressed={on}
                        className={`flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] ${on ? "bg-gold font-extrabold text-ink-gold" : "border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] font-semibold text-ink"}`}
                      >
                        {on && <Check className="h-3.5 w-3.5" strokeWidth={2.5} aria-hidden />}
                        {name}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <div className="mt-4 flex gap-2.5">
              <button type="button" onClick={() => remove(detail.id)} className="flex h-[54px] w-[120px] items-center justify-center gap-1.5 rounded-[18px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-sm font-bold text-danger">
                <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
                Remove
              </button>
              <button type="button" onClick={() => setDetailId(null)} className="flex h-[54px] flex-1 items-center justify-center gap-2 rounded-[18px] bg-gold text-base font-extrabold text-ink-gold">
                <Check className="h-[18px] w-[18px]" strokeWidth={2.5} aria-hidden />
                Done
              </button>
            </div>
        </PhotoSheet>
      )}
    </div>
  );
}

/** Waits for in-flight uploads, then returns what to attach (uploaded photos only), with item links mapped by `mapIndex`. */
export async function settledPhotos(get: () => PhotoDraft[], mapIndex: (i: number) => number | null = (i) => i, timeoutMs = 20000) {
  const start = Date.now();
  while (get().some((p) => p.status === "uploading") && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 250));
  }
  return get()
    .filter((p) => p.status === "done" && p.key)
    .map((p) => {
      const itemIndex = p.itemIndex != null ? mapIndex(p.itemIndex) : null;
      return { key: p.key!, note: p.note.trim() || undefined, itemIndex: itemIndex ?? undefined };
    });
}
