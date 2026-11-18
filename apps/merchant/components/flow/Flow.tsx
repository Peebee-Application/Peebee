"use client";

import { ArrowLeft, Check, Delete, X, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Big round icon button used in flow headers. */
export function RoundButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink active:scale-95"
    >
      {children}
    </button>
  );
}

/** Flow header: back, title, close. */
export function FlowTop({ title, onBack, onClose }: { title: string; onBack?: () => void; onClose?: () => void }) {
  return (
    <div className="flex items-center gap-3 px-4 pt-4">
      {onBack ? <RoundButton label="Back" onClick={onBack}><ArrowLeft className="h-6 w-6" /></RoundButton> : <span className="h-12 w-12" />}
      <h1 className="flex-1 truncate text-center text-xl font-black text-ink">{title}</h1>
      {onClose ? <RoundButton label="Close" onClick={onClose}><X className="h-6 w-6" /></RoundButton> : <span className="h-12 w-12" />}
    </div>
  );
}

/** Icon stepper: done steps are gold ticks, the current one is a gold disc. */
export function Stepper({ steps, current, onJump }: { steps: { icon: LucideIcon; label: string }[]; current: number; onJump?: (index: number) => void }) {
  return (
    <ol className="flex items-center px-4 pt-4" aria-label="Steps">
      {steps.map((step, i) => {
        const done = i < current;
        const on = i === current;
        const Icon = done ? Check : step.icon;
        return (
          <li key={step.label} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              disabled={!onJump || i >= current}
              onClick={() => onJump?.(i)}
              aria-label={step.label}
              aria-current={on ? "step" : undefined}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                on ? "bg-gold text-ink-gold ring-4 ring-gold/25" : done ? "bg-gold/20 text-gold" : "bg-[rgb(var(--surface-muted))] text-ink-500"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={2.4} />
            </button>
            {i < steps.length - 1 && <span className={`mx-1 h-0.5 flex-1 rounded-full ${done ? "bg-gold" : "bg-[rgb(var(--surface-muted))]"}`} />}
          </li>
        );
      })}
    </ol>
  );
}

/** Sticky action bar at the bottom. `aboveNav` lifts it over the bottom navigation. */
export function BottomBar({ children, aboveNav = false }: { children: ReactNode; aboveNav?: boolean }) {
  return (
    <div
      className={`fixed inset-x-0 z-30 mx-auto flex max-w-md gap-3 px-4 pb-4 pt-3 bg-gradient-to-t from-[rgb(var(--cream))] via-[rgb(var(--cream))] to-transparent ${
        aboveNav ? "bottom-[calc(80px+env(safe-area-inset-bottom))]" : "bottom-0 pb-[calc(16px+env(safe-area-inset-bottom))]"
      }`}
    >
      {children}
    </div>
  );
}

export function PrimaryButton({ children, onClick, disabled, type = "button", testId }: { children: ReactNode; onClick?: () => void; disabled?: boolean; type?: "button" | "submit"; testId?: string }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
      className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-full bg-gold px-6 text-lg font-black text-ink-gold shadow-[0_8px_24px_rgb(var(--gold)/0.3)] active:scale-[.98] disabled:opacity-50"
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, onClick, label, square = false }: { children: ReactNode; onClick?: () => void; label?: string; square?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex min-h-14 items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] text-lg font-bold text-ink active:scale-[.98] ${square ? "w-14 shrink-0" : "flex-1 px-6"}`}
    >
      {children}
    </button>
  );
}

/** Large on/off switch. */
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (next: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors ${on ? "justify-end bg-gold" : "justify-start bg-[rgb(var(--surface-muted))]"}`}
    >
      <span className="h-6 w-6 rounded-full bg-white shadow" />
    </button>
  );
}

/** Six (or four for a PIN) code boxes that mirror what the keypad typed. */
export function CodeBoxes({ value, length }: { value: string; length: number }) {
  return (
    <div className="flex justify-center gap-2" aria-live="polite" aria-label={`${value.length} of ${length} digits entered`}>
      {Array.from({ length }, (_, i) => {
        const filled = i < value.length;
        const on = i === value.length;
        return (
          <span
            key={i}
            className={`flex h-14 w-11 items-center justify-center rounded-2xl text-2xl font-black text-ink ${
              on ? "border-2 border-gold bg-[rgb(var(--surface-card))]" : filled ? "bg-[rgb(var(--surface-muted))]" : "border border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"
            }`}
          >
            {filled ? value[i] : ""}
          </span>
        );
      })}
    </div>
  );
}

/** Number pad for codes and PINs. */
export function Keypad({ onDigit, onDelete, disabled }: { onDigit: (d: string) => void; onDelete: () => void; disabled?: boolean }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  return (
    <div className="grid grid-cols-3 gap-2.5 px-4" role="group" aria-label="Keypad">
      {keys.map((k, i) =>
        k === "" ? (
          <span key={i} />
        ) : (
          <button
            key={i}
            type="button"
            disabled={disabled}
            onClick={() => (k === "del" ? onDelete() : onDigit(k))}
            aria-label={k === "del" ? "Delete" : k}
            className={`flex h-14 items-center justify-center rounded-2xl text-2xl font-bold text-ink active:scale-95 disabled:opacity-50 ${k === "del" ? "" : "bg-[rgb(var(--surface-muted))]"}`}
          >
            {k === "del" ? <Delete className="h-7 w-7" /> : k}
          </button>
        ),
      )}
    </div>
  );
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p role="alert" className="mx-4 rounded-2xl bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-600 dark:text-red-400">{children}</p>;
}

/** Choice tile used for plans, payment methods and item types. */
export function ChoiceTile({
  selected, onClick, children, className = "", disabled, testId,
}: { selected: boolean; onClick: () => void; children: ReactNode; className?: string; disabled?: boolean; testId?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      data-testid={testId}
      className={`relative w-full rounded-3xl border-2 text-left transition-colors active:scale-[.99] disabled:opacity-50 ${
        selected ? "border-gold bg-gold/10" : "border-[var(--border-faint)] bg-[rgb(var(--surface-card))]"
      } ${className}`}
    >
      {children}
    </button>
  );
}
