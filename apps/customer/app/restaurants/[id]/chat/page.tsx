"use client";

import type { RestaurantChatMessage } from "@tuma/shared";
import { ArrowLeft, Camera, Mic, Pause, Phone, PhoneMissed, PhoneOff, Play, Send, Square, Store, Trash2 } from "lucide-react";
import { PhotoProvider, PhotoView } from "react-photo-view";
import "react-photo-view/dist/react-photo-view.css";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../../../lib/api";
import { useCalls } from "../../../../lib/calls-context";
import { compressImage } from "../../../../lib/image-compress";
import { useLivePolling } from "../../../../lib/use-live-polling";
import { useVoiceNoteMaxSeconds } from "../../../../lib/useVoiceNoteMaxSeconds";

function formatTime(iso: string): string {
  const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** WhatsApp-style call-log entry — centered, not attributed to either
 * side of the conversation, unlike every other bubble type. `mine`
 * reflects who placed the call, which only changes the icon's
 * direction, not the layout. */
function CallLogEntry({ message, mine }: { message: RestaurantChatMessage; mine: boolean }) {
  const missedOrDeclined = message.call_status === "missed" || message.call_status === "declined";
  const Icon = message.call_status === "missed" ? PhoneMissed : message.call_status === "declined" ? PhoneOff : Phone;
  return (
    <div className="flex justify-center py-1">
      <div
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium ${
          missedOrDeclined ? "bg-red-500/10 text-red-600" : "bg-[rgb(var(--surface-muted))] text-ink-500"
        }`}
      >
        <Icon className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
        <span>{mine && message.call_status === "missed" ? "No answer" : message.body}</span>
        <span className="text-ink-500/60">· {formatTime(message.created_at)}</span>
      </div>
    </div>
  );
}

/** m:ss, for a recording's running length or a preview's fixed one. */
function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function ImageBubble({ messageId }: { messageId: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .restaurantChatMediaBlob(messageId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [messageId]);

  if (!url) return <div className="h-40 w-48 animate-pulse rounded-2xl bg-[rgb(var(--surface-muted))]" />;
  return (
    <PhotoView src={url}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Photo" className="max-h-64 w-full max-w-[220px] cursor-zoom-in rounded-2xl object-cover" />
    </PhotoView>
  );
}

function VoiceBubble({ messageId }: { messageId: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "playing">("idle");
  const [error, setError] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

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
    setError(false);
    try {
      const blob = await api.restaurantChatMediaBlob(messageId);
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      const audio = new Audio(url);
      audio.onended = () => setStatus("idle");
      audio.onerror = () => {
        setStatus("idle");
        setError(true);
      };
      audioRef.current = audio;
      await audio.play();
      setStatus("playing");
    } catch {
      setStatus("idle");
      setError(true);
    }
  }

  return (
    <button type="button" onClick={toggle} className="flex items-center gap-2 py-0.5 pr-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green text-white">
        {status === "playing" ? (
          <Pause className="h-4 w-4" strokeWidth={2} aria-hidden />
        ) : (
          <Play className="h-4 w-4" strokeWidth={2} aria-hidden />
        )}
      </span>
      <span className="text-[13px]">
        {status === "loading" ? "Loading…" : error ? "Couldn't play — tap to retry" : "Voice message"}
      </span>
    </button>
  );
}

export default function RestaurantChatPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const maxRecordSeconds = useVoiceNoteMaxSeconds();

  const { startCall } = useCalls();
  const [restaurantName, setRestaurantName] = useState<string | null>(null);
  const [restaurantOwnerId, setRestaurantOwnerId] = useState<string | null>(null);
  const [messages, setMessages] = useState<RestaurantChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; duration: number } | null>(null);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Arriving from "Ask about this item" on a menu item — attaches that item
  // to the first message sent, so the restaurant knows exactly what a
  // free-form "is this spicy?" is about.
  const menuItemId = searchParams.get("item");
  const menuItemName = searchParams.get("itemName");

  const load = useCallback(async () => {
    const res = await api.getRestaurantChat(id);
    setRestaurantName(res.restaurantName);
    setRestaurantOwnerId(res.restaurantOwnerId);
    setMessages(res.messages);
    return res;
  }, [id]);

  useLivePolling(() => void load().catch(() => {}), 4000, [load]);

  useEffect(() => {
    api.markRestaurantChatRead(id).catch(() => {});
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  useEffect(() => {
    return () => {
      if (recordTimerRef.current) clearInterval(recordTimerRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      if (preview) URL.revokeObjectURL(preview.url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Nobody's meant to record minutes of audio here — auto-stop (not just
  // warn) once the admin-set cap is hit.
  useEffect(() => {
    if (recording && recordSeconds >= maxRecordSeconds) stopRecording();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, recordSeconds, maxRecordSeconds]);

  async function sendText(e: React.FormEvent) {
    e.preventDefault();
    const body = draft.trim();
    if (!body) return;
    setSending(true);
    setError(null);
    try {
      await api.sendRestaurantChat(id, body, menuItemId && menuItemName ? { id: menuItemId, name: menuItemName } : undefined);
      setDraft("");
      if (menuItemId) router.replace(`/restaurants/${id}/chat`);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function pickPhoto(file: File) {
    setSending(true);
    setError(null);
    try {
      const compressed = await compressImage(file);
      await api.sendRestaurantChatMedia(id, "image", compressed);
      await load();
    } catch {
      setError("Couldn't send that photo. Please try again.");
    } finally {
      setSending(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  async function startRecording() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        setPreview({ blob, url: URL.createObjectURL(blob), duration: recordSeconds });
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setRecording(true);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    } catch {
      setError("Couldn't access the microphone — check your browser's permission for this site.");
    }
  }

  function stopRecording() {
    if (recordTimerRef.current) clearInterval(recordTimerRef.current);
    setRecording(false);
    mediaRecorderRef.current?.stop();
  }

  function discardPreview() {
    previewAudioRef.current?.pause();
    previewAudioRef.current = null;
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPreviewPlaying(false);
  }

  function togglePreviewPlayback() {
    if (!preview) return;
    if (previewPlaying) {
      previewAudioRef.current?.pause();
      setPreviewPlaying(false);
      return;
    }
    if (!previewAudioRef.current) {
      const audio = new Audio(preview.url);
      audio.onended = () => setPreviewPlaying(false);
      previewAudioRef.current = audio;
    }
    previewAudioRef.current.currentTime = 0;
    previewAudioRef.current.play().catch(() => {});
    setPreviewPlaying(true);
  }

  async function sendPreview() {
    if (!preview) return;
    const { blob, url } = preview;
    setSending(true);
    setError(null);
    try {
      await api.sendRestaurantChatMedia(id, "voice", blob);
      await load();
      previewAudioRef.current?.pause();
      previewAudioRef.current = null;
      URL.revokeObjectURL(url);
      setPreview(null);
      setPreviewPlaying(false);
    } catch {
      setError("Couldn't send that voice message. Please try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    // Fixed to the true viewport edges rather than a dvh/JS height calc —
    // those drift from the real visible viewport on some mobile browsers
    // (address-bar show/hide, embedded WebViews), which let the page
    // itself scroll and dragged this "sticky" header/composer away with
    // it. `fixed` can't be scrolled away by an ancestor no matter what.
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-cream pt-[env(safe-area-inset-top)]">
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2.5">
          <Link
            href={`/restaurants/${id}`}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" strokeWidth={2} aria-hidden />
          </Link>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
            <Store className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
          </span>
          <h1 className="min-w-0 flex-1 truncate text-base font-bold text-ink">{restaurantName ?? "Chat"}</h1>
          {restaurantOwnerId && (
            <button
              type="button"
              onClick={() => startCall({ calleeId: restaurantOwnerId, restaurantId: id })}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green/15 text-green"
              aria-label="Call"
            >
              <Phone className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
            </button>
          )}
        </header>

        <PhotoProvider>
          <div className="tuma-chat-bg min-h-0 flex-1">
          <div className="h-full space-y-3 overflow-y-auto px-4 py-4">
            {messages.length === 0 && (
              <p className="py-8 text-center text-xs text-ink-500">
                No messages yet — ask about opening hours, an item, or anything else.
              </p>
            )}
            {messages.map((m) => {
              const mine = m.sender_role === "customer";
              if (m.type === "call") {
                return <CallLogEntry key={m.id} message={m} mine={mine} />;
              }
              return (
                <div key={m.id} className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`flex max-w-[75%] flex-col ${mine ? "items-end" : "items-start"}`}>
                    {m.menu_item_name && (
                      <span className="mb-1 rounded-full bg-[rgb(var(--surface-muted))] px-2.5 py-1 text-xs font-semibold text-ink-500">
                        Re: {m.menu_item_name}
                      </span>
                    )}
                    <div
                      className={`text-[14px] leading-snug shadow-sm ${m.type === "text" ? "px-4 py-2.5" : "p-1.5"} ${
                        mine
                          ? "rounded-[20px] rounded-br-md bg-gold text-[#0A0A0A]"
                          : "rounded-[20px] rounded-bl-md bg-[rgb(var(--surface-card))] text-ink"
                      }`}
                    >
                      {m.type === "image" && <ImageBubble messageId={m.id} />}
                      {m.type === "voice" && <VoiceBubble messageId={m.id} />}
                      {m.type === "text" && m.body}
                    </div>
                    <span className="mt-1 px-1 text-[10px] text-ink-500/70">{formatTime(m.created_at)}</span>
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          </div>
        </PhotoProvider>

        {menuItemName && (
          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-[var(--border-faint)] bg-gold/10 px-3 py-2">
            <span className="truncate text-xs font-semibold text-ink">Asking about: {menuItemName}</span>
            <button
              type="button"
              onClick={() => router.replace(`/restaurants/${id}/chat`)}
              className="shrink-0 text-xs font-bold text-ink-500"
            >
              Clear
            </button>
          </div>
        )}

        <div className="shrink-0 border-t border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2.5">
          <div className="space-y-1.5">
            {error && <p className="px-1 text-xs text-red-600">{error}</p>}
            <form onSubmit={sendText} className="flex items-center gap-2">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void pickPhoto(file);
                }}
              />

              {preview ? (
                <div className="flex h-[46px] flex-1 items-center gap-2 rounded-full bg-[rgb(var(--surface-muted))] pl-2 pr-4">
                  <button
                    type="button"
                    onClick={discardPreview}
                    aria-label="Discard recording"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-500"
                  >
                    <Trash2 className="h-4.5 w-4.5" strokeWidth={2} aria-hidden />
                  </button>
                  <button
                    type="button"
                    onClick={togglePreviewPlayback}
                    aria-label={previewPlaying ? "Pause" : "Play back recording"}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-[#0A0A0A]"
                  >
                    {previewPlaying ? (
                      <Pause className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                    ) : (
                      <Play className="h-4 w-4" strokeWidth={2.25} aria-hidden />
                    )}
                  </button>
                  <span className="flex-1 text-sm text-ink">{formatDuration(preview.duration)}</span>
                </div>
              ) : (
                <div className="relative min-w-0 flex-1">
                  {recording ? (
                    <div className="flex h-[46px] items-center gap-2 rounded-full bg-[rgb(var(--surface-muted))] pl-4 pr-2">
                      <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-red-500" />
                      <span className="flex-1 text-sm text-ink">
                        Recording… {formatDuration(recordSeconds)} / {formatDuration(maxRecordSeconds)}
                      </span>
                    </div>
                  ) : (
                    <input
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={menuItemName ? `Ask about ${menuItemName}…` : "Message…"}
                      className="w-full rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] py-3.5 pl-4 pr-4 text-sm text-ink outline-none placeholder:text-ink-500 focus:border-gold"
                    />
                  )}
                </div>
              )}

              {!preview && (
                <button
                  type="button"
                  onClick={() => photoInputRef.current?.click()}
                  disabled={sending || recording}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-500 disabled:opacity-40"
                  aria-label="Send a photo"
                >
                  <Camera className="h-6 w-6" strokeWidth={1.75} aria-hidden />
                </button>
              )}

              {preview ? (
                <button
                  type="button"
                  onClick={sendPreview}
                  disabled={sending}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-[#0A0A0A] shadow-[0_4px_12px_rgba(201,162,39,0.35)] transition-opacity disabled:opacity-40"
                  aria-label="Send voice message"
                >
                  <Send className="h-5 w-5" strokeWidth={2.25} />
                </button>
              ) : recording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-600 text-white"
                  aria-label="Stop recording"
                >
                  <Square className="h-4 w-4" strokeWidth={2.5} aria-hidden />
                </button>
              ) : draft.trim() ? (
                <button
                  type="submit"
                  disabled={sending}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-[#0A0A0A] shadow-[0_4px_12px_rgba(201,162,39,0.35)] transition-opacity disabled:opacity-40"
                  aria-label="Send message"
                >
                  <Send className="h-5 w-5" strokeWidth={2.25} />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={sending}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gold text-[#0A0A0A] shadow-[0_4px_12px_rgba(201,162,39,0.35)] disabled:opacity-40"
                  aria-label="Record a voice message"
                >
                  <Mic className="h-5 w-5" strokeWidth={2.25} />
                </button>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
