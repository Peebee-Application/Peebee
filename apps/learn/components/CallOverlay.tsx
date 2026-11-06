"use client";

import { Phone, PhoneOff } from "lucide-react";
import { useEffect, useRef } from "react";
import { useCalls } from "../lib/calls-context";

/** Full-screen ringing/connected UI — mounted once in the root layout so a
 * call can be answered from anywhere in the app, not just a specific chat
 * thread. Renders nothing while idle. */
export function CallOverlay() {
  const { state, accept, decline, hangUp, remoteStream } = useCalls();
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current && remoteStream) audioRef.current.srcObject = remoteStream;
  }, [remoteStream]);

  if (state.phase === "idle" || state.phase === "ended") return null;

  const name =
    state.phase === "ringing_inbound"
      ? ((state.call as { caller_name?: string })?.caller_name ?? "Incoming call")
      : "Calling…";

  return (
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-between bg-ink px-6 py-12 text-white">
      <audio ref={audioRef} autoPlay playsInline className="hidden" />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <span className="flex h-20 w-20 items-center justify-center rounded-full bg-white/10">
          <Phone className="h-8 w-8" strokeWidth={1.75} aria-hidden />
        </span>
        <p className="text-xl font-bold">{name}</p>
        <p className="text-sm text-white/60">
          {state.phase === "ringing_inbound" && "Incoming call"}
          {state.phase === "ringing_outbound" && "Ringing…"}
          {state.phase === "connecting" && "Connecting…"}
          {state.phase === "connected" && "Connected"}
          {state.phase === "failed" && (state.error ?? "Call failed")}
        </p>
      </div>

      <div className="flex items-center gap-6 pb-4">
        {state.phase === "ringing_inbound" ? (
          <>
            <button
              onClick={decline}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600"
              aria-label="Decline"
            >
              <PhoneOff className="h-6 w-6" strokeWidth={2} aria-hidden />
            </button>
            <button
              onClick={accept}
              className="flex h-16 w-16 items-center justify-center rounded-full bg-green"
              aria-label="Accept"
            >
              <Phone className="h-6 w-6" strokeWidth={2} aria-hidden />
            </button>
          </>
        ) : (
          <button
            onClick={hangUp}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-red-600"
            aria-label="End call"
          >
            <PhoneOff className="h-6 w-6" strokeWidth={2} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
