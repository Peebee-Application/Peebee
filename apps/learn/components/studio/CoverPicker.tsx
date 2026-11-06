"use client";

import { LearnThumb } from "@peebee/shared/learn-thumb";
import { ImagePlus, Undo2 } from "lucide-react";
import { useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { Button, Notice } from "../ui";

/**
 * The picture learners see for a school or course. It is drawn automatically; the educator can replace it with their
 * own JPEG, PNG or WebP picture and go back to the drawn one at any time.
 */
export function CoverPicker({
  kind,
  id,
  maxMb,
  disabled,
  published = true,
  className = "",
}: {
  kind: "school" | "course";
  id: string;
  /** The admin limit for a cover picture. 0 means uploads are switched off. */
  maxMb: number;
  disabled?: boolean;
  /** Draft courses show a plain picture to the public, so say so instead of looking like the upload failed. */
  published?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [custom, setCustom] = useState(false);

  async function run(action: () => Promise<unknown>, becomesCustom: boolean) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setCustom(becomesCustom);
      setVersion((v) => v + 1);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function choose(file: File | undefined) {
    if (input.current) input.current.value = "";
    if (!file) return;
    if (file.size > maxMb * 1024 * 1024) {
      setError(`That picture is ${(file.size / 1024 / 1024).toFixed(1)} MB. Pictures can be up to ${maxMb} MB.`);
      return;
    }
    void run(() => api.studioSetCover(kind, id, file), true);
  }

  const src = `${api.learnArtUrl(kind, id)}${version ? `?v=${version}` : ""}`;
  return (
    <div className={`space-y-2 ${className}`}>
      <LearnThumb key={version} src={src} className="max-w-md rounded-xl" />
      {maxMb > 0 && !disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a cover picture" onChange={(e) => choose(e.target.files?.[0])} />
          <Button variant="secondary" disabled={busy} onClick={() => input.current?.click()}>
            <ImagePlus className="h-4 w-4" aria-hidden /> {busy ? "Saving…" : "Change picture"}
          </Button>
          {custom && (
            <Button variant="secondary" disabled={busy} onClick={() => void run(() => api.studioRemoveCover(kind, id), false)}>
              <Undo2 className="h-4 w-4" aria-hidden /> Use the drawn picture
            </Button>
          )}
          <p className="text-base text-ink-500">JPEG, PNG or WebP, up to {maxMb} MB. A picture is drawn for you if you don&apos;t add one.</p>
        </div>
      )}
      {!published && <p className="text-base text-ink-500">Learners see this picture once the course is published.</p>}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
