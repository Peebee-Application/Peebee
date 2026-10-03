"use client";

import { useEffect, useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useAuth, type PartnerMode } from "../lib/auth-context";
import { compressImage } from "../lib/image-compress";

type Kind = "national_id" | "licence";
const LABEL: Record<Kind, string> = { national_id: "National ID", licence: "Driving licence" };

/** Upload the identity documents Tuma needs before approving this profile. */
export function KycCard({ mode }: { mode: PartnerMode }) {
  const { me, refreshMe } = useAuth();
  const [kyc, setKyc] = useState<{ ownerIdRequired: boolean; driverIdRequired: boolean; driverLicenceRequired: boolean } | null>(null);
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getCarConfig().then((c) => setKyc(c.kyc ?? null)).catch(() => setKyc(null));
  }, []);

  const status = mode === "owner" ? me?.ownerStatus : me?.driverStatus;
  if (!me || !kyc || !status || status === "none") return null;
  const needed: Kind[] = mode === "owner" ? (kyc.ownerIdRequired ? ["national_id"] : []) : [...(kyc.driverIdRequired ? (["national_id"] as Kind[]) : []), ...(kyc.driverLicenceRequired ? (["licence"] as Kind[]) : [])];
  if (needed.length === 0) return null;
  const missing = needed.filter((k) => !me.documents[k]);
  // Once approved with everything on file there's nothing to show.
  if (status === "approved" && missing.length === 0) return null;

  async function upload(kind: Kind, file: File | undefined) {
    if (!file) return;
    setBusy(kind);
    setError("");
    try {
      await api.carUploadDocument(kind, await compressImage(file));
      await refreshMe();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="home-card space-y-3">
      <div>
        <p className="font-bold text-ink">Verify your identity</p>
        <p className="text-xs text-ink-500">Tuma needs a clear photo of {needed.map((k) => LABEL[k]).join(" and ")} before approving your {mode} profile. Only you and Tuma staff can see it.</p>
      </div>
      {needed.map((kind) => (
        <label key={kind} className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--border-faint)] p-3">
          <span>
            <span className="block text-sm font-semibold text-ink">{LABEL[kind]}</span>
            <span className={`block text-xs ${me.documents[kind] ? "text-green" : "text-ink-500"}`}>{busy === kind ? "Uploading…" : me.documents[kind] ? "Uploaded ✓ — tap to replace" : "Not uploaded yet"}</span>
          </span>
          <span className="rounded-full bg-gold/15 px-3 py-2 text-xs font-bold text-ink">{me.documents[kind] ? "Replace" : "Take / choose photo"}</span>
          <input type="file" accept="image/*" hidden disabled={busy !== null} onChange={(e) => { void upload(kind, e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      ))}
      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{error}</p>}
    </section>
  );
}
