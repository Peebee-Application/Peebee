"use client";

import { FOOD_BUSINESS_TYPES, type FoodBusinessType } from "@peebee/shared";
import type { Restaurant } from "@peebee/shared";
import { LogOut, MapPin, Store, User } from "lucide-react";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { AppearanceSettings } from "../../components/AppearanceSettings";
import { CoverEditor } from "../../components/CoverEditor";
import { LogoEditor } from "../../components/LogoEditor";
import { BusinessStyleEditor } from "../../components/BusinessStyleEditor";
import { ChangePasswordPanel } from "../../components/ChangePasswordPanel";
import { LanguageSettings } from "../../components/LanguageSettings";
import { PracticeModeCard } from "../../components/PracticeMode";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-semibold text-ink-500">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
      />
    </div>
  );
}

const STATUS_LABEL: Record<Restaurant["status"], string> = {
  pending_approval: "Pending approval",
  active: "Active",
  suspended: "Suspended",
};

export default function AccountPage() {
  const { user, restaurant: authRestaurant, refreshRestaurant, logout } = useAuth();
  const [restaurant, setRestaurant] = useState<Restaurant | null>(authRestaurant);

  const [businessType, setBusinessType] = useState<FoodBusinessType | "">("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [showMap, setShowMap] = useState(false);
  const [openTime, setOpenTime] = useState("");
  const [closeTime, setCloseTime] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api
      .myRestaurant()
      .then((res) => applyRestaurant(res.restaurant))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyRestaurant(r: Restaurant) {
    setRestaurant(r);
    setName(r.name);
    setBusinessType(r.business_type ?? "restaurant");
    setDescription(r.description ?? "");
    setCuisine(r.cuisine ?? "");
    setPhone(r.phone ?? "");
    setAddress(r.address ?? "");
    if (r.lat != null && r.lng != null) setCoords({ lat: r.lat, lng: r.lng });
    setOpenTime(r.open_time ?? "");
    setCloseTime(r.close_time ?? "");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      if (!businessType) throw new Error("Choose your food business type.");
      const input = {
        businessType,
        name,
        description: description || undefined,
        cuisine: cuisine || undefined,
        phone: phone || undefined,
        address: address || undefined,
        lat: coords?.lat,
        lng: coords?.lng,
        openTime: openTime || null,
        closeTime: closeTime || null,
      };
      const res = restaurant ? await api.updateRestaurant(input) : await api.applyAsRestaurant(input);
      applyRestaurant(res.restaurant);
      await refreshRestaurant();
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function toggleOpen(isOpen: boolean) {
    if (!restaurant) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.updateRestaurant({ isOpen });
      applyRestaurant(res.restaurant);
      await refreshRestaurant();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5 px-4 pb-6 pt-4">
      <h1 className="text-xl font-bold text-ink">Account</h1>

      <section className="home-card flex items-center gap-3">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-gold/15 text-gold">
          <User className="h-6 w-6" strokeWidth={1.75} aria-hidden />
        </span>
        <span>
          <span className="block text-[15px] font-bold text-ink">{user?.name ?? "—"}</span>
          <span className="block text-sm text-ink-500">{user?.phone ?? user?.email}</span>
        </span>
      </section>

      {restaurant && (
        <section className="home-card flex items-center gap-3">
          <span
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
              restaurant.status === "active" ? "bg-green/15 text-green" : "bg-gold/15 text-gold"
            }`}
          >
            <Store className="h-4.5 w-4.5" strokeWidth={1.75} aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-ink">{STATUS_LABEL[restaurant.status]}</span>
            {restaurant.status === "pending_approval" && (
              <span className="block text-xs text-ink-500">
                An admin needs to approve your food business before customers can see it.
              </span>
            )}
            {restaurant.status === "suspended" && (
              <span className="block text-xs text-ink-500">Contact support if you think this is a mistake.</span>
            )}
          </span>
          {restaurant.status === "active" && (
            <label className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-semibold text-ink-500">{restaurant.is_open ? "Open" : "Closed"}</span>
              <input
                type="checkbox"
                checked={!!restaurant.is_open}
                onChange={(e) => toggleOpen(e.target.checked)}
                disabled={busy}
                className="h-5 w-9 shrink-0 accent-gold"
              />
            </label>
          )}
        </section>
      )}

      {restaurant&&<CoverEditor restaurant={restaurant} onSaved={async()=>{const res=await api.myRestaurant();setRestaurant(res.restaurant);await refreshRestaurant();}}/>}
      {restaurant&&<LogoEditor restaurant={restaurant} onSaved={async()=>{const res=await api.myRestaurant();setRestaurant(res.restaurant);await refreshRestaurant();}}/>}
      {restaurant&&<BusinessStyleEditor restaurant={restaurant} onSaved={async()=>{const res=await api.myRestaurant();setRestaurant(res.restaurant);await refreshRestaurant();}}/>}
      <form onSubmit={submit} className="home-card space-y-3">
        <h2 className="text-sm font-semibold text-ink">{restaurant ? "Food business profile" : "Register your food business"}</h2>
        <fieldset className="food-type-picker"><legend className="mb-3 text-sm font-semibold">What kind of food business do you run?</legend><div className="grid grid-cols-2 gap-3">{FOOD_BUSINESS_TYPES.map(type => <label key={type.value} className={`food-type-option ${businessType === type.value ? "selected" : ""}`}><input type="radio" name="businessType" required value={type.value} checked={businessType === type.value} onChange={() => setBusinessType(type.value)} /><span className="block font-bold">{type.label}</span><span className="mt-1 block text-xs text-ink-500">{type.description}</span></label>)}</div></fieldset>
        <Field label="Name" value={name} onChange={setName} placeholder="e.g. Kampala Kitchen" required />
        <Field label="Cuisine" value={cuisine} onChange={setCuisine} placeholder="e.g. Ugandan, fast food, pizza" />
        <Field label="Description" value={description} onChange={setDescription} placeholder="A short line about your food business" />
        <Field label="Phone" value={phone} onChange={setPhone} placeholder="+256…" />
        <Field label="Address" value={address} onChange={setAddress} placeholder="Street, area" />

        <div className="space-y-1">
          <label className="text-xs font-semibold text-ink-500">Scheduled hours (optional)</label>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={openTime}
              onChange={(e) => setOpenTime(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
            <span className="text-sm text-ink-500">to</span>
            <input
              type="time"
              value={closeTime}
              onChange={(e) => setCloseTime(e.target.value)}
              className="w-full rounded-xl border border-[var(--border-faint)] px-3 py-2.5 text-[15px] outline-none focus:border-gold"
            />
          </div>
          <p className="text-xs text-ink-500">
            Your business opens and closes automatically at these times (Uganda time), even when the app is closed.
            A manual change lasts until the next scheduled opening or closing time. Leave both empty for manual control.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowMap(true)}
          className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
        >
          <MapPin className="h-4 w-4" strokeWidth={2} aria-hidden />
          {coords ? "Change pickup location" : "Set pickup location"}
        </button>
        {coords && (
          <p className="text-xs text-ink-500">
            Pinned at {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)} — this is where a rider picks up orders from.
          </p>
        )}

        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        {saved && <p className="text-sm font-medium text-green">Saved.</p>}

        <button
          type="submit"
          disabled={busy || !name.trim() || !businessType}
          className="min-h-11 w-full rounded-full bg-gold px-4 text-sm font-bold text-ink-gold disabled:opacity-60"
        >
          {busy ? "Saving…" : restaurant ? "Save changes" : "Register food business"}
        </button>
      </form>

      <PracticeModeCard role="restaurant" />
      {!restaurant&&<AppearanceSettings />}
      <LanguageSettings />
      <ChangePasswordPanel />

      <button
        onClick={logout}
        className="flex min-h-11 w-full items-center justify-center gap-2 rounded-full border border-[var(--border-faint)] px-4 text-sm font-bold text-ink"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} aria-hidden />
        Log out
      </button>

      {showMap && (
        <LocationMapPicker
          initial={coords ?? undefined}
          onCancel={() => setShowMap(false)}
          onConfirm={(loc) => {
            setCoords({ lat: loc.lat, lng: loc.lng });
            setAddress(loc.address ?? `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`);
            setShowMap(false);
          }}
        />
      )}
    </div>
  );
}
