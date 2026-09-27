"use client";

import { X } from "lucide-react";
import { useEffect, useRef } from "react";

interface BottomDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  className?: string;
}

export function BottomDrawer({
  isOpen,
  onClose,
  title,
  children,
  className = "",
}: BottomDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden
      />

      {/* Drawer sheet */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || "Context drawer"}
        className={`relative z-10 w-full max-w-lg max-h-[85vh] overflow-y-auto soft-drawer animate-drawer-in p-5 pb-8 safe-area-inset-bottom ${className}`}
      >
        {/* Tactile drag handle */}
        <div className="flex justify-center pb-3">
          <span className="h-1.5 w-10 rounded-full bg-[rgb(var(--color-ink-500)/0.25)]" aria-hidden />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between pb-3">
          {title ? (
            <h2 className="text-base font-bold text-ink">{title}</h2>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink active:scale-95 transition-transform"
            aria-label="Close sheet"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">{children}</div>
      </div>
    </div>
  );
}
