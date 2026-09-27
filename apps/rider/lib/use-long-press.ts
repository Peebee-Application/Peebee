"use client";

import { useCallback, useRef } from "react";

const LONG_PRESS_MS = 480;
const MOVE_CANCEL_PX = 10;

/**
 * Spread the returned handlers onto a message bubble's outer element to
 * open a context menu on a press-and-hold, without also triggering
 * whatever onClick already lives on the content inside it (tap-to-view an
 * image, tap-to-play a voice note). Suppression happens on the capture
 * phase — which runs before the inner element's own bubble-phase onClick
 * — so nothing inside needs to know a long-press handler exists at all.
 */
export function useLongPress(onLongPress: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firedRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const start = useCallback(
    (x: number, y: number) => {
      startRef.current = { x, y };
      clear();
      timerRef.current = setTimeout(() => {
        firedRef.current = true;
        navigator.vibrate?.(15);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    [clear, onLongPress],
  );

  const handleMove = useCallback(
    (x: number, y: number) => {
      const origin = startRef.current;
      if (!origin) return;
      if (Math.abs(x - origin.x) > MOVE_CANCEL_PX || Math.abs(y - origin.y) > MOVE_CANCEL_PX) clear();
    },
    [clear],
  );

  return {
    onMouseDown: (e: React.MouseEvent) => start(e.clientX, e.clientY),
    onMouseMove: (e: React.MouseEvent) => handleMove(e.clientX, e.clientY),
    onMouseUp: clear,
    onMouseLeave: clear,
    onTouchStart: (e: React.TouchEvent) => start(e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => handleMove(e.touches[0].clientX, e.touches[0].clientY),
    onTouchEnd: clear,
    onTouchCancel: clear,
    // Capture phase, not bubble — runs before the bubble's own inner
    // onClick (image viewer, voice play/pause), so a long-press can
    // swallow that click before it ever reaches its target.
    onClickCapture: (e: React.SyntheticEvent) => {
      if (firedRef.current) {
        e.preventDefault();
        e.stopPropagation();
        firedRef.current = false;
      }
    },
    // Suppresses the browser/OS's own long-press menu (text selection
    // popup, "Save image") so ours is the only one that appears.
    onContextMenu: (e: React.SyntheticEvent) => e.preventDefault(),
  };
}
