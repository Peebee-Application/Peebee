"use client";
import { friendlyErrorMessage } from "./api-client.js";
import { useEffect, useRef, useState } from "react";
import type { AttentionSettings } from "./attention.js";

type Session = { released: boolean; id?: string; started: number; timer?: ReturnType<typeof setTimeout>; tick?: ReturnType<typeof setInterval>; max?: ReturnType<typeof setTimeout> };
type AttentionApi = {
  startAttention(orderId: string, input: { recipientId: string; reason: string; mode: "tap" | "hold" }): Promise<{ id: string; settings: AttentionSettings }>;
  attentionAction(id: string, action: "stop" | "heartbeat"): Promise<unknown>;
};
/** Pointer, keyboard and screen-reader activation share one request path.
 * Release can precede the POST response: the late response is stopped immediately. */
export function useAttentionCall(api: AttentionApi, orderId: string, recipientId: string | undefined, settings: AttentionSettings) {
  const [holding, setHolding] = useState(false), [busy, setBusy] = useState(false), [elapsed, setElapsed] = useState(0), [error, setError] = useState("");
  const session = useRef<Session | null>(null);
  const stop = () => {
    const s = session.current;
    if (!s) return;
    s.released = true; clearTimeout(s.timer); clearTimeout(s.max); clearInterval(s.tick);
    if (s.id) void api.attentionAction(s.id, "stop").catch(() => {});
    session.current = null; setHolding(false); setBusy(false);
  };
  useEffect(() => {
    const cancel = () => { if (document.visibilityState !== "visible") stop(); };
    const blur = () => stop();
    document.addEventListener("visibilitychange", cancel); window.addEventListener("blur", blur);
    return () => { document.removeEventListener("visibilitychange", cancel); window.removeEventListener("blur", blur); stop(); };
    // Stop belongs to the current session; changing recipients cancels that session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, recipientId]);
  async function tap(reason: string) {
    if (!recipientId || session.current) return;
    const s = { released: false, started: Date.now() }; session.current = s;
    setBusy(true); setError("");
    try { await api.startAttention(orderId, { recipientId, reason, mode: "tap" }); }
    catch (e) { if (session.current === s) setError(friendlyErrorMessage(e)); }
    finally { if (session.current === s) { session.current = null; setBusy(false); } }
  }
  async function begin(reason: string) {
    if (!recipientId || session.current) return;
    const s: Session = { released: false, started: Date.now() };
    session.current = s; setHolding(true); setBusy(true); setElapsed(0); setError("");
    s.tick = setInterval(() => setElapsed(Math.min(settings.maxHoldSeconds, (Date.now() - s.started) / 1000)), 100);
    s.max = setTimeout(stop, settings.maxHoldSeconds * 1000);
    try {
      const response = await api.startAttention(orderId, { recipientId, reason, mode: "hold" });
      s.id = response.id;
      if (s.released) { await api.attentionAction(s.id, "stop"); return; }
      const heartbeat = async () => {
        if (s.released) return;
        try { await api.attentionAction(s.id!, "heartbeat"); }
        catch { if (session.current === s) stop(); return; }
        if (!s.released) s.timer = setTimeout(heartbeat, Math.max(250, settings.leaseMilliseconds / 3));
      };
      s.timer = setTimeout(heartbeat, Math.max(250, settings.leaseMilliseconds / 3));
    } catch (e) { if (session.current === s) { setError(friendlyErrorMessage(e)); stop(); } }
  }
  return { holding, busy, elapsed, error, begin, stop, tap };
}
