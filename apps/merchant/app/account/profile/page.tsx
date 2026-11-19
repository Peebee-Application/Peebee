"use client";

import { BadgeCheck, Camera, Check, Eye, EyeOff, ImageOff, KeyRound, Lock, Mail, Phone, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { AccountFrame, Avatar, ErrorNote, GRow, Group, RolePill, readFlash, setFlash, useBack, useUserPhoto } from "../../../components/account/AccountUI";
import { BottomSheet } from "../../../components/store/BottomSheet";
import { PageHeader, fieldCls, labelCls } from "../../../components/store/StoreUI";
import { api, errorMessage } from "../../../lib/api";
import { useAuth } from "../../../lib/auth-context";
import { compressImage } from "../../../lib/image-compress";

const MAX_BYTES = 4 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function SaveButton({ busy, label = "Save", testId, form, disabled = false }: { busy: boolean; label?: string; testId: string; form?: string; disabled?: boolean }) {
  return (
    <button type="submit" form={form} disabled={busy || disabled} data-testid={testId}
      className="flex min-h-16 w-full items-center justify-center gap-2.5 rounded-full bg-gold text-[20px] font-black text-ink-gold shadow-[0_8px_22px_rgb(var(--gold)/0.35)] active:scale-[.98] disabled:opacity-50">
      <Check className="h-6 w-6" strokeWidth={3} /> {busy ? "Saving…" : label}
    </button>
  );
}

export default function ProfilePage() {
  const { user, merchant, updateUser, setSession } = useAuth();
  const back = useBack("/account");
  const [photoVersion, setPhotoVersion] = useState(0);
  const photo = useUserPhoto(user, photoVersion);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sheet, setSheet] = useState<"name" | "password" | "photo-remove" | null>(null);
  const [name, setName] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [confirmTouched, setConfirmTouched] = useState(false);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [notice, setNotice] = useState(() => readFlash("profile"));

  if (!user) return null;
  const verified = <BadgeCheck className="ml-1.5 inline h-[18px] w-[18px] align-[-2px] text-[#15803d] dark:text-[#4ade80]" strokeWidth={2.6} aria-label="Verified" />;

  async function pickPhoto(file: File | undefined) {
    if (!file || !user) return;
    setError(""); setNotice("");
    if (!PHOTO_TYPES.has(file.type)) { setError("Use a JPEG, PNG or WebP photo."); return; }
    if (file.size > MAX_BYTES) { setError("That photo is too large (max 4MB)."); return; }
    setBusy(true);
    try {
      const small = await compressImage(file, { maxDimension: 640 });
      await api.uploadUserProfilePhoto(small);
      updateUser({ ...user, hasProfilePhoto: true });
      setPhotoVersion((v) => v + 1);
      setNotice("Photo saved");
    } catch (cause) { setError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function removePhoto() {
    if (!user) return;
    setBusy(true); setSheetError("");
    try { await api.deleteUserProfilePhoto(); updateUser({ ...user, hasProfilePhoto: false }); setSheet(null); setNotice("Photo removed"); }
    catch (cause) { setSheetError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function saveName(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const v = name.trim();
    if (v.length < 2) { setSheetError("Type your full name."); return; }
    setBusy(true); setSheetError("");
    try { const r = await api.updateMyDisplayName(v); updateUser({ ...user, name: r.name ?? v }); setSheet(null); setNotice("Name saved"); }
    catch (cause) { setSheetError(errorMessage(cause)); } finally { setBusy(false); }
  }
  async function savePassword(e: React.FormEvent) {
    e.preventDefault();
    if (!current) { setSheetError("Type your current password."); return; }
    if (next.length < 6) { setSheetError("Use at least 6 characters."); return; }
    if (next !== confirm) { setConfirmTouched(true); return; }
    setBusy(true); setSheetError("");
    try { const r = await api.changePassword(current, next); setFlash("profile", "Password changed"); setSession(r.token, r.user); setCurrent(""); setNext(""); setConfirm(""); setConfirmTouched(false); setSheet(null); setNotice("Password changed"); }
    catch (cause) { setSheetError(errorMessage(cause)); } finally { setBusy(false); }
  }

  return (
    <AccountFrame testId="profile">
      <PageHeader title="My profile" onBack={back} backLabel="Back" />
      <div className="flex flex-col items-center gap-3 py-1.5">
        <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-label="Change photo" data-testid="profile-photo" className="relative rounded-full active:scale-[.97]">
          <Avatar name={user.name} photo={photo} size={120} ring="border-gold/60" />
          <span className="absolute -bottom-1 -right-1 grid h-[46px] w-[46px] place-items-center rounded-full border-[3px] border-[rgb(var(--cream))] bg-black text-gold"><Camera className="h-[22px] w-[22px]" strokeWidth={2.6} /></span>
        </button>
        <p className="break-words text-center text-[26px] font-black leading-tight text-ink" data-testid="profile-name">{user.name}</p>
        {merchant?.member_role && <RolePill role={merchant.member_role} />}
      </div>
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void pickPhoto(e.target.files?.[0]); e.target.value = ""; }} data-testid="profile-photo-input" />
      {notice && <p role="status" className="flex items-center gap-2.5 rounded-[18px] bg-green-600/12 px-4 py-3 text-[17px] font-black text-green-700 dark:text-green-300" data-testid="profile-notice"><Check className="h-6 w-6" strokeWidth={3} />{notice}</p>}
      <ErrorNote message={error} />

      <Group testId="profile-details">
        <GRow icon={UserRound} label="Name" value={user.name} trail="edit" onClick={() => { setName(user.name); setSheetError(""); setSheet("name"); }} testId="profile-edit-name" />
        {user.phone && <GRow icon={Phone} label="Phone" value={<>{user.phone}{user.phoneVerifiedAt && verified}</>} trail="lock" testId="profile-phone" />}
        {user.email && <GRow icon={Mail} label="Email" value={<span className="break-all">{user.email}{user.emailVerifiedAt && verified}</span>} trail="lock" testId="profile-email" />}
      </Group>
      <Group>
        {user.passwordSet === false
          ? <GRow icon={KeyRound} value="Set a password" href="/forgot-password" testId="profile-set-password" />
          : <GRow icon={KeyRound} value="Change password" onClick={() => { setCurrent(""); setNext(""); setConfirm(""); setConfirmTouched(false); setSheetError(""); setSheet("password"); }} testId="profile-password" />}
        {user.hasProfilePhoto && <GRow icon={ImageOff} value="Remove photo" onClick={() => { setSheetError(""); setSheet("photo-remove"); }} testId="profile-remove-photo" />}
      </Group>

      {sheet === "name" && (
        <BottomSheet title="Your name" onClose={() => setSheet(null)} testId="name-sheet" footer={<SaveButton busy={busy} testId="name-save" form="name-form" />}>
          <form id="name-form" onSubmit={saveName} className="space-y-3 pt-1">
            <label htmlFor="profile-name-input" className={labelCls}><UserRound className="h-5 w-5 text-gold" /> Full name</label>
            <input id="profile-name-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={80} className={fieldCls} data-testid="name-input" />
            <ErrorNote message={sheetError} />
          </form>
        </BottomSheet>
      )}
      {sheet === "password" && (
        <BottomSheet title="Change password" onClose={() => setSheet(null)} testId="password-sheet" footer={<SaveButton busy={busy} testId="password-save" form="password-form" disabled={!current || next.length < 6 || next !== confirm} />}>
          <form id="password-form" onSubmit={savePassword} className="space-y-4 pt-1">
            <div>
              <label htmlFor="pw-current" className={labelCls}><Lock className="h-5 w-5 text-gold" /> Current password</label>
              <input id="pw-current" type={show ? "text" : "password"} value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" className={fieldCls} data-testid="pw-current" />
            </div>
            <div>
              <label htmlFor="pw-new" className={labelCls}><KeyRound className="h-5 w-5 text-gold" /> New password</label>
              <div className="relative">
                <input id="pw-new" type={show ? "text" : "password"} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" className={`${fieldCls} pr-16`} data-testid="pw-new" />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? "Hide passwords" : "Show passwords"} aria-pressed={show}
                  className="absolute right-1 top-1/2 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full text-ink-500">{show ? <EyeOff className="h-6 w-6" /> : <Eye className="h-6 w-6" />}</button>
              </div>
            </div>
            <div>
              <label htmlFor="pw-confirm" className={labelCls}><KeyRound className="h-5 w-5 text-gold" /> Confirm new password</label>
              <input id="pw-confirm" type={show ? "text" : "password"} value={confirm} onChange={(e) => { setConfirm(e.target.value); if (e.target.value.length >= next.length && next.length > 0) setConfirmTouched(true); }} onBlur={() => setConfirmTouched(true)} autoComplete="new-password"
                aria-invalid={confirmTouched && confirm !== next} aria-describedby="pw-mismatch" className={`${fieldCls} ${confirmTouched && confirm !== next ? "!border-red-600" : ""}`} data-testid="pw-confirm" />
              {confirmTouched && confirm !== next && <p id="pw-mismatch" role="alert" className="mt-2 text-[17px] font-bold text-red-600 dark:text-red-400" data-testid="pw-mismatch">Passwords don&apos;t match</p>}
            </div>
            <ErrorNote message={sheetError} />
          </form>
        </BottomSheet>
      )}
      {sheet === "photo-remove" && (
        <BottomSheet title="Remove photo?" onClose={() => setSheet(null)} testId="photo-remove-sheet">
          <div className="space-y-3 pt-1">
            <ErrorNote message={sheetError} />
            <button type="button" onClick={removePhoto} disabled={busy} data-testid="photo-remove-confirm" className="flex min-h-[68px] w-full items-center justify-center gap-2.5 rounded-full bg-red-600 text-[21px] font-black text-white disabled:opacity-50"><ImageOff className="h-6 w-6" /> Remove</button>
            <button type="button" onClick={() => setSheet(null)} className="flex min-h-[68px] w-full items-center justify-center rounded-full bg-black text-[21px] font-black text-white dark:border-2 dark:border-white/20">Keep</button>
          </div>
        </BottomSheet>
      )}
    </AccountFrame>
  );
}
