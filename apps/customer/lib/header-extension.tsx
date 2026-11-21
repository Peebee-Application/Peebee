"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const SlotContext = createContext<HTMLElement | null>(null);
const SetSlotContext = createContext<(node: HTMLElement | null) => void>(() => {});

/** Lets a screen render inside the sticky header so it moves with the menu. */
export function HeaderExtensionProvider({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <SetSlotContext.Provider value={setSlot}>
      <SlotContext.Provider value={slot}>{children}</SlotContext.Provider>
    </SetSlotContext.Provider>
  );
}

export function HeaderExtensionOutlet() {
  const setSlot = useContext(SetSlotContext);
  return <div ref={setSlot} className="wallet-root customer-header-extension" />;
}

export function HeaderExtension({ children }: { children: ReactNode }) {
  const slot = useContext(SlotContext);
  if (!slot) return <>{children}</>;
  return createPortal(children, slot);
}
