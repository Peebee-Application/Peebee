"use client";

import { Camera, User } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth } from "../lib/auth-context";
import { compressImage } from "../lib/image-compress";

const MAX_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * The customer's own photo — the same trust signal a rider's photo already
 * gives customers, the other way round: once a rider is matched, they see
 * who they're delivering to. Tapping the avatar replaces it; there's no
 * separate "edit" mode since a photo either exists or it doesn't.
 */
export function ProfilePhoto({ size = "md", initials }: { size?: "md" | "lg"; initials?: string } = {}) {
  const { user, updateUser } = useAuth();
  const large = size === "lg";
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!user?.id || !user.hasProfilePhoto) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- clear a stale object URL when the photo is removed
      setPhotoUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .userPhotoBlob(user.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user]);

  async function onPick(file: File) {
    setError(null);
    if (!ALLOWED_MIME.has(file.type)) {
      setError("Use a JPEG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("That photo is too large (max 4MB).");
      return;
    }
    setBusy(true);
    try {
      const compressed = await compressImage(file, { maxDimension: 640 });
      await api.uploadUserProfilePhoto(compressed);
      if (user) updateUser({ ...user, hasProfilePhoto: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <span className="relative shrink-0">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void onPick(file);
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label={photoUrl ? "Change profile photo" : "Add profile photo"}
        className={`flex items-center justify-center overflow-hidden rounded-full disabled:opacity-60 ${large ? "h-20 w-20 bg-gold text-[28px] font-extrabold text-[#111]" : "h-12 w-12 bg-gold/15 text-gold"}`}
      >
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" className="h-full w-full object-cover" />
        ) : initials ? (
          <span aria-hidden>{initials}</span>
        ) : (
          <User className={large ? "h-8 w-8" : "h-6 w-6"} strokeWidth={1.75} aria-hidden />
        )}
      </button>
      <span className={`absolute flex items-center justify-center rounded-full bg-ink text-white ring-2 ring-[rgb(var(--surface-card))] ${large ? "-bottom-0.5 -right-0.5 h-7 w-7" : "-bottom-0.5 -right-0.5 h-5 w-5"}`}>
        <Camera className={large ? "h-3.5 w-3.5" : "h-2.5 w-2.5"} strokeWidth={2.5} aria-hidden />
      </span>
      {error && <span className="absolute left-0 top-14 w-40 text-xs text-red-600">{error}</span>}
    </span>
  );
}
