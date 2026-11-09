"use client";

import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CAMERA_HINTS, cameraFailure } from "../../lib/buy-camera";
import { prefersReducedMotion } from "../../lib/buy-motion";

/** In-app lens for photo search. Opens from the tapped button and never invents a match. */
export function BuyCamera({ origin, note, onClose, onCapture, onPickFile }: {
  origin: { x: number; y: number };
  note: string | null;
  onClose: () => void;
  onCapture: (file: File) => void;
  onPickFile: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<"starting" | "live" | "denied" | "missing" | "unavailable">(() => (
    typeof navigator !== "undefined" && !navigator.mediaDevices?.getUserMedia ? "unavailable" : "starting"
  ));
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (phase === "unavailable") return;
    let cancelled = false;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false }).then((stream) => {
      if (cancelled) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) videoRef.current.srcObject = stream;
      setPhase("live");
    }).catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : "";
      setPhase(cameraFailure(name));
    });
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  function close() {
    if (prefersReducedMotion()) {
      onClose();
      return;
    }
    setClosing(true);
    window.setTimeout(onClose, 240);
  }

  async function shutter() {
    const video = videoRef.current;
    if (!video || phase !== "live") return;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;
    canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return;
    onCapture(new File([blob], "photo.jpg", { type: "image/jpeg" }));
  }

  if (typeof document === "undefined") return null;
  const problem = phase === "denied"
    ? "Camera permission is off. You can choose a photo instead."
    : phase === "missing"
      ? "No camera was found. You can choose a photo instead."
      : phase === "unavailable"
        ? "This browser cannot open the camera. You can choose a photo instead."
        : null;

  return createPortal(
    <div
      className={`buy-lens${closing ? " is-closing" : ""}`}
      style={{ transformOrigin: `${origin.x}px ${origin.y}px` }}
      role="dialog"
      aria-modal="true"
      aria-label="Search by photo"
    >
      <video ref={(node) => { videoRef.current = node; if (node && streamRef.current) node.srcObject = streamRef.current; }} className="buy-lens__video" autoPlay playsInline muted />
      <div className="buy-lens__top">
        <button type="button" className="buy-lens__close" aria-label="Close camera" onClick={close}><X className="h-5 w-5" aria-hidden /></button>
        <p className="buy-lens__title">Search by photo</p>
      </div>
      {problem && (
        <div className="buy-lens__fallback">
          <p>{problem}</p>
          <button type="button" className="buy-lens__file" onClick={onPickFile}>Choose a photo</button>
        </div>
      )}
      {phase === "starting" && <p className="buy-lens__wait">Starting the camera…</p>}
      <div className="buy-lens__cards">
        {CAMERA_HINTS.map((hint, index) => (
          <p key={hint.id} className="buy-lens__card" style={{ animationDelay: `${index * 60}ms` }}>
            <b>{hint.title}</b>
            <span>{hint.body}</span>
          </p>
        ))}
      </div>
      {note && <p className="buy-lens__note" role="status">{note}</p>}
      <button type="button" className="buy-lens__shutter" onClick={() => void shutter()} disabled={phase !== "live"}>
        <Camera className="h-5 w-5" aria-hidden />
        Take photo
      </button>
    </div>,
    document.body,
  );
}
