"use client";

import { CallEngine, playNotificationSound, type CallEngineState } from "@peebee/shared";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api } from "./api";
import { useLearnAuth } from "./auth-context";

const IDLE_POLL_MS = 4000;

type CallsContextValue = {
  state: CallEngineState;
  startCall: (input: { calleeId: string; orderId?: string; restaurantId?: string; schoolId?: string }) => void;
  accept: () => void;
  decline: () => void;
  hangUp: () => void;
  remoteStream: MediaStream | null;
};

const CallsContext = createContext<CallsContextValue | null>(null);

export function CallsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useLearnAuth();
  const [state, setState] = useState<CallEngineState>({ phase: "idle", call: null, error: null });
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [engine] = useState(
    () =>
      new CallEngine({
        api,
        onStateChange: setState,
        onRemoteStream: setRemoteStream,
        getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
      }),
  );

  useEffect(() => {
    return () => engine.destroy();
  }, [engine]);

  // Poll for an incoming call while idle and signed in — so a customer
  // calling back can be answered anywhere in the app.
  useEffect(() => {
    if (!user || state.phase !== "idle") return;
    const interval = setInterval(() => {
      api
        .getIncomingCall()
        .then((res) => {
          if (res.call) {
            playNotificationSound();
            engine.presentIncoming(res.call);
          }
        })
        .catch(() => {});
    }, IDLE_POLL_MS);
    return () => clearInterval(interval);
  }, [user, state.phase, engine]);

  const startCall = useCallback((input: { calleeId: string; orderId?: string; restaurantId?: string; schoolId?: string }) => {
    engine.startCall(input);
  }, [engine]);
  const accept = useCallback(() => engine.accept(), [engine]);
  const decline = useCallback(() => engine.decline(), [engine]);
  const hangUp = useCallback(() => engine.hangUp(), [engine]);

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
