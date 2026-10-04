"use client";

import { CallEngine, type CallEngineState } from "@peebee/shared";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth-context";

const IDLE_POLL_MS = 4000;

type CallsContextValue = {
  state: CallEngineState;
  startCall: (input: { calleeId: string; orderId?: string; restaurantId?: string }) => void;
  accept: () => void;
  decline: () => void;
  hangUp: () => void;
  remoteStream: MediaStream | null;
};

const CallsContext = createContext<CallsContextValue | null>(null);

export function CallsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [state, setState] = useState<CallEngineState>({ phase: "idle", call: null, error: null });
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const engineRef = useRef<CallEngine | null>(null);

  if (!engineRef.current) {
    engineRef.current = new CallEngine({
      api,
      onStateChange: setState,
      onRemoteStream: setRemoteStream,
      getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    });
  }

  useEffect(() => {
    return () => engineRef.current?.destroy();
  }, []);

  // Poll for an incoming call while idle and signed in — same pattern as
  // chat's unread-thread polling elsewhere in this app.
  useEffect(() => {
    if (!user || state.phase !== "idle") return;
    const interval = setInterval(() => {
      api
        .getIncomingCall()
        .then((res) => {
          if (res.call) engineRef.current?.presentIncoming(res.call);
        })
        .catch(() => {});
    }, IDLE_POLL_MS);
    return () => clearInterval(interval);
  }, [user, state.phase]);

  const startCall = useCallback((input: { calleeId: string; orderId?: string; restaurantId?: string }) => {
    engineRef.current?.startCall(input);
  }, []);
  const accept = useCallback(() => engineRef.current?.accept(), []);
  const decline = useCallback(() => engineRef.current?.decline(), []);
  const hangUp = useCallback(() => engineRef.current?.hangUp(), []);

  return (
    <CallsContext.Provider value={{ state, startCall, accept, decline, hangUp, remoteStream }}>
      {children}
    </CallsContext.Provider>
  );
}

export function useCalls(): CallsContextValue {
  const ctx = useContext(CallsContext);
  if (!ctx) throw new Error("useCalls must be used within CallsProvider");
  return ctx;
}
