"use client";

import { Eye, EyeOff, Wifi } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { AuthNotice } from "../../lib/auth-notice";

export function AuthScreen({ children }: { children: ReactNode }) {
  return <div className="account-screen">{children}</div>;
}

export function AuthTop({
  onBack,
  backLabel,
  step,
  busy,
}: {
  onBack?: () => void;
  backLabel?: string;
  step?: string;
  busy?: boolean;
}) {
  return (
    <div className="account-top">
      <div className="account-backrow">
        {onBack && (
          <button type="button" className="account-back" onClick={onBack} disabled={busy} aria-label={backLabel ? undefined : "Back"}>
            <BackIcon />
          </button>
        )}
        {backLabel && <span className="account-back-label">{backLabel}</span>}
      </div>
      {step && <span className="account-step">{step}</span>}
    </div>
  );
}

export function AuthBrand() {
  return (
    <div className="account-brand">
      {/* The two marks swap with the theme. next/image cannot do that visibility swap. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/peebee-logo-light.svg?v=logo-6" alt="" className="account-logo-light" width={36} height={36} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/peebee-logo-dark.svg?v=logo-6" alt="" className="account-logo-dark" width={36} height={36} />
      <span>Peebee</span>
    </div>
  );
}

export function WelcomeArt() {
  return (
    <div className="account-art" aria-hidden="true">
      <svg viewBox="0 0 310 214">
        <defs>
          <linearGradient id="account-gold" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#E0B93D" />
            <stop offset="1" stopColor="#C9A227" />
          </linearGradient>
          <linearGradient id="account-glass" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.92" />
            <stop offset="1" stopColor="#FFFFFF" stopOpacity="0.62" />
          </linearGradient>
        </defs>
        <path d="M60 40 C110 -10 230 0 270 50 C310 100 290 170 230 195 C170 220 80 210 40 170 C0 130 10 90 60 40Z" fill="url(#account-gold)" opacity="0.95" />
        <path d="M200 20 C240 10 280 30 288 60 C296 92 270 104 248 96 C222 86 180 40 200 20Z" fill="#F1EEE4" opacity="0.7" />
        <circle cx="52" cy="186" r="14" fill="#F1EEE4" />
        <circle cx="282" cy="160" r="7" fill="#0A0A0A" opacity="0.85" />
        <rect x="34" y="62" width="104" height="104" rx="12" fill="url(#account-glass)" stroke="#FFFFFF" strokeOpacity="0.8" />
        <rect x="172" y="62" width="104" height="104" rx="12" fill="url(#account-glass)" stroke="#FFFFFF" strokeOpacity="0.8" />
        <rect x="103" y="98" width="104" height="104" rx="12" fill="#FFFFFF" />
        <g transform="translate(62 88)" fill="none" stroke="#0A0A0A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 26h44a22 22 0 01-44 0z" fill="#E0B93D" />
          <path d="M14 18c0-6 6-6 6-12M26 18c0-6 6-6 6-12" />
        </g>
        <g transform="translate(200 86)" fill="none" stroke="#0A0A0A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 16h36l-3 34H9z" fill="#E0B93D" />
          <path d="M16 22v-8a8 8 0 0116 0v8" />
        </g>
        <g transform="translate(131 120)" fill="none" stroke="#0A0A0A" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="12" width="40" height="36" rx="6" fill="#F1EEE4" />
          <path d="M4 24h40M24 12v12" />
          <path d="M14 6l10-4 10 4" />
        </g>
      </svg>
    </div>
  );
}

export function AuthTitle({ children, center }: { children: ReactNode; center?: boolean }) {
  return <h1 className={`account-title${center ? " is-center" : ""}`}>{children}</h1>;
}

export function AuthSub({ children, center }: { children: ReactNode; center?: boolean }) {
  return <p className={`account-sub${center ? " is-center" : ""}`}>{children}</p>;
}

function FieldIcon({ name }: { name: "phone" | "mail" | "lock" | "user" }) {
  const common = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  if (name === "mail") return <svg {...common}><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M3 7l9 6 9-6" /></svg>;
  if (name === "lock") return <svg {...common}><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>;
  if (name === "user") return <svg {...common}><circle cx="12" cy="8" r="3.2" /><path d="M6 19c1.2-2.6 3.3-4 6-4s4.8 1.4 6 4" /></svg>;
  return <svg {...common}><rect x="8" y="2" width="8" height="20" rx="2" /><path d="M11 18h2" /></svg>;
}

export function AuthField({
  id,
  label,
  icon,
  value,
  onChange,
  placeholder,
  type = "text",
  inputMode,
  autoComplete,
  disabled,
  invalid,
  autoFocus,
  minLength,
}: {
  id: string;
  label: string;
  icon: "phone" | "mail" | "lock" | "user";
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: "text" | "tel" | "email" | "numeric";
  autoComplete?: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  minLength?: number;
}) {
  return (
    <label className={`account-field field-box${disabled ? " is-locked" : ""}${invalid ? " is-invalid" : ""}`} htmlFor={id}>
      <span className="account-icon"><FieldIcon name={icon} /></span>
      <span className="account-col">
        <span className="account-lbl">{label}</span>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={type}
          inputMode={inputMode}
          autoComplete={autoComplete}
          disabled={disabled}
          autoFocus={autoFocus}
          minLength={minLength}
          aria-invalid={invalid || undefined}
        />
      </span>
    </label>
  );
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  placeholder,
  autoComplete,
  disabled,
  invalid,
  autoFocus,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`account-field field-box${disabled ? " is-locked" : ""}${invalid ? " is-invalid" : ""}`}>
      <span className="account-icon"><FieldIcon name="lock" /></span>
      <span className="account-col">
        <label className="account-lbl" htmlFor={id}>{label}</label>
        <input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          disabled={disabled}
          autoFocus={autoFocus}
          aria-invalid={invalid || undefined}
        />
      </span>
      <button type="button" className="account-eye" onClick={() => setVisible((v) => !v)} disabled={disabled} aria-label={visible ? "Hide password" : "Show password"}>
        {visible ? <EyeOff className="h-5 w-5" strokeWidth={2} aria-hidden /> : <Eye className="h-5 w-5" strokeWidth={2} aria-hidden />}
      </button>
    </div>
  );
}

export function CollapsedId({
  label,
  value,
  icon,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  icon: "phone" | "mail";
  onChange?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className={`account-field field-box${disabled ? " is-locked" : ""}`}>
      <span className="account-icon"><FieldIcon name={icon} /></span>
      <span className="account-col">
        <span className="account-lbl">{label}</span>
        <span className="account-val">{value}</span>
      </span>
      {onChange && (
        <button type="button" className="account-change" onClick={onChange} disabled={disabled}>Change</button>
      )}
    </div>
  );
}

export function AuthButton({
  children,
  tone = "gold",
  type = "button",
  disabled,
  busy,
  onClick,
}: {
  children: ReactNode;
  tone?: "gold" | "dark" | "sec" | "muted" | "ghost";
  type?: "button" | "submit";
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type={type}
      className={`account-btn account-btn-${tone}${busy ? " is-busy" : ""}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      onClick={onClick}
    >
      {busy && <span className="account-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function AuthNoticeView({ notice, onRetry }: { notice: AuthNotice; onRetry?: () => void }) {
  const tone = notice.tone === "offline" || notice.tone === "lockout" || notice.tone === "google" ? "info" : notice.tone === "info" ? "info" : "error";
  return (
    <div className={`account-notice is-${notice.tone === "error" ? "error" : tone === "error" ? "error" : notice.tone === "google" ? "google" : "info"}`} role={notice.tone === "error" || notice.tone === "lockout" ? "alert" : "status"}>
      <span className="account-notice-icon" aria-hidden>
        {notice.tone === "offline" || notice.message.startsWith("Still working") ? <Wifi className="h-[22px] w-[22px]" strokeWidth={2} /> : notice.tone === "google" ? <GoogleMark /> : <AlertIcon />}
      </span>
      <span>
        {notice.tone === "offline" ? (
          <>You&apos;re offline. Check your connection, then <button type="button" onClick={onRetry}>Retry</button>.</>
        ) : notice.tone === "info" && notice.message.startsWith("Still working") ? (
          <><b>Still working…</b><br />Your connection seems slow. Please keep this screen open.</>
        ) : notice.message}
      </span>
    </div>
  );
}

export function OtpBoxes({
  value,
  onChange,
  disabled,
  invalid,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <div className={`account-otp${invalid ? " is-invalid" : ""}`}>
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={`account-otp-box${value.length === i && !disabled ? " is-current" : ""}`} aria-hidden>
          {value[i] ?? (value.length === i && !disabled ? <span className="account-caret" /> : null)}
        </div>
      ))}
      <input
        className="account-otp-input"
        inputMode="numeric"
        autoComplete="one-time-code"
        aria-label="6-digit code"
        maxLength={6}
        value={value}
        disabled={disabled}
        autoFocus
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </div>
  );
}

export function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function BackIcon() {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M15 5l-7 7 7 7" /></svg>;
}

function AlertIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v5" /><circle cx="12" cy="16.5" r="0.8" fill="currentColor" /></svg>;
}

export function LockIcon() {
  return <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="4" y="10" width="16" height="11" rx="3" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>;
}
