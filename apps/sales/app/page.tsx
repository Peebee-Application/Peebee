"use client";

import {
  FOOD_BUSINESS_TYPES,
  ONBOARDING_TYPES,
  type ActivationChannel,
  type OnboardingRecord,
  type OnboardingType,
} from "@peebee/shared";
import { Select } from "@peebee/shared/select";
import {
  ArrowLeft,
  ArrowRight,
  Bike,
  Building2,
  Camera,
  Car,
  Check,
  CheckCircle2,
  FileText,
  Fuel,
  GraduationCap,
  LocateFixed,
  LogOut,
  Plus,
  Pill,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  UserRound,
  Utensils,
  LifeBuoy,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { BottomNav } from "../components/BottomNav";
import { BrandLogo } from "../components/BrandLogo";
import { request, TOKEN_KEY } from "../lib/api";
import { useResolvedTheme } from "../lib/theme";

const labels: Record<OnboardingType, string> = {
  customer: "Customer",
  rider: "Boda Rider",
  partner: "Car Partner",
  restaurant: "Food & Restaurant",
  merchant: "Store & Merchant",
  gas: "Fuel Station",
  pharmacy: "Pharmacy & Health",
  education: "School & Education",
};

const subtitles: Record<OnboardingType, string> = {
  customer: "Personal shopper, passenger & deliveries",
  rider: "Boda boda hailing, delivery & savings stage",
  partner: "Car drivers, fleet owners & vehicle rentals",
  restaurant: "Restaurants, eateries & commercial kitchens",
  merchant: "Retail stores, shops & supermarkets",
  gas: "Petrol stations, dealers & pump attendants",
  pharmacy: "Licensed pharmacies, chemists & drug shops",
  education: "Schools, academies, tutors & vocational institutes",
};

const icons = {
  customer: UserRound,
  rider: Bike,
  partner: Car,
  restaurant: Utensils,
  merchant: Store,
  gas: Fuel,
  pharmacy: Pill,
  education: GraduationCap,
};

type Draft = {
  profile: Record<string, string | number | boolean>;
  files: Record<string, File>;
};

const emptyDrafts = (): Record<OnboardingType, Draft> => ({
  customer: { profile: {}, files: {} },
  rider: { profile: {}, files: {} },
  partner: { profile: { partnerRole: "driver", needsVehicle: false }, files: {} },
  restaurant: { profile: { businessType: "restaurant" }, files: {} },
  merchant: { profile: {}, files: {} },
  gas: { profile: { activePumps: 4, managerRole: "station_manager" }, files: {} },
  pharmacy: { profile: { ndaVerified: true }, files: {} },
  education: { profile: { institutionType: "k12_school" }, files: {} },
});

const riderFields = [
  ["firstName", "First name"],
  ["lastName", "Last name"],
  ["vehicleInfo", "Motorcycle registration plate"],
  ["stageName", "Stage name"],
  ["stageAddress", "Stage address"],
  ["homeAddress", "Home address"],
  ["stageChairmanName", "Stage chairman name"],
  ["stageChairmanContact", "Chairman phone number"],
  ["emergencyContactName", "Emergency contact name"],
  ["emergencyContactPhone", "Emergency contact phone"],
  ["momoMsisdn", "Mobile money payout number"],
] as const;

export default function Sales() {
  const activeTheme = useResolvedTheme();
  const isDarkMode = activeTheme === "dark";

  const [me, setMe] = useState<{ user: { name: string }; superAdmin: boolean } | null>(null);
  const [records, setRecords] = useState<OnboardingRecord[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);

  // Tab & Step navigation
  const [tab, setTab] = useState<"new" | "records">("new");
  const [step, setStep] = useState<number>(1);
  const [type, setType] = useState<OnboardingType>("customer");

  // Form states
  const [drafts, setDrafts] = useState<Record<OnboardingType, Draft>>(emptyDrafts);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState<ActivationChannel>("auto");
  const [consent, setConsent] = useState(false);
  const [defer, setDefer] = useState(false);

  // Status & loading
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState("");
  const [recordFilter, setRecordFilter] = useState<string>("all");
  const [recordSearch, setRecordSearch] = useState("");
  const [recordLimit, setRecordLimit] = useState(10);
  const [successInfo, setSuccessInfo] = useState<{
    name: string;
    type: OnboardingType;
    channel: string;
    sent: boolean;
  } | null>(null);

  const requestId = useRef("");
  useEffect(() => { window.scrollTo({ top: 0 }); }, [step, tab]);
  const draft = drafts[type];

  const totalSteps = type === "customer" ? 3 : 5;

  const load = useCallback(async () => {
    const data = await request<{ records: OnboardingRecord[] }>("/sales/onboarding");
    setRecords(data.records);
  }, []);

  useEffect(() => {
    let alive = true;
    requestId.current = crypto.randomUUID();
    if (!localStorage.getItem(TOKEN_KEY)) {
      window.location.replace("/login");
      return;
    }
    request<{ status: string }>("/sales-access/status")
      .then(async (access) => {
        if (!alive) return;
        if (access.status !== "approved") {
          window.location.replace("/approval");
          return;
        }
        const [session, catData] = await Promise.all([
          request<{ user: { name: string }; superAdmin: boolean }>("/sales/me"),
          request<{ categories: Array<{ id: string; name: string }> }>("/sales/categories"),
        ]);
        if (alive) {
          setMe(session);
          setCategories(catData.categories);
          await load();
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  function profile(key: string, value: string | number | boolean) {
    setDrafts((old) => ({
      ...old,
      [type]: {
        ...old[type],
        profile: { ...old[type].profile, [key]: value },
      },
    }));
  }

  function file(key: string, value: File | undefined) {
    setDrafts((old) => {
      const files = { ...old[type].files };
      if (value) files[key] = value;
      else delete files[key];
      return { ...old, [type]: { ...old[type], files } };
    });
  }

  // Automatic Step Transition when an account type is chosen
  function handleSelectType(selectedType: OnboardingType) {
    setType(selectedType);
    setError("");
    setNotice("");
    setStep(2);
  }

  async function locate() {
    setError("");
    if (!navigator.geolocation) {
      setError("Location is unavailable on this device. Enter the coordinates manually below.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDrafts((old) => ({
          ...old,
          [type]: {
            ...old[type],
            profile: {
              ...old[type].profile,
              lat: Number(position.coords.latitude.toFixed(6)),
              lng: Number(position.coords.longitude.toFixed(6)),
            },
          },
        }));
      },
      () => setError("Could not capture GPS location. Enter the coordinates manually below."),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  function validateStep2(): boolean {
    if (!name.trim()) {
      setError("Full name is required.");
      return false;
    }
    if (!phone.trim() && !email.trim()) {
      setError("Provide at least a phone number or an email address.");
      return false;
    }
    if (channel === "email" && !email.trim()) {
      setError("Email address is required for Email activation.");
      return false;
    }
    if ((channel === "sms" || channel === "whatsapp") && !phone.trim()) {
      setError(`Phone number is required for ${channel === "sms" ? "SMS" : "WhatsApp"} activation.`);
      return false;
    }
    setError("");
    return true;
  }

  function validateStep3(): boolean {
    if (defer) {
      setError("");
      return true;
    }
    if (type === "restaurant" && !draft.profile.businessName) {
      setError("Business / restaurant name is required.");
      return false;
    }
    if (type === "merchant") {
      if (!draft.profile.businessName) {
        setError("Store / merchant name is required.");
        return false;
      }
      if (!draft.profile.categoryId) {
        setError("Please select a store category.");
        return false;
      }
    }
    if (type === "gas" && !draft.profile.stationBrand && !draft.profile.businessName) {
      setError("Fuel station brand or station name is required.");
      return false;
    }
    setError("");
    return true;
  }

  function goNextFromStep2() {
    if (!validateStep2()) return;
    if (type === "customer") {
      setStep(3); // For customer, step 3 is the final Review & Consent
    } else {
      setStep(3); // For others, step 3 is Role & Profile details
    }
  }

  function goNextFromStep3() {
    if (!validateStep3()) return;
    setStep(4); // Advance to Location & Documents
  }

  function goNextFromStep4() {
    setError("");
    setStep(5); // Advance to Review & Consent
  }

  function handleBack() {
    setError("");
    if (step > 1) {
      setStep(step - 1);
    }
  }

  function resetRegistration() {
    setName("");
    setPhone("");
    setEmail("");
    setConsent(false);
    setDefer(false);
    setDrafts(emptyDrafts());
    setError("");
    setNotice("");
    setSuccessInfo(null);
    requestId.current = crypto.randomUUID();
    setStep(1);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");

    const selectedType = type;
    try {
      const form = new FormData();
      const cleanProfile = Object.fromEntries(
        Object.entries(draft.profile).filter(([, value]) => value !== "" && value !== undefined),
      );
      form.set(
        "data",
        JSON.stringify({
          requestId: requestId.current,
          accountType: selectedType,
          name: name.trim(),
          phone: phone.trim() || undefined,
          email: email.trim() || undefined,
          preferredChannel: channel,
          consent: true,
          profile: cleanProfile,
        }),
      );
      for (const [key, value] of Object.entries(draft.files)) {
        form.set(key, value);
      }

      const result = await request<{
        delivery?: { sent: boolean; channel?: string };
        replayed?: boolean;
      }>("/sales/onboarding", { method: "POST", body: form });

      setSuccessInfo({
        name: name.trim(),
        type: selectedType,
        channel: result.delivery?.channel ?? channel,
        sent: !!result.delivery?.sent,
      });

      setStep(6); // Success screen
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete account registration.");
    } finally {
      setBusy(false);
    }
  }

  async function resend(id: string) {
    setRetry(id);
    setError("");
    setNotice("");
    try {
      const res = await request<{ delivery: { sent: boolean; channel?: string } }>(
        `/sales/onboarding/${id}/resend`,
        { method: "POST" },
      );
      setNotice(
        res.delivery.sent
          ? "Activation message sent successfully."
          : "Account saved, but messaging provider could not confirm delivery.",
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send activation.");
    } finally {
      setRetry("");
    }
  }

  function field(key: string, labelText: string, required = false, kind = "text", placeholder = "") {
    return (
      <label key={key} className="block text-base font-bold">
        {labelText}
        <input
          type={kind}
          step={kind === "number" ? "any" : undefined}
          required={required && !defer}
          placeholder={placeholder}
          value={String(draft.profile[key] ?? "")}
          onChange={(e) =>
            profile(
              key,
              kind === "number" && e.target.value !== "" ? Number(e.target.value) : e.target.value,
            )
          }
          className="sales-input mt-2"
        />
      </label>
    );
  }

  function upload(key: string, uploadLabel: string, required = false, photoOnly = false) {
    return (
      <label className="block text-base font-bold">
        {uploadLabel}
        <input
          key={`${type}-${key}-${requestId.current}`}
          type="file"
          accept={
            photoOnly
              ? "image/jpeg,image/png,image/webp"
              : "image/jpeg,image/png,image/webp,application/pdf"
          }
          required={required && !defer && !draft.files[key]}
          onChange={(e) => file(key, e.target.files?.[0])}
          className="sales-input mt-2 text-base"
        />
        <span className="mt-1 block text-xs font-normal text-ink-500">
          {photoOnly ? "JPG, PNG or WebP, up to 4 MB" : "JPG, PNG, WebP or PDF, up to 8 MB"}
          {draft.files[key] ? ` · Attached: ${draft.files[key].name}` : ""}
        </span>
      </label>
    );
  }

  const activatedCount = records.filter((r) => r.activated_at).length;
  const ActiveTypeIcon = icons[type];

  // Records filtering
  const filteredRecords = records.filter((r) => {
    if (recordFilter !== "all" && r.account_type !== recordFilter) return false;
    if (recordSearch.trim()) {
      const q = recordSearch.toLowerCase();
      const matchName = r.name?.toLowerCase().includes(q);
      const matchEmail = r.email?.toLowerCase().includes(q);
      const matchPhone = r.phone?.toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchPhone) return false;
    }
    return true;
  });

  return (
    <div className="min-h-dvh">
      {/* Brand Header */}
      <header className="customer-header sticky top-0 z-40 transition-colors">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <div className="flex items-center gap-2">
            <BrandLogo variant={isDarkMode ? "dark" : "light"} />
            <sup
              aria-hidden="true"
              className={`pt-1 text-[10px] font-black uppercase tracking-widest ${
                isDarkMode ? "text-black" : "text-gold"
              }`}
            >
              Sales
            </sup>
          </div>
          <div className="flex items-center gap-3">
            <span
              className={`hidden text-sm font-semibold sm:block ${
                isDarkMode ? "text-black/80" : "text-white/80"
              }`}
            >
              {me?.user.name}
            </span>
            <a
              href="/help"
              aria-label="Help and support"
              className={`rounded-full p-2 transition ${
                isDarkMode ? "text-black hover:bg-black/10" : "text-white hover:bg-white/10"
              }`}
            >
              <LifeBuoy size={18} />
            </a>
            <button
              aria-label="Sign out"
              onClick={() => {
                localStorage.removeItem(TOKEN_KEY);
                window.location.replace("/login");
              }}
              className={`rounded-full p-2 transition ${
                isDarkMode ? "text-black hover:bg-black/10" : "text-white hover:bg-white/10"
              }`}
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-4xl px-4 py-6 pb-[calc(96px+env(safe-area-inset-bottom))] sm:px-6">
        {/* Stats */}
        {(tab === "records" || step === 1) && (
        <div className="mb-4 grid grid-cols-2 gap-3">
          <div className="home-card !p-4 text-center">
            <strong className="block text-4xl font-black tabular-nums">{records.length}</strong>
            <p className="text-base font-semibold text-ink-500">Registered</p>
          </div>
          <div className="home-card !p-4 text-center">
            <strong className="block text-4xl font-black tabular-nums text-green">{activatedCount}</strong>
            <p className="text-base font-semibold text-ink-500">Activated</p>
          </div>
        </div>
        )}

        {notice && (
          <div
            role="status"
            className="mb-5 flex items-center gap-3 rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface))] p-4 text-sm"
          >
            <Check size={20} className="text-gold shrink-0" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="mb-5 rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-600 dark:text-red-400"
          >
            {error}
          </div>
        )}

        {!me && !error ? (
          <p role="status" className="py-12 text-center text-sm font-semibold">
            Loading your sales agent workspace…
          </p>
        ) : tab === "new" ? (
          <div>
            {/* STEP 1: Select User Type */}
            {step === 1 && (
              <section className="space-y-6">
                <h2 className="text-2xl font-black">Who are you registering?</h2>

                <div
                  role="group"
                  aria-label="Account types"
                  className="grid grid-cols-2 gap-3 lg:grid-cols-4"
                >
                  {ONBOARDING_TYPES.map((value) => {
                    const Icon = icons[value];
                    const isCurrent = type === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        onClick={() => handleSelectType(value)}
                        className={`group relative flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl border p-3 text-center transition-all duration-200 active:scale-[0.98] ${
                          isCurrent
                            ? "border-gold bg-gold/10 shadow-sm"
                            : "border-[var(--border-faint)] bg-[rgb(var(--surface))] hover:border-gold/40"
                        }`}
                      >
                        <div
                          className={`flex h-14 w-14 items-center justify-center rounded-2xl transition ${
                            isCurrent
                              ? "bg-gold text-ink-gold"
                              : "bg-[rgb(var(--surface-input))] text-gold group-hover:bg-gold group-hover:text-ink-gold"
                          }`}
                        >
                          <Icon size={28} />
                        </div>
                        <h3 className="text-lg font-black leading-tight text-ink">{labels[value]}</h3>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* PROGRESS HEADER FOR STEPS 2-5 */}
            {step >= 2 && step <= 5 && (
              <div className="mb-6 space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="flex min-h-12 items-center gap-1.5 text-base font-bold text-ink-500 hover:text-ink"
                  >
                    <ArrowLeft size={22} />
                    <span>Back</span>
                  </button>

                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 rounded-full border border-gold/30 bg-gold/10 px-4 py-1.5 text-base font-bold text-ink">
                      <ActiveTypeIcon size={20} className="text-gold" />
                      <span>{labels[type]}</span>
                    </span>
                    <span className="text-base font-bold text-ink-500">
                      {step}/{totalSteps}
                    </span>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[rgb(var(--surface-input))]">
                  <div
                    className="h-full bg-gold transition-all duration-300 ease-out"
                    style={{ width: `${(step / totalSteps) * 100}%` }}
                  />
                </div>
              </div>
            )}

            {/* STEP 2: Contact Details */}
            {step === 2 && (
              <div className="home-card space-y-6">
                <div>
                  <h2 className="text-2xl font-black">Contact Details</h2>
                </div>

                <div className="space-y-4">
                  <label className="block text-base font-bold">
                    Full name
                    <input
                      required
                      maxLength={80}
                      placeholder="e.g. Grace Semakula"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      autoComplete="off"
                      className="sales-input mt-2"
                    />
                  </label>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-base font-bold">
                      Phone number
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+256 700 000000"
                        autoComplete="off"
                        className="sales-input mt-2"
                      />
                    </label>

                    <label className="block text-base font-bold">
                      Email address
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="name@example.com"
                        autoComplete="off"
                        className="sales-input mt-2"
                      />
                    </label>
                  </div>
                  <p className="text-xs text-ink-500">
                    Provide at least a phone number or email address.
                  </p>

                  <label className="block text-base font-bold">
                    Preferred activation channel
                    <Select
                      value={channel}
                      onValueChange={(val) => setChannel(val as ActivationChannel)}
                      className="mt-2"
                      sizing="stretch"
                    >
                      <option value="auto">Best available channel (Auto)</option>
                      <option value="whatsapp">WhatsApp message</option>
                      <option value="sms">SMS text</option>
                      <option value="email">Email</option>
                    </Select>
                  </label>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-[var(--border-faint)] pt-4 [&>*]:w-full">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="sales-tab"
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={goNextFromStep2}
                    className="sales-primary"
                  >
                    <span>
                      {type === "customer" ? "Review & Confirm" : "Next"}
                    </span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 3: Profile Details (for non-customer types) */}
            {step === 3 && type !== "customer" && (
              <div className="home-card space-y-6">
                <div>
                  <h2 className="text-2xl font-black">
                    {type === "rider"
                      ? "Rider & Stage Profile"
                      : type === "partner"
                      ? "Partner & Vehicle Profile"
                      : type === "gas"
                      ? "Fuel Station & Outlet Profile"
                      : type === "pharmacy"
                      ? "Pharmacy & Chemist Profile"
                      : "Business Profile"}
                  </h2>
                </div>

                {/* Rider fields */}
                {type === "rider" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {riderFields.map(([key, labelText]) =>
                      field(
                        key,
                        labelText,
                        key !== "momoMsisdn",
                        key.toLowerCase().includes("phone") ||
                          (key.includes("Contact") && key !== "emergencyContactName")
                          ? "tel"
                          : "text",
                      ),
                    )}
                  </div>
                )}

                {/* Car Partner fields */}
                {type === "partner" && (
                  <div className="space-y-4">
                    <div>
                      <span className="block text-base font-bold mb-2">Partner role</span>
                      <div className="grid grid-cols-3 gap-2">
                        {(["driver", "owner", "both"] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            onClick={() => profile("partnerRole", r)}
                            className={`sales-tab w-full ${
                              (draft.profile.partnerRole ?? "driver") === r ? "sales-tab-active" : ""
                            }`}
                          >
                            {r === "driver" ? "Car Driver" : r === "owner" ? "Vehicle Owner" : "Both"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {(draft.profile.partnerRole === "driver" ||
                      draft.profile.partnerRole === "both") && (
                      <div className="grid gap-4 sm:grid-cols-2">
                        {field("licenceNumber", "Driving licence number")}
                        {field("licenceExpiry", "Licence expiry date", false, "date")}
                      </div>
                    )}

                    {(draft.profile.partnerRole === "owner" ||
                      draft.profile.partnerRole === "both" ||
                      draft.profile.vehiclePlate) && (
                      <div className="space-y-4 rounded-xl border border-[var(--border-faint)] p-4">
                        <h4 className="text-sm font-bold flex items-center gap-2">
                          <Car size={16} className="text-gold" />
                          Vehicle details (optional)
                        </h4>
                        <div className="grid gap-4 sm:grid-cols-2">
                          {field("vehiclePlate", "Number plate", false, "text", "e.g. UBF 123A")}
                          {field("vehicleMake", "Vehicle make", false, "text", "e.g. Toyota")}
                          {field("vehicleModel", "Vehicle model", false, "text", "e.g. Premio / Wish")}
                          {field("vehicleYear", "Year of manufacture", false, "number", "2018")}
                          {field("vehicleColour", "Colour", false, "text", "e.g. Silver")}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Restaurant fields */}
                {type === "restaurant" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("businessName", "Business name", true, "text", "e.g. Kampala Bistro")}
                    <label className="block text-base font-bold">
                      Food business type
                      <Select
                        required={!defer}
                        value={String(draft.profile.businessType ?? "restaurant")}
                        onValueChange={(val) => profile("businessType", val)}
                        className="mt-2"
                        sizing="stretch"
                      >
                        {FOOD_BUSINESS_TYPES.map((c) => (
                          <option key={c.value} value={c.value}>
                            {c.label}
                          </option>
                        ))}
                      </Select>
                    </label>
                    {field("cuisine", "Cuisine / Specialties", false, "text", "e.g. Local & Fast Food")}
                    {field("address", "Business address", true, "text", "Street, Area, City")}
                    {field("openTime", "Opens at", false, "time")}
                    {field("closeTime", "Closes at", false, "time")}
                  </div>
                )}

                {/* Merchant fields */}
                {type === "merchant" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("businessName", "Store display name", true, "text", "e.g. Fresh Mart")}
                    {field("legalName", "Legal business name", false, "text", "e.g. Fresh Mart Ltd")}
                    {field("outletName", "Outlet branch name", false, "text", "e.g. Main Branch - Nakasero")}
                    <label className="block text-base font-bold">
                      Store category
                      <Select
                        required={!defer}
                        value={String(draft.profile.categoryId ?? "")}
                        onValueChange={(val) => profile("categoryId", val)}
                        className="mt-2"
                        sizing="stretch"
                      >
                        <option value="">Choose category</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <div className="sm:col-span-2">
                      {field("address", "Store address", true, "text", "Plot, Street, Area")}
                    </div>
                  </div>
                )}

                {/* Fuel Station fields */}
                {type === "gas" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("stationBrand", "Station brand", true, "text", "e.g. TotalEnergies, Shell, Rubis")}
                    {field("outletName", "Outlet / Station branch", true, "text", "e.g. Shell Bugolobi")}
                    {field("address", "Physical station address", true, "text", "Jinja Road, Bugolobi")}
                    {field("activePumps", "Active pump count", false, "number", "4")}
                    <label className="block text-base font-bold">
                      Manager role
                      <Select
                        value={String(draft.profile.managerRole ?? "station_manager")}
                        onValueChange={(val) => profile("managerRole", val)}
                        className="mt-2"
                        sizing="stretch"
                      >
                        <option value="station_manager">Station Manager</option>
                        <option value="dealer">Dealer / Owner</option>
                        <option value="supervisor">Supervisor</option>
                      </Select>
                    </label>
                    {field("managerPin", "Default manager PIN", false, "text", "1234")}
                  </div>
                )}

                {/* Pharmacy fields */}
                {type === "pharmacy" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("pharmacyName", "Pharmacy brand / name", true, "text", "e.g. Vine Pharmacy")}
                    {field("ndaLicense", "NDA premises license number", true, "text", "e.g. NDA/PREM/KLA/2026/0418")}
                    {field("supervisingPharmacist", "Supervising pharmacist name", true, "text", "e.g. Dr. Sarah Namubiru")}
                    {field("pharmacistApl", "Pharmacist APL number", true, "text", "e.g. NDA/APL/2026/0418")}
                    <div className="sm:col-span-2">
                      {field("address", "Physical pharmacy address", true, "text", "Plot, Street, Area")}
                    </div>
                  </div>
                )}

                {/* Education fields */}
                {type === "education" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {field("institutionName", "School / Institution Name", true, "text", "e.g. Greenwood Academy")}
                    {field("institutionType", "Institution Category", true, "text", "K-12 School, Vocational, University, Daycare")}
                    {field("principalName", "Headteacher / Principal Name", true, "text", "e.g. Tr. Kenneth Ochieng")}
                    {field("unebCenterNumber", "UNEB / DIT Center Number", false, "text", "e.g. U0842 or UVQF/019")}
                    <div className="sm:col-span-2">
                      {field("address", "School Physical Campus Address", true, "text", "Plot, Street, City")}
                    </div>
                  </div>
                )}

                <div className="flex flex-col-reverse gap-3 border-t border-[var(--border-faint)] pt-4 [&>*]:w-full">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="sales-tab"
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={goNextFromStep3}
                    className="sales-primary"
                  >
                    <span>Next</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: Location & Verification Documents (for non-customer) */}
            {step === 4 && type !== "customer" && (
              <div className="home-card space-y-6">
                <div>
                  <h2 className="text-2xl font-black">Location & Documents</h2>
                </div>

                {/* GPS Pinpoint */}
                <div className="rounded-2xl border border-[var(--border-faint)] p-4 bg-[rgb(var(--surface-input))]">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-bold flex items-center gap-1.5">
                        <LocateFixed size={16} className="text-gold" />
                        GPS Pinpoint Location
                      </h3>
                      <p className="text-xs text-ink-500">Capture accurate on-site coordinates.</p>
                    </div>
                    <button
                      type="button"
                      onClick={locate}
                      className="sales-tab bg-[rgb(var(--surface))]"
                    >
                      <LocateFixed size={16} />
                      Use this device location
                    </button>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    {field("lat", "Latitude", false, "number", "0.347... ")}
                    {field("lng", "Longitude", false, "number", "32.582... ")}
                  </div>
                </div>

                {/* Document Uploads */}
                <div className="space-y-4">
                  <h3 className="text-sm font-bold flex items-center gap-2">
                    <FileText size={16} className="text-gold" />
                    Verification Documents
                  </h3>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {type === "rider" && (
                      <>
                        {upload("riderId", "National ID (Photo / PDF)", false)}
                        {upload("photo", "Face photo / Selfie", false, true)}
                      </>
                    )}
                    {type === "partner" && (
                      <>
                        {upload("partnerId", "National ID / Passport", false)}
                        {upload("drivingLicence", "Driving Licence", false)}
                      </>
                    )}
                    {type === "merchant" && (
                      <>
                        {upload("ownerId", "Owner ID Document", false)}
                        {upload("businessDocument", "Business Registration / License", false)}
                      </>
                    )}
                    {type === "restaurant" && (
                      <>
                        {upload("ownerId", "Manager / Owner ID", false)}
                        {upload("businessDocument", "Health / Trading Permit", false)}
                      </>
                    )}
                    {type === "gas" && (
                      <>
                        {upload("stationDoc", "Station Operating Permit / License", false)}
                        {upload("ownerId", "Manager ID Document", false)}
                      </>
                    )}
                    {type === "pharmacy" && (
                      <>
                        {upload("ndaLicenseDoc", "NDA Premises Certificate", false)}
                        {upload("pharmacistAplDoc", "Pharmacist Practicing License", false)}
                      </>
                    )}
                    {type === "education" && (
                      <>
                        {upload("schoolRegistrationDoc", "Ministry / District School Registration Certificate", false)}
                        {upload("principalId", "Headteacher / Principal ID Document", false)}
                      </>
                    )}
                  </div>

                  <label className="flex items-start gap-3 rounded-xl border border-[var(--border-faint)] p-3 text-sm">
                    <input
                      type="checkbox"
                      checked={defer}
                      onChange={(e) => setDefer(e.target.checked)}
                      className="mt-1"
                    />
                    <span>
                      Some details or documents will be completed later.
                      <span className="block text-xs text-ink-500">
                        The applicant keeps everything captured here and finishes missing items on activation.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="flex flex-col-reverse gap-3 border-t border-[var(--border-faint)] pt-4 [&>*]:w-full">
                  <button
                    type="button"
                    onClick={handleBack}
                    className="sales-tab"
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={goNextFromStep4}
                    className="sales-primary"
                  >
                    <span>Next</span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* STEP 5 (or 3 for Customer): Review & Consent */}
            {((type === "customer" && step === 3) || (type !== "customer" && step === 5)) && (
              <form onSubmit={submit} className="home-card space-y-6">
                <div>
                  <h2 className="text-2xl font-black">Review {labels[type]} Registration</h2>
                </div>

                {/* Summary Card */}
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-5 space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-[var(--border-faint)]">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold text-ink-gold">
                        <ActiveTypeIcon size={20} />
                      </div>
                      <div>
                        <strong className="text-base font-black">{name || "Unnamed"}</strong>
                        <p className="text-xs text-ink-500">{labels[type]} Account</p>
                      </div>
                    </div>
                    <span className="rounded-full bg-gold/20 px-3 py-1 text-xs font-bold text-ink">
                      {channel === "auto" ? "Best Channel" : channel.toUpperCase()}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-4 text-base">
                    <div>
                      <span className="font-semibold text-ink-500">Phone</span>
                      <p className="font-bold text-ink mt-0.5">{phone || "Not provided"}</p>
                    </div>
                    <div>
                      <span className="font-semibold text-ink-500">Email</span>
                      <p className="font-bold text-ink mt-0.5">{email || "Not provided"}</p>
                    </div>

                    {type === "rider" && (
                      <>
                        <div>
                          <span className="font-semibold text-ink-500">Stage</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.stageName || "Not set")}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold text-ink-500">Motorcycle Plate</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.vehicleInfo || "Not set")}
                          </p>
                        </div>
                      </>
                    )}

                    {type === "partner" && (
                      <>
                        <div>
                          <span className="font-semibold text-ink-500">Role</span>
                          <p className="font-bold text-ink mt-0.5 uppercase">
                            {String(draft.profile.partnerRole || "driver")}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold text-ink-500">Vehicle</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.vehiclePlate || "No vehicle attached")}
                          </p>
                        </div>
                      </>
                    )}

                    {type === "restaurant" && (
                      <>
                        <div>
                          <span className="font-semibold text-ink-500">Business Name</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.businessName || "Not set")}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold text-ink-500">Business Type</span>
                          <p className="font-bold text-ink mt-0.5 capitalize">
                            {String(draft.profile.businessType || "restaurant")}
                          </p>
                        </div>
                      </>
                    )}

                    {type === "merchant" && (
                      <>
                        <div>
                          <span className="font-semibold text-ink-500">Store Name</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.businessName || "Not set")}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold text-ink-500">Outlet</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.outletName || "Main")}
                          </p>
                        </div>
                      </>
                    )}

                    {type === "gas" && (
                      <>
                        <div>
                          <span className="font-semibold text-ink-500">Station Brand</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.stationBrand || "Not set")}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold text-ink-500">Branch Outlet</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.outletName || "Station")}
                          </p>
                        </div>
                      </>
                    )}

                    {type === "pharmacy" && (
                      <>
                        <div>
                          <span className="font-semibold text-ink-500">Pharmacy</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.pharmacyName || "Not set")}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold text-ink-500">NDA License</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.ndaLicense || "Pending")}
                          </p>
                        </div>
                      </>
                    )}

                    {type === "education" && (
                      <>
                        <div>
                          <span className="font-semibold text-ink-500">Institution</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.institutionName || "Not set")}
                          </p>
                        </div>
                        <div>
                          <span className="font-semibold text-ink-500">Category / Center</span>
                          <p className="font-bold text-ink mt-0.5">
                            {String(draft.profile.institutionType || "School")}
                          </p>
                        </div>
                      </>
                    )}

                    {draft.profile.lat && (
                      <div className="col-span-2">
                        <span className="font-semibold text-ink-500">GPS Coordinates</span>
                        <p className="font-bold text-ink mt-0.5">
                          {String(draft.profile.lat)}, {String(draft.profile.lng)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Consent Checkbox */}
                <label className="flex items-start gap-3 rounded-xl border border-[var(--border-faint)] p-4 text-sm font-semibold">
                  <input
                    type="checkbox"
                    required
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                    className="mt-1"
                  />
                  <span>
                    The person has agreed to create their Peebee account and receive an activation invitation.
                  </span>
                </label>

                <div className="flex flex-col-reverse gap-3 border-t border-[var(--border-faint)] pt-4 [&>*]:w-full">
                  <button
                    type="button"
                    onClick={handleBack}
                    disabled={busy}
                    className="sales-tab"
                  >
                    <ArrowLeft size={16} />
                    Back
                  </button>
                  <button
                    type="submit"
                    disabled={busy || !consent}
                    className="sales-primary"
                  >
                    <span>
                      {busy
                        ? "Saving & sending…"
                        : `Register ${labels[type]} & Send Activation`}
                    </span>
                    <ArrowRight size={16} />
                  </button>
                </div>
              </form>
            )}

            {/* STEP 6: Success Screen */}
            {step === 6 && successInfo && (
              <div className="home-card space-y-6 text-center py-8">
                <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold/20 text-gold">
                  <CheckCircle2 size={36} />
                </div>
                <div>
                  <span className="rounded-full bg-green/15 px-3 py-1 text-xs font-bold text-green">
                    Registration Successful
                  </span>
                  <h2 className="mt-3 text-2xl font-black">{successInfo.name} is Registered!</h2>
                  <p className="mt-2 text-sm text-ink-500 max-w-md mx-auto">
                    {labels[successInfo.type]} account was created.
                    {successInfo.sent
                      ? ` Activation invitation was sent via ${successInfo.channel.toUpperCase()}.`
                      : " Account is saved; activation can be resent from Records anytime."}
                  </p>
                </div>

                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-4 border-t border-[var(--border-faint)]">
                  <button
                    type="button"
                    onClick={resetRegistration}
                    className="sales-primary w-full sm:w-auto"
                  >
                    <Plus size={16} />
                    <span>Onboard another user</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      resetRegistration();
                      setTab("records");
                    }}
                    className="sales-tab w-full sm:w-auto"
                  >
                    <span>View in Records</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* RECORDS TAB */
          <section className="home-card space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-black">Records</h2>
              </div>
              <button
                aria-label="Refresh records"
                className="sales-tab"
                onClick={() => load().catch((e) => setError(e.message))}
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-[var(--border-faint)]">
              <button
                type="button"
                onClick={() => setRecordFilter("all")}
                className={`sales-tab ${
                  recordFilter === "all" ? "sales-tab-active" : ""
                }`}
              >
                All ({records.length})
              </button>
              {ONBOARDING_TYPES.map((t) => {
                const count = records.filter((r) => r.account_type === t).length;
                if (!count) return null;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setRecordFilter(t)}
                    className={`sales-tab ${
                      recordFilter === t ? "sales-tab-active" : ""
                    }`}
                  >
                    {labels[t]} ({count})
                  </button>
                );
              })}
            </div>

            {/* Search Input */}
            <div className="relative">
              <Search
                size={22}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-500"
              />
              <input
                type="text"
                placeholder="Search"
                value={recordSearch}
                onChange={(e) => setRecordSearch(e.target.value)}
                className="sales-input" style={{ paddingLeft: 48 }}
              />
            </div>

            {!filteredRecords.length ? (
              <p className="py-12 text-center text-lg text-ink-500">
                {records.length ? "No matching records found." : "No registrations yet. Onboard your first user!"}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--border-faint)]">
                {filteredRecords.slice(0, recordLimit).map((record) => {
                  const recordType = record.account_type as OnboardingType;
                  const Icon = icons[recordType] ?? UserRound;
                  return (
                    <li
                      key={record.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-4"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[rgb(var(--surface-input))] text-gold">
                          <Icon size={28} />
                        </div>
                        <div>
                          <p className="text-lg font-extrabold text-ink">{record.name}</p>
                          <p className="text-base text-ink-500">
                            {labels[recordType] ?? record.account_type} ·{" "}
                            {record.email ?? record.phone ?? "No contact"}
                          </p>
                          <p className="mt-1 text-base font-semibold">
                            {record.activated_at ? (
                              <span className="text-green flex items-center gap-1">
                                <Check size={12} /> Activated
                              </span>
                            ) : record.delivery_status === "sent" ? (
                              <span className="text-ink-500">
                                Invitation sent · {record.delivery_channel?.toUpperCase()}
                              </span>
                            ) : record.delivery_status === "sending" ? (
                              <span className="text-gold">Sending invitation…</span>
                            ) : (
                              <span className="text-amber-500">Awaiting activation</span>
                            )}
                          </p>
                        </div>
                      </div>

                      {!record.activated_at && (
                        <button
                          onClick={() => resend(record.id)}
                          disabled={!!retry}
                          className="sales-tab"
                        >
                          {retry === record.id ? "Sending…" : "Resend"}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {filteredRecords.length > recordLimit && (
              <button type="button" onClick={() => setRecordLimit((n) => n + 10)} className="sales-tab w-full">
                Show more ({filteredRecords.length - recordLimit})
              </button>
            )}
          </section>
        )}
      </main>

      {/* Floating Bottom Nav */}
      <BottomNav
        activeTab={tab}
        onTabChange={(newTab) => {
          setTab(newTab);
          if (newTab === "new" && step === 6) {
            setStep(1);
          }
        }}
        isSuperAdmin={me?.superAdmin}
      />
    </div>
  );
}
