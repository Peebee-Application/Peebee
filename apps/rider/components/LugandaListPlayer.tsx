"use client";

import { Loader2, Pause, Volume2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { api } from "../lib/api";

type Status = "idle" | "loading" | "playing" | "error";

/** Reads the order's shopping list aloud in Luganda — same idle/loading/
 * playing/error shape as VoiceNotePlayer.tsx, plus a shortcut straight into
 * account settings for a rider who wants a different voice. */
export function LugandaListPlayer({ orderId }: { orderId: string }) {
  const [status, setStatus] = useState<Status>("idle");
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  async function toggle() {
    if (status === "playing") {
      audioRef.current?.pause();
      setStatus("idle");
      return;
    }
    if (urlRef.current && audioRef.current) {
      audioRef.current.play().catch(() => {});
      setStatus("playing");
      return;
    }
    setStatus("loading");
    try {
      const blob = await api.orderListAudioBlob(orderId);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => setStatus("idle");
      audioRef.current = audio;
      await audio.play();
      setStatus("playing");
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={toggle}
        disabled={status === "loading"}
        className="flex items-center gap-2 rounded-full border border-gold bg-gold/10 px-4 py-2 text-sm font-bold text-ink disabled:opacity-60"
      >
        {status === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2.25} aria-hidden />
        ) : status === "playing" ? (
          <Pause className="h-4 w-4" strokeWidth={2.25} aria-hidden />
        ) : (
          <Volume2 className="h-4 w-4 text-gold" strokeWidth={2.25} aria-hidden />
        )}
        {status === "error" ? "Couldn't load Luganda audio" : status === "playing" ? "Playing…" : "Listen in Luganda"}
      </button>
      <Link href="/account#luganda-voice" className="text-xs font-semibold text-ink-500 underline">
        Change voice
      </Link>
    </div>
  );
}
