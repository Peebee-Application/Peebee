"use client";

import { CircleCheck, List, Lock, Mic, MicOff, Pause, Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useVoiceNoteMaxSeconds } from "../../lib/useVoiceNoteMaxSeconds";

type Status = "idle" | "recording" | "recorded" | "blocked" | "unavailable" | "unsupported";

/** Bars drawn in the live meter and the saved waveform. */
const BAR_COUNT = 40;
/** How often a new live bar is pushed in, i.e. how fast the meter rolls. */
const BAR_MS = 90;
const BAR_MS_REDUCED = 250;

/** Waveform + length captured while recording, kept per Blob so the card can be
 * unmounted and remounted (step changes) and still draw the same waveform. */
const recordings = new WeakMap<Blob, { levels: number[]; seconds: number }>();

type AudioContextCtor = typeof AudioContext;
function audioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ?? null;
}

function canRecord() {
  return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
}

const noSubscribe = () => () => {};

function prefersReducedMotion() {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

function clock(total: number) {
  const s = Math.max(0, Math.round(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Squeezes any number of captured levels into BAR_COUNT bars (peak per
 * bucket), scaled so the loudest bar fills the height. */
function toWaveform(levels: number[]): number[] {
  if (levels.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < BAR_COUNT; i++) {
    const start = Math.floor((i * levels.length) / BAR_COUNT);
    const end = Math.max(start + 1, Math.floor(((i + 1) * levels.length) / BAR_COUNT));
    let peak = 0;
    for (let j = start; j < end && j < levels.length; j++) peak = Math.max(peak, levels[j]);
    out.push(peak);
  }
  const max = Math.max(...out);
  return out.map((v) => (max > 0 ? Math.max(0.08, v / max) : 0.08));
}

/** Fallback for a Blob recorded before this card mounted (no captured levels):
 * decode the audio itself and take the peaks. */
async function decodeWaveform(blob: Blob): Promise<{ levels: number[]; seconds: number } | null> {
  const Ctor = audioContextCtor();
  if (!Ctor) return null;
  const ctx = new Ctor();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    const data = buffer.getChannelData(0);
    const levels: number[] = [];
    const step = Math.max(1, Math.floor(data.length / (BAR_COUNT * 4)));
    for (let i = 0; i < data.length; i += step) {
      let peak = 0;
      for (let j = i; j < i + step && j < data.length; j++) peak = Math.max(peak, Math.abs(data[j]));
      levels.push(peak);
    }
    return { levels, seconds: buffer.duration };
  } catch {
    return null;
  } finally {
    ctx.close().catch(() => {});
  }
}

/** Records a short voice note and hands the raw audio Blob up to the parent
 * — this is NOT transcribed or turned into list items. It's meant to be
 * played back as-is by whoever picks up the order: spoken context a typed
 * list can miss (units, brand, exactly where in the shop to find it).
 *
 * While recording, the microphone stream is also fed to a Web Audio
 * AnalyserNode so the bars follow the customer's real voice; those levels
 * become the waveform shown for playback. If Web Audio isn't available the
 * recording itself still works, just without moving bars. */
export function OrderVoiceNoteRecorder({
  blob,
  onChange,
  onWriteInstead,
}: {
  blob: Blob | null;
  onChange: (blob: Blob | null) => void;
  /** Offered on the mic-blocked card when the screen has a typed alternative. */
  onWriteInstead?: () => void;
}) {
  const [status, setStatus] = useState<Status>(blob ? "recorded" : "idle");
  const [seconds, setSeconds] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [live, setLive] = useState<number[]>([]);
  const [saved, setSaved] = useState<{ levels: number[]; seconds: number } | null>(() => (blob ? recordings.get(blob) ?? null : null));
  const maxSeconds = useVoiceNoteMaxSeconds();
  const supported = useSyncExternalStore(noSubscribe, canRecord, () => true);
  const view: Status = status === "idle" && !supported ? "unsupported" : status;

  // A fresh recording (or a cleared one) resets playback and swaps the waveform.
  const [shownBlob, setShownBlob] = useState(blob);
  if (blob !== shownBlob) {
    setShownBlob(blob);
    setPlaying(false);
    setProgress(0);
    setSaved(blob ? recordings.get(blob) ?? null : null);
  }

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioUrlRef = useRef<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const secondsRef = useRef(0);
  // Level capture
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelsRef = useRef<number[]>([]);
  const meterRafRef = useRef<number | null>(null);
  const playRafRef = useRef<number | null>(null);

  function stopMeter() {
    if (meterRafRef.current !== null) cancelAnimationFrame(meterRafRef.current);
    meterRafRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  function stopPlayLoop() {
    if (playRafRef.current !== null) cancelAnimationFrame(playRafRef.current);
    playRafRef.current = null;
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      audioRef.current?.pause();
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      stopMeter();
      stopPlayLoop();
    };
  }, []);

  // A fresh recording invalidates whatever was playing from the last one.
  useEffect(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    stopPlayLoop();
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    if (!blob || recordings.has(blob)) return;
    let alive = true;
    decodeWaveform(blob).then((res) => {
      if (!alive || !res) return;
      recordings.set(blob, res);
      setSaved(res);
    });
    return () => {
      alive = false;
    };
  }, [blob]);

  // Nobody's meant to record minutes of audio here — auto-stop (not just
  // warn) once the admin-set cap is hit.
  useEffect(() => {
    if (status === "recording" && seconds >= maxSeconds) {
      stopRecording();
    }
  }, [seconds, status, maxSeconds]);

  /** Feeds the mic stream into an AnalyserNode and samples its loudness every
   * animation frame, pushing one bar per BAR_MS (the loudest moment in that
   * slot) so the meter rolls right-to-left like a chat app's. */
  function startMeter(stream: MediaStream) {
    levelsRef.current = [];
    setLive([]);
    const Ctor = audioContextCtor();
    if (!Ctor) return;
    try {
      const ctx = new Ctor();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = 0.6;
      ctx.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      const slot = prefersReducedMotion() ? BAR_MS_REDUCED : BAR_MS;
      let slotStart = performance.now();
      let peak = 0;
      const tick = (now: number) => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        // RMS, lifted so normal speech fills most of the height.
        const level = Math.min(1, Math.sqrt(Math.sqrt(sum / data.length)) * 1.6);
        peak = Math.max(peak, level);
        if (now - slotStart >= slot) {
          levelsRef.current.push(peak);
          setLive(levelsRef.current.slice(-BAR_COUNT));
          peak = 0;
          slotStart = now;
        }
        meterRafRef.current = requestAnimationFrame(tick);
      };
      meterRafRef.current = requestAnimationFrame(tick);
    } catch {
      // No Web Audio: record without the live bars.
      stopMeter();
    }
  }

  async function startRecording() {
    if (!canRecord()) {
      setStatus("unsupported");
      return;
    }
    cancelledRef.current = false;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { audioBitsPerSecond: 24000 });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopMeter();
        stream.getTracks().forEach((t) => t.stop());
        if (cancelledRef.current) {
          cancelledRef.current = false;
          setStatus("idle");
          return;
        }
        const recorded = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        const capture = { levels: levelsRef.current.slice(), seconds: secondsRef.current };
        if (capture.levels.length > 0) recordings.set(recorded, capture);
        onChange(recorded);
        setStatus("recorded");
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      startMeter(stream);
      setStatus("recording");
      setSeconds(0);
      secondsRef.current = 0;
      timerRef.current = setInterval(() => {
        secondsRef.current += 1;
        setSeconds(secondsRef.current);
      }, 1000);
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "blocked" : "unavailable");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    mediaRecorderRef.current?.stop();
  }

  function cancelRecording() {
    cancelledRef.current = true;
    stopRecording();
  }

  function playLoop() {
    const audio = audioRef.current;
    if (!audio) return;
    const length = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : saved?.seconds || 0;
    setProgress(length > 0 ? Math.min(1, audio.currentTime / length) : 0);
    playRafRef.current = requestAnimationFrame(playLoop);
  }

  // Toggles play/pause on a single reused <audio> instead of firing a new
  // one on every click — otherwise repeated taps stack up overlapping
  // playback instead of pausing and resuming the same clip.
  function togglePlayback() {
    if (!blob) return;
    if (playing) {
      audioRef.current?.pause();
      stopPlayLoop();
      setPlaying(false);
      return;
    }
    if (!audioRef.current) {
      audioUrlRef.current = URL.createObjectURL(blob);
      const audio = new Audio(audioUrlRef.current);
      audio.onended = () => {
        stopPlayLoop();
        setPlaying(false);
        setProgress(0);
      };
      audioRef.current = audio;
    }
    audioRef.current.play().catch(() => {});
    setPlaying(true);
    stopPlayLoop();
    playRafRef.current = requestAnimationFrame(playLoop);
  }

  function reset() {
    onChange(null);
    setStatus("idle");
    setSeconds(0);
  }

  function reRecord() {
    reset();
    void startRecording();
  }

  const waveform = saved ? toWaveform(saved.levels) : [];
  const totalSeconds = saved?.seconds ?? 0;
  const playedBars = Math.floor(progress * BAR_COUNT);
  const liveBars = [...Array(Math.max(0, BAR_COUNT - live.length)).fill(0), ...live];

  const header = (subtitle: string, chip?: ReactNode) => (
    <div className="flex items-center gap-2.5">
      <span className="grid h-[38px] w-[38px] shrink-0 place-items-center rounded-[13px] bg-gold/15 text-gold">
        <Mic className="h-[19px] w-[19px]" strokeWidth={2} aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-bold leading-tight text-ink">Voice note for your rider</span>
        <span className="block text-xs text-ink-500">{subtitle}</span>
      </span>
      {chip}
    </div>
  );

  const bigGold =
    "grid h-16 w-16 place-items-center rounded-full bg-gold text-ink-gold shadow-[0_0_0_8px_rgb(var(--color-gold)/0.16),0_8px_20px_rgb(var(--color-gold)/0.35)] transition active:scale-95";

  return (
    <div
      className="voice-note-card rounded-[22px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3.5 shadow-[var(--shadow-card)]"
      data-status={view}
    >
      {view === "idle" && (
        <>
          {header(`Optional · up to ${clock(maxSeconds)}`)}
          <div className="mb-1.5 mt-3.5 flex h-16 items-center gap-[3px] rounded-2xl bg-[rgb(var(--surface-muted)/0.6)] px-1" aria-hidden>
            {Array.from({ length: BAR_COUNT }, (_, i) => (
              <i key={i} className="h-1 min-w-[3px] flex-1 rounded-full bg-ink-500/35" />
            ))}
          </div>
          <div className="mt-2.5 flex flex-col items-center">
            <div className="grid h-20 place-items-center">
              <button type="button" onClick={startRecording} className={bigGold} aria-label="Tap to record a voice note">
                <Mic className="h-7 w-7" strokeWidth={2.25} aria-hidden />
              </button>
            </div>
            <span className="text-[11px] font-bold text-ink-500">Tap to record</span>
          </div>
        </>
      )}

      {status === "recording" && (
        <>
          {header(
            "Listening… speak normally",
            <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-danger/10 px-2.5 text-[11px] font-bold text-danger">
              <span className="h-2 w-2 rounded-full bg-danger shadow-[0_0_0_4px_rgb(var(--color-danger)/0.18)] motion-safe:animate-pulse" />
              REC
            </span>,
          )}
          <div
            className="voice-note-live mb-1.5 mt-3.5 flex h-16 items-center gap-[3px] rounded-2xl bg-gradient-to-r from-[rgb(var(--surface-muted)/0.6)] to-[rgb(var(--color-gold)/0.08)] px-1"
            role="img"
            aria-label="Live voice level"
          >
            {liveBars.map((v, i) => (
              <i
                key={i}
                className="min-w-[3px] flex-1 rounded-full bg-gold motion-safe:transition-[height] motion-safe:duration-75"
                style={{ height: `${Math.max(4, Math.round(v * 50))}px`, opacity: 0.35 + 0.65 * Math.pow(i / (BAR_COUNT - 1), 1.2) }}
              />
            ))}
          </div>
          <div className="flex justify-between px-0.5 text-xs tabular-nums text-ink-500" aria-live="polite">
            <span>
              <b className="font-bold text-ink">{clock(seconds)}</b> / {clock(maxSeconds)}
            </span>
            <span>Stops by itself at {clock(maxSeconds)}</span>
          </div>
          <div className="mx-0.5 mt-1.5 h-1 overflow-hidden rounded bg-[rgb(var(--surface-muted))]">
            <div className="h-full bg-gold" style={{ width: `${Math.min(100, (seconds / Math.max(1, maxSeconds)) * 100)}%` }} />
          </div>
          <div className="mt-2.5 flex items-start justify-center gap-[22px]">
            <div className="flex flex-col items-center">
              <div className="grid h-20 place-items-center">
                <button
                  type="button"
                  onClick={cancelRecording}
                  className="grid h-[46px] w-[46px] place-items-center rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-ink"
                  aria-label="Cancel recording"
                >
                  <X className="h-5 w-5" strokeWidth={2} aria-hidden />
                </button>
              </div>
              <span className="text-[11px] font-bold text-ink-500">Cancel</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="grid h-20 place-items-center">
                <button type="button" onClick={stopRecording} className={bigGold} aria-label="Stop recording">
                  <Square className="h-[22px] w-[22px]" strokeWidth={2.5} aria-hidden />
                </button>
              </div>
              <span className="text-[11px] font-bold text-ink-500">Stop</span>
            </div>
            <div className="invisible flex flex-col items-center" aria-hidden>
              <div className="grid h-20 place-items-center"><span className="block h-[46px] w-[46px]" /></div>
              <span className="text-[11px]">Cancel</span>
            </div>
          </div>
        </>
      )}

      {status === "recorded" && blob && (
        <>
          {header(
            "Your rider will hear this",
            <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-green/10 px-2.5 text-[11px] font-bold text-green">
              <CircleCheck className="h-[13px] w-[13px]" strokeWidth={2} aria-hidden />
              Attached
            </span>,
          )}
          <div className="mb-1 mt-3.5 flex items-center gap-3">
            <button
              type="button"
              onClick={togglePlayback}
              className="voice-note-play grid h-12 w-12 shrink-0 place-items-center rounded-full"
              aria-label={playing ? "Pause voice note" : "Play voice note"}
            >
              {playing ? <Pause className="h-[22px] w-[22px]" strokeWidth={2} aria-hidden /> : <Play className="h-[22px] w-[22px]" strokeWidth={2.25} aria-hidden />}
            </button>
            <div className="relative flex h-12 flex-1 items-center gap-[3px] rounded-2xl bg-[rgb(var(--surface-muted)/0.6)] px-1" role="img" aria-label="Voice note waveform">
              {(waveform.length ? waveform : Array<number>(BAR_COUNT).fill(0.08)).map((v, i) => (
                <i
                  key={i}
                  data-played={i < playedBars ? "" : undefined}
                  className={`min-w-[3px] flex-1 rounded-full ${i < playedBars ? "bg-gold" : "bg-ink/20"}`}
                  style={{ height: `${Math.max(4, Math.round(v * 38))}px` }}
                />
              ))}
              {(playing || progress > 0) && (
                <span
                  className="absolute bottom-2 top-2 w-0.5 rounded-sm bg-ink"
                  style={{ left: `calc(4px + ${progress} * (100% - 8px))` }}
                  aria-hidden
                />
              )}
            </div>
          </div>
          <div className="flex justify-between pl-[60px] pr-0.5 text-xs tabular-nums text-ink-500">
            <span>
              <b className="font-bold text-ink">{clock(progress * totalSeconds)}</b>
              {totalSeconds > 0 && ` / ${clock(totalSeconds)}`}
            </span>
            <span>{playing ? "Playing" : "Tap play to check it"}</span>
          </div>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={reRecord}
              className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-[13px] font-bold text-ink"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden />
              Re-record
            </button>
            <button
              type="button"
              onClick={reset}
              className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-[13px] font-bold text-danger"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden />
              Delete
            </button>
          </div>
        </>
      )}

      {(view === "blocked" || view === "unavailable" || view === "unsupported") && (
        <>
          {header(
            `Optional · up to ${clock(maxSeconds)}`,
            <span className="inline-flex h-6 shrink-0 items-center gap-1 rounded-full bg-[rgb(var(--surface-muted))] px-2.5 text-[11px] font-bold text-ink-500">
              <MicOff className="h-[13px] w-[13px]" strokeWidth={2} aria-hidden />
              {view === "unsupported" ? "Not supported" : "Blocked"}
            </span>,
          )}
          <div className="flex flex-col items-center px-1.5 pt-1.5 text-center" role="alert">
            <span className="mb-2.5 mt-2 grid h-[60px] w-[60px] place-items-center rounded-full bg-danger/10 text-danger">
              <MicOff className="h-7 w-7" strokeWidth={2} aria-hidden />
            </span>
            <b className="text-[15px] text-ink">
              {view === "unsupported" ? "This browser can't record voice notes" : view === "blocked" ? "Peebee can't use your microphone" : "Couldn't start your microphone"}
            </b>
            <span className="mt-0.5 text-[12.5px] text-ink-500">
              {view === "unsupported"
                ? "Try another browser, or write your list instead."
                : view === "blocked"
                  ? "Your browser blocked it, so we can't record."
                  : "Check that a microphone is connected and not in use, then try again."}
            </span>
            {view === "blocked" && (
              <ol className="mt-2.5 w-full space-y-1.5 rounded-[14px] bg-[rgb(var(--surface-muted))] px-3 py-2.5 text-left text-[12.5px] text-ink">
                <li className="flex items-center gap-2">
                  <b className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-gold text-[11px] text-ink-gold">1</b>
                  <span className="flex items-center gap-1">Tap <Lock className="h-[13px] w-[13px]" strokeWidth={2} aria-label="the lock" /> next to the web address</span>
                </li>
                <li className="flex items-center gap-2">
                  <b className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-gold text-[11px] text-ink-gold">2</b>
                  <span>Set Microphone to <b>Allow</b></span>
                </li>
                <li className="flex items-center gap-2">
                  <b className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-gold text-[11px] text-ink-gold">3</b>
                  <span>Come back and tap Try again</span>
                </li>
              </ol>
            )}
          </div>
          {(onWriteInstead || view !== "unsupported") && (
            <div className="mt-3 flex gap-2">
              {onWriteInstead && (
                <button
                  type="button"
                  onClick={onWriteInstead}
                  className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-[13px] font-bold text-ink"
                >
                  <List className="h-4 w-4" strokeWidth={2} aria-hidden />
                  Write list instead
                </button>
              )}
              {view !== "unsupported" && (
                <button
                  type="button"
                  onClick={startRecording}
                  className="flex h-[42px] flex-1 items-center justify-center gap-1.5 rounded-full bg-gold text-[13px] font-bold text-ink-gold"
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={2} aria-hidden />
                  Try again
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
