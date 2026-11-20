"use client";

import { X } from "lucide-react";
import type { NavPrimaryAction } from "../lib/nav-primary-action";
import { NavAction } from "./NavAction";

/** For a modal that owns its footer while the app navigation is behind its backdrop. */
export function ConfirmationFooter({ action, onCancel }: { action: NavPrimaryAction; onCancel: () => void }) {
  return <div className="customer-nav-shell flex w-full items-stretch" aria-label="Final confirmation">
    <div className="customer-nav-anchor"><button type="button" aria-label="Cancel confirmation" disabled={action.busy} onClick={onCancel} className="customer-nav-anchor-button"><X aria-hidden /></button></div>
    <NavAction action={{ ...action, confirmation: true }} />
  </div>;
}
