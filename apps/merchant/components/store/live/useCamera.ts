"use client";
// Same as apps/customer/components/live/useCamera.ts (the creator live pipeline). Keep the two in step.

import { useCallback, useEffect, useRef, useState } from "react";

export type Facing = "user" | "environment";

const VIDEO = (facing: Facing): MediaTrackConstraints => ({ facingMode: facing, width: { ideal: 720 }, height: { ideal: 1280 }, frameRate: { ideal: 30, max: 30 } });

/** The phone's camera and microphone, with a flip button and a mute button. Everything is released when the screen closes. */
export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [facing, setFacing] = useState<Facing>("user");
  const [micOn, setMicOn] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setStream(null);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("This phone or browser cannot use the camera here. Open Peebee in Chrome or Safari and try again.");
      return null;
    }
    try {
      stop();
      const s = await navigator.mediaDevices.getUserMedia({ video: VIDEO(facing), audio: { echoCancellation: true, noiseSuppression: true } });
      streamRef.current = s;
      setStream(s);
      setMicOn(true);
      return s;
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setError(name === "NotAllowedError" || name === "SecurityError"
        ? "Peebee needs your camera and microphone. Allow them in your browser's settings, then try again."
        : name === "NotFoundError" ? "No camera was found on this phone." : "The camera could not start. Close other apps using it and try again.");
      return null;
    }
  }, [facing, stop]);

  /** Swaps front and back cameras without stopping the stream: the new video track replaces the old one. */
  const flip = useCallback(async (onNewTrack?: (track: MediaStreamTrack) => Promise<void> | void) => {
    const next: Facing = facing === "user" ? "environment" : "user";
    try {
      const fresh = await navigator.mediaDevices.getUserMedia({ video: VIDEO(next) });
      const track = fresh.getVideoTracks()[0]!;
      const current = streamRef.current;
      if (current) {
        current.getVideoTracks().forEach((t) => { current.removeTrack(t); t.stop(); });
        current.addTrack(track);
        setStream(new MediaStream(current.getTracks()));
      }
      setFacing(next);
      await onNewTrack?.(track);
    } catch {
      setError("Could not switch cameras.");
    }
  }, [facing]);

  const toggleMic = useCallback(() => {
    const track = streamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  useEffect(() => () => { streamRef.current?.getTracks().forEach((t) => t.stop()); }, []);

  return { stream, facing, micOn, error, start, stop, flip, toggleMic, rawStream: streamRef };
}
