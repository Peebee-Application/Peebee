"use client";

import {
  detectMobileMoneyNetwork,
  isRiderProfileComplete,
  mobileMoneyNetworkLabel,
  type Rider,
  type RiderSubscriptionView,
} from "@tuma/shared";
import { CheckCircle2, LogOut, MapPin, PiggyBank, TriangleAlert, Upload, User } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppearanceSettings } from "../../components/AppearanceSettings";
import { ChangePasswordPanel } from "../../components/ChangePasswordPanel";
import { LanguageSettings } from "../../components/LanguageSettings";
import { MobileNumberManager } from "../../components/MobileNumberManager";
import { PracticeModeCard } from "../../components/PracticeMode";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";
import { compressImage } from "../../lib/image-compress";
import { useTranslate } from "../../lib/i18n";
import { useLivePolling } from "../../lib/use-live-polling";

const LocationMapPicker = dynamic(
  () => import("../../components/LocationMapPicker").then((m) => m.LocationMapPicker),
  { ssr: false },
);

function Field({
  label,
  value,
  onChange,
  placeholder,
  required,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-ink-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
      />
    </div>
  );
}

export default function AccountPage() {
  const t = useTranslate();
  const { user, rider: authRider, refreshRider, logout } = useAuth();
  const [rider, setRider] = useState<Rider | null>(authRider);
  const [showSavingsLink, setShowSavingsLink] = useState(false);

  useEffect(() => {
    api
      .getSettings()
      .then(({ settings }) => setShowSavingsLink(settings.vslaFeaturePlacement === "account_only"))
      .catch(() => {});
  }, []);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [altPhone, setAltPhone] = useState("");
  const [vehicleInfo, setVehicleInfo] = useState("");
  const [stageAddress, setStageAddress] = useState("");
  const [stageArea, setStageArea] = useState("");
  const [stageCoords, setStageCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [homeAddress, setHomeAddress] = useState("");
  const [stageName, setStageName] = useState("");
  const [stageChairmanName, setStageChairmanName] = useState("");
  const [stageChairmanContact, setStageChairmanContact] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [momoMsisdn, setMomoMsisdn] = useState("");
  const detectedNetwork = useMemo(() => detectMobileMoneyNetwork(momoMsisdn), [momoMsisdn]);

  const [showMap, setShowMap] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploadingId, setUploadingId] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api
      .myRiderProfile()
      .then((res) => applyRider(res.rider))
      .catch(() => {});
  }, []);

  // Keeps the "Pending"/"Verified" badge and the waiting-on-admin card in
  // sync without another visit to this page — previously this only ever
  // fetched once on mount, so a rider who got approved while sitting on
  // this screen saw no change until they navigated away and back. Updates
  // `rider` directly rather than going through applyRider(), which would
  // otherwise stomp whatever the rider is mid-typing into the form below.
  useLivePolling(
    () => {
      api
        .myRiderProfile()
        .then((res) => setRider(res.rider))
        .catch(() => {});
    },
    8000,
    [],
  );

  // Google sign-up already has a verified email on the account — carry it
  // into this field instead of leaving it blank for the rider to retype.
  // Only applies while the field is still untouched, so it never clobbers
  // something they've since edited.
  useEffect(() => {
    if (user?.email && !email) setEmail(user.email);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  useEffect(() => {
    if (!user || !rider?.profile_photo_key) {
      setPhotoUrl(null);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .riderPhotoBlob(user.id)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setPhotoUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [user, rider?.profile_photo_key]);

  function applyRider(r: Rider | null) {
    setRider(r);
    if (!r) return;
    setFirstName(r.first_name ?? "");
    setLastName(r.last_name ?? "");
    setAltPhone(r.alt_phone ?? "");
    setVehicleInfo(r.vehicle_info ?? "");
    setStageAddress(r.stage_address ?? "");
    setStageArea(r.area ?? "");
    setStageCoords(r.stage_lat != null && r.stage_lng != null ? { lat: r.stage_lat, lng: r.stage_lng } : null);
    setHomeAddress(r.home_address ?? "");
    setStageName(r.stage_name ?? "");
    setStageChairmanName(r.stage_chairman_name ?? "");
    setStageChairmanContact(r.stage_chairman_contact ?? "");
    setEmergencyContactName(r.emergency_contact_name ?? "");
    setEmergencyContactPhone(r.emergency_contact_phone ?? "");
    setMomoMsisdn(r.momo_msisdn ?? "");
  }

  const complete = isRiderProfileComplete(rider);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await api.applyAsRider({
        area: stageArea || undefined,
        vehicleInfo: vehicleInfo || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        email: email || undefined,
        altPhone: altPhone || undefined,
        stageAddress: stageAddress || undefined,
        homeAddress: homeAddress || undefined,
        stageLat: stageCoords?.lat,
        stageLng: stageCoords?.lng,
        stageName: stageName || undefined,
        stageChairmanName: stageChairmanName || undefined,
        stageChairmanContact: stageChairmanContact || undefined,
        emergencyContactName: emergencyContactName || undefined,
        emergencyContactPhone: emergencyContactPhone || undefined,
        momoMsisdn: momoMsisdn || undefined,
      });
      applyRider(res.rider);
      setSaved(true);
      await refreshRider();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPickIdFile(file: File) {
    setUploadingId(true);
    setError(null);
    try {
      // Kept larger/higher-quality than a casual photo — this has to stay
      // legible enough for an admin to actually verify the ID against.
      // compressImage() passes a PDF through untouched.
      const compressed = await compressImage(file, { maxDimension: 1600, quality: 0.82 });
      const res = await api.uploadRiderIdDocument(compressed);
      applyRider(res.rider);
      await refreshRider();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploadingId(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function onPickPhotoFile(file: File) {
    setUploadingPhoto(true);
    setError(null);
    try {
      const compressed = await compressImage(file, { maxDimension: 640 });
      const res = await api.uploadRiderProfilePhoto(compressed);
      applyRider(res.rider);
      await refreshRider();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setUploadingPhoto(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">{t("account_title")}</h1>

      <section className="home-card flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <User className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-bold text-ink">{user?.name ?? "—"}</span>
          <span className="block text-sm text-ink-500">{user?.phone}</span>
        </span>
        {rider && (
          <span
            className={`ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
              rider.verified ? "bg-green/15 text-green" : "bg-[rgb(var(--surface-muted))] text-ink-500"
            }`}
          >
            {rider.verified ? t("acc_verified") : t("acc_pending")}
          </span>
        )}
      </section>

      <SubscriptionCard />

      <PracticeModeCard role="rider" />

      <AppearanceSettings />

      <LanguageSettings />

      <ChangePasswordPanel />

      {complete && rider && !rider.verified && (
        <div className="home-card flex items-center gap-3 !border-l-4 !border-l-gold">
          <p className="text-sm text-ink-500">{t("acc_profile_waiting")}</p>
        </div>
      )}

      {!complete && (
        <div className="home-card flex items-center gap-3 !border-l-4 !border-l-gold">
          <p className="text-sm text-ink-500">{t("acc_profile_incomplete")}</p>
        </div>
      )}

      <form onSubmit={onSubmit} className="space-y-5">
        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">{t("acc_personal_details")}</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("acc_first_name")} value={firstName} onChange={setFirstName} placeholder="Juma" required />
            <Field label={t("acc_last_name")} value={lastName} onChange={setLastName} placeholder="Okello" required />
          </div>
          <Field label={t("acc_email_optional")} value={email} onChange={setEmail} placeholder="you@example.com" type="email" />
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-ink-500">{t("acc_phone")}</label>
              <input
                disabled
                value={user?.phone ?? ""}
                className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3 py-2.5 text-[15px] text-ink-500 outline-none"
              />
            </div>
            <Field
              label={t("acc_alt_phone")}
              value={altPhone}
              onChange={setAltPhone}
              placeholder="+256700000000"
            />
          </div>
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">{t("acc_vehicle")}</h2>
          <Field
            label={t("acc_moto_reg")}
            value={vehicleInfo}
            onChange={setVehicleInfo}
            placeholder="UBG 123X"
            required
          />
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">{t("acc_locations")}</h2>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-500">
              {t("acc_stage_location")} <span className="text-red-500">*</span>
            </label>
            <button
              type="button"
              onClick={() => setShowMap(true)}
              className="flex w-full items-center gap-2 rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-left text-[15px] text-ink"
            >
              <MapPin className="h-4 w-4 shrink-0 text-gold" strokeWidth={2} aria-hidden />
              <span className="truncate">{stageAddress || t("acc_set_stage_map")}</span>
            </button>
          </div>
          <Field label={t("acc_home_address")} value={homeAddress} onChange={setHomeAddress} placeholder="Ntinda, Kampala" required />
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">{t("acc_stage_details")}</h2>
          <Field label={t("acc_stage_name")} value={stageName} onChange={setStageName} placeholder="Ntinda Trading Center Stage" required />
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("acc_stage_chairman_name")}
              value={stageChairmanName}
              onChange={setStageChairmanName}
              placeholder="Chairman's full name"
              required
            />
            <Field
              label={t("acc_stage_chairman_contact")}
              value={stageChairmanContact}
              onChange={setStageChairmanContact}
              placeholder="+256700000000"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label={t("acc_emergency_name")}
              value={emergencyContactName}
              onChange={setEmergencyContactName}
              placeholder="Next of kin"
              required
            />
            <Field
              label={t("acc_emergency_phone")}
              value={emergencyContactPhone}
              onChange={setEmergencyContactPhone}
              placeholder="+256700000000"
              required
            />
          </div>
        </section>

        <section className="home-card space-y-3">
          <h2 className="text-sm font-semibold text-ink">{t("acc_payout")}</h2>
          <p className="text-xs text-ink-500">{t("acc_save_numbers")}</p>
          <MobileNumberManager purpose="withdrawal" />
          <details className="text-xs text-ink-500">
            <summary className="cursor-pointer font-semibold">{t("acc_legacy_number")}</summary>
            <div className="mt-2 space-y-1">
              <Field
                label={t("acc_momo_number")}
                value={momoMsisdn}
                onChange={setMomoMsisdn}
                placeholder="0772345678"
              />
              {detectedNetwork && (
                <p className="px-1 text-xs font-semibold text-ink-500">
                  {mobileMoneyNetworkLabel(detectedNetwork)} {t("acc_network_detected")}
                </p>
              )}
              <p className="px-1 text-xs text-ink-500">{t("acc_fallback_note")}</p>
            </div>
          </details>
        </section>

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {saved && <p className="text-sm font-medium text-green">{t("acc_saved")}</p>}

        <button
          type="submit"
          disabled={busy}
          className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
        >
          {busy ? t("acc_saving") : t("acc_save_profile")}
        </button>
      </form>

      <section className="home-card space-y-3">
        <h2 className="text-sm font-semibold text-ink">
          {t("acc_profile_photo")} <span className="text-red-500">*</span>
        </h2>
        <p className="text-xs text-ink-500">{t("acc_photo_note")}</p>
        <div className="flex items-center gap-3">
          {photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt="Your profile photo"
              className="h-16 w-16 shrink-0 rounded-full object-cover"
            />
          ) : (
            <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--surface-muted))] text-ink-500">
              <User className="h-7 w-7" strokeWidth={1.5} aria-hidden />
            </span>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void onPickPhotoFile(file);
            }}
          />
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            disabled={uploadingPhoto}
            className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink disabled:opacity-60"
          >
            {rider?.profile_photo_key ? (
              <CheckCircle2 className="h-4 w-4 text-green" strokeWidth={2} aria-hidden />
            ) : (
              <Upload className="h-4 w-4" strokeWidth={2} aria-hidden />
            )}
            {uploadingPhoto ? t("acc_uploading") : rider?.profile_photo_key ? t("acc_uploaded_replace") : t("acc_add_photo")}
          </button>
        </div>
      </section>

      <section className="home-card space-y-3">
        <h2 className="text-sm font-semibold text-ink">
          {t("acc_national_id")} <span className="text-red-500">*</span>
        </h2>
        <p className="text-xs text-ink-500">{t("acc_id_note")}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onPickIdFile(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingId}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink disabled:opacity-60"
        >
          {rider?.national_id_key ? (
            <CheckCircle2 className="h-4 w-4 text-green" strokeWidth={2} aria-hidden />
          ) : (
            <Upload className="h-4 w-4" strokeWidth={2} aria-hidden />
          )}
          {uploadingId ? t("acc_uploading") : rider?.national_id_key ? t("acc_uploaded_replace") : t("acc_attach_id")}
        </button>
      </section>

      {showSavingsLink && (
        <Link
          href="/savings"
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
        >
          <PiggyBank className="h-4 w-4" strokeWidth={2} aria-hidden />
          Stage savings
        </Link>
      )}

      <button
        onClick={logout}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden />
        {t("log_out")}
      </button>

      <CloseAccountCard onClosed={logout} />

      {showMap && (
        <LocationMapPicker
          initial={stageCoords ?? undefined}
          onCancel={() => setShowMap(false)}
          onConfirm={(loc) => {
            setStageCoords({ lat: loc.lat, lng: loc.lng });
            setStageAddress(loc.address ?? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
            setStageArea(loc.area ?? "");
            setShowMap(false);
          }}
        />
      )}
    </div>
  );
}

const CADENCE_KEYS: Record<string, "cadence_daily" | "cadence_weekly" | "cadence_monthly"> = {
  daily: "cadence_daily",
  weekly: "cadence_weekly",
  monthly: "cadence_monthly",
};

/**
 * Self-contained: fetches its own subscription state and renders nothing
 * when the admin hasn't turned a subscription requirement on at all. Same
 * pay-then-poll pattern as ../wallet/page.tsx's withdrawal flow, since
 * sandbox/mock mobile money has no webhook to push a result back.
 */
function SubscriptionCard() {
  const t = useTranslate();
  const [subscription, setSubscription] = useState<RiderSubscriptionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const polling = useRef(false);
  const pendingIdRef = useRef<string | null>(null);

  const load = useCallback(() => {
    return api.myRiderSubscription().then((res) => {
      setSubscription(res.subscription);
      return res;
    });
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  useEffect(() => {
    const id = pendingIdRef.current;
    if (!id || polling.current) return;
    polling.current = true;
    const interval = setInterval(async () => {
      try {
        const res = await api.refreshSubscriptionPayment(id);
        if (res.payment.status !== "pending") {
          pendingIdRef.current = null;
          await load();
        }
      } catch {
        // keep polling — a transient error shouldn't stop it
      }
    }, 4000);
    return () => {
      clearInterval(interval);
      polling.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription, load]);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.paySubscription();
      pendingIdRef.current = res.paymentId;
      polling.current = false; // let the effect above pick the new id up
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (!subscription || !subscription.required) return null;

  if (subscription.current) {
    return (
      <section className="home-card flex items-center gap-3 !border-l-4 !border-l-green">
        <CheckCircle2 className="h-5 w-5 shrink-0 text-green" strokeWidth={1.75} aria-hidden />
        <p className="text-sm text-ink-500">
          {subscription.mode === "once"
            ? t("acc_sub_paid_once")
            : subscription.paidThrough
              ? t("acc_sub_active_through", {
                  date: new Date(subscription.paidThrough).toLocaleDateString(),
                  amount: subscription.amount.toLocaleString(),
                  cadence: t(CADENCE_KEYS[subscription.cadence]),
                })
              : t("acc_sub_active", {
                  amount: subscription.amount.toLocaleString(),
                  cadence: t(CADENCE_KEYS[subscription.cadence]),
                })}
        </p>
      </section>
    );
  }

  const isPending = !!pendingIdRef.current;
  return (
    <section className="home-card space-y-2.5 !border-l-4 !border-l-gold">
      <p className="text-sm font-semibold text-ink">
        {subscription.status === "past_due" ? t("acc_sub_failed") : t("acc_sub_activate")}
      </p>
      <p className="text-sm text-ink-500">
        {subscription.mode === "once"
          ? t("acc_sub_pay_once", { amount: subscription.amount.toLocaleString() })
          : t("acc_sub_pay_recurring", {
              amount: subscription.amount.toLocaleString(),
              cadence: t(CADENCE_KEYS[subscription.cadence]),
            })}
      </p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <button
        onClick={pay}
        disabled={busy || isPending}
        className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
      >
        {isPending ? t("acc_sub_confirming") : busy ? t("acc_sub_sending") : t("acc_sub_pay", { amount: subscription.amount.toLocaleString() })}
      </button>
    </section>
  );
}

/**
 * Pays out the rider's entire wallet balance — reserve included, unlike a
 * normal withdrawal — then locks the account. Refused server-side if
 * there's a job in flight. A confirm step first since this is
 * irreversible from here (only support/admin can reopen a closed account).
 */
function CloseAccountCard({ onClosed }: { onClosed: () => void }) {
  const t = useTranslate();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function close() {
    setBusy(true);
    setError(null);
    try {
      await api.closeRiderAccount();
      onClosed();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-red-200 px-4 text-sm font-bold text-red-600"
      >
        <TriangleAlert className="h-4 w-4" strokeWidth={2} aria-hidden />
        {t("acc_close_account")}
      </button>
    );
  }

  return (
    <section className="home-card space-y-2.5 !border-l-4 !border-l-red-400">
      <p className="text-sm font-semibold text-ink">{t("acc_close_confirm_title")}</p>
      <p className="text-sm text-ink-500">{t("acc_close_confirm_note")}</p>
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={close}
          disabled={busy}
          className="min-h-9 flex-1 rounded-full bg-red-600 px-4 text-xs font-bold text-white disabled:opacity-60"
        >
          {busy ? t("acc_closing") : t("acc_yes_close")}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="min-h-9 flex-1 rounded-full border border-[var(--border-faint)] px-4 text-xs font-bold text-ink disabled:opacity-60"
        >
          {t("acc_cancel")}
        </button>
      </div>
    </section>
  );
}
