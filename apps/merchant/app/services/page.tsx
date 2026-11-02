"use client";

import { OpeningHours } from "../../components/services/OpeningHours";
import {
  Briefcase,
  Calendar,
  Clock,
  Plus,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Copy,
  ExternalLink,
  ChevronRight,
  Filter,
  DollarSign,
  MapPin,
  Video,
  X,
  CreditCard,
  Building,
  UserCheck,
  Check,
  Smartphone,
  Info,
  Sparkles,
  ArrowRight,
  Store,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../../lib/auth-context";
import { getStoredToken } from "../../lib/api";
import type {
  ServiceBusinessProfile,
  ServiceOffering,
  ServiceStaffMember,
  ServiceBookingRecord,
  ServiceBusinessCategory,
  ServicePricingModel,
  ServiceLocationModel,
  ServicePaymentRail,
} from "@peebee/shared";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "https://api.peebee.online";

const CATEGORY_LABELS: Record<ServiceBusinessCategory, string> = {
  consultation: "Consultation & Advisory",
  health_wellness: "Health & Wellness",
  home_trades: "Home & Field Trades",
  tech_creative: "Tech & Creative Services",
  beauty_salon: "Beauty & Spa Salon",
  events_hospitality: "Events & Catering",
  education_coaching: "Private Coaching & Tutors",
  automotive_repairs: "Auto Detailing & Repairs",
};

const ugx = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString()}`;

export default function ServicesPlatformPage() {
  const { user } = useAuth();
  const token = getStoredToken();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Business profile
  const [business, setBusiness] = useState<ServiceBusinessProfile | null>(null);
  const [offerings, setOfferings] = useState<ServiceOffering[]>([]);
  const [staff, setStaff] = useState<ServiceStaffMember[]>([]);
  const [bookings, setBookings] = useState<ServiceBookingRecord[]>([]);

  // Navigation tabs
  const [activeTab, setActiveTab] = useState<"offerings" | "bookings" | "staff" | "hours" | "compliance">("offerings");
  const [bookingFilter, setBookingFilter] = useState<string>("all");

  // Onboarding launch modal
  const [launchModalOpen, setLaunchModalOpen] = useState(false);
  const [launchName, setLaunchName] = useState("");
  const [launchCategory, setLaunchCategory] = useState<ServiceBusinessCategory>("consultation");
  const [launchTagline, setLaunchTagline] = useState("");
  const [launchDesc, setLaunchDesc] = useState("");
  const [launchPhone, setLaunchPhone] = useState(user?.phone || "");
  const [launchAddress, setLaunchAddress] = useState("");
  const [launchServiceArea, setLaunchServiceArea] = useState("Greater Kampala");
  const [launchRails, setLaunchRails] = useState<ServicePaymentRail[]>(["momo_mtn", "momo_airtel", "cash_at_venue"]);
  const [launching, setLaunching] = useState(false);

  // New offering modal
  const [offeringModalOpen, setOfferingModalOpen] = useState(false);
  const [offeringTitle, setOfferingTitle] = useState("");
  const [offeringCategory, setOfferingCategory] = useState("appointment");
  const [offeringDesc, setOfferingDesc] = useState("");
  const [offeringPricingType, setOfferingPricingType] = useState<ServicePricingModel>("fixed");
  const [offeringPrice, setOfferingPrice] = useState<number>(50000);
  const [offeringDeposit, setOfferingDeposit] = useState<number>(0);
  const [offeringDuration, setOfferingDuration] = useState<number>(60);
  const [offeringLocation, setOfferingLocation] = useState<ServiceLocationModel>("in_facility");
  const [offeringVirtualUrl, setOfferingVirtualUrl] = useState("");
  const [offeringDeliverableInput, setOfferingDeliverableInput] = useState("");
  const [offeringDeliverables, setOfferingDeliverables] = useState<string[]>([]);
  const [savingOffering, setSavingOffering] = useState(false);

  // New staff modal
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [staffName, setStaffName] = useState("");
  const [staffRole, setStaffRole] = useState("Senior Specialist");
  const [staffPhone, setStaffPhone] = useState("");
  const [staffEmail, setStaffEmail] = useState("");
  const [savingStaff, setSavingStaff] = useState(false);

  // New manual booking modal
  const [bookingModalOpen, setBookingModalOpen] = useState(false);
  const [bkServiceId, setBkServiceId] = useState("");
  const [bkCustomerName, setBkCustomerName] = useState("");
  const [bkCustomerPhone, setBkCustomerPhone] = useState("");
  const [bkDate, setBkDate] = useState(new Date().toISOString().split("T")[0]);
  const [bkTime, setBkTime] = useState("10:00");
  const [bkLocation, setBkLocation] = useState<ServiceLocationModel>("in_facility");
  const [bkAddress, setBkAddress] = useState("");
  const [bkNotes, setBkNotes] = useState("");
  const [bkPaymentRail, setBkPaymentRail] = useState<ServicePaymentRail>("cash_at_venue");
  const [savingBooking, setSavingBooking] = useState(false);

  // Copy site URL
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!token) return;
    loadAll();
  }, [token]);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const bizRes = await fetch(`${API_BASE}/v1/services-platform/my-business`, {
        headers: { Authorization: `Bearer ${token}` },
      }).then((r) => r.json());

      if (bizRes.business) {
        setBusiness(bizRes.business);
        const [offRes, stfRes, bkRes] = await Promise.all([
          fetch(`${API_BASE}/v1/services-platform/offerings`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
          fetch(`${API_BASE}/v1/services-platform/staff`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
          fetch(`${API_BASE}/v1/services-platform/bookings`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()),
        ]);
        setOfferings(offRes.offerings || []);
        setStaff(stfRes.staff || []);
        setBookings(bkRes.bookings || []);
      } else {
        setBusiness(null);
      }
    } catch {
      setError("Could not load services data. Check connection.");
    } finally {
      setLoading(false);
    }
  }

  async function handleLaunchBusiness(e: React.FormEvent) {
    e.preventDefault();
    setLaunching(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/services-platform/my-business`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: launchName,
          category: launchCategory,
          tagline: launchTagline,
          description: launchDesc,
          phone: launchPhone,
          address: launchAddress,
          city: "Kampala",
          service_area: launchServiceArea,
          allowed_payment_rails: launchRails,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || data.error || "Failed to launch service business");
      setBusiness(data.business);
      setLaunchModalOpen(false);
      setSuccessMsg("Your standalone service business is live! You can now publish service offerings.");
      loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLaunching(false);
    }
  }

  async function handleCreateOffering(e: React.FormEvent) {
    e.preventDefault();
    setSavingOffering(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/services-platform/offerings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: offeringTitle,
          category: offeringCategory,
          description: offeringDesc,
          pricing_type: offeringPricingType,
          price_ugx: Number(offeringPrice) || 0,
          deposit_ugx: Number(offeringDeposit) || null,
          duration_minutes: Number(offeringDuration) || 60,
          location_type: offeringLocation,
          virtual_meeting_url: offeringVirtualUrl,
          deliverables: offeringDeliverables,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to save offering");
      setOfferingModalOpen(false);
      setOfferingTitle("");
      setOfferingDesc("");
      setOfferingDeliverables([]);
      setSuccessMsg("New service offering added successfully!");
      loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingOffering(false);
    }
  }

  async function handleDeleteOffering(id: string) {
    if (!confirm("Remove this service offering?")) return;
    try {
      await fetch(`${API_BASE}/v1/services-platform/offerings/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setSuccessMsg("Offering removed.");
      loadAll();
    } catch {
      setError("Could not remove offering.");
    }
  }

  async function handleCreateStaff(e: React.FormEvent) {
    e.preventDefault();
    setSavingStaff(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/services-platform/staff`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          name: staffName,
          role: staffRole,
          phone: staffPhone,
          email: staffEmail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to add specialist");
      setStaffModalOpen(false);
      setStaffName("");
      setStaffPhone("");
      setStaffEmail("");
      setSuccessMsg("Specialist added to team.");
      loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingStaff(false);
    }
  }

  async function handleCreateManualBooking(e: React.FormEvent) {
    e.preventDefault();
    setSavingBooking(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/services-platform/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          service_id: bkServiceId || offerings[0]?.id,
          customer_name: bkCustomerName,
          customer_phone: bkCustomerPhone,
          scheduled_date: bkDate,
          scheduled_time: bkTime,
          location_type: bkLocation,
          address: bkAddress,
          notes: bkNotes,
          payment_rail: bkPaymentRail,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || "Failed to record booking");
      setBookingModalOpen(false);
      setBkCustomerName("");
      setBkCustomerPhone("");
      setBkNotes("");
      setSuccessMsg("Booking recorded and confirmed!");
      loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingBooking(false);
    }
  }

  async function bookingCall(path: string, method: string, body: object, done: (d: any) => string) {
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/v1/services-platform/bookings/${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "That didn't work.");
      setSuccessMsg(done(data));
      loadAll();
    } catch (err: any) {
      setError(err.message || "That didn't work.");
    }
  }

  const ugxLine = (n: number) => `UGX ${Math.round(Number(n) || 0).toLocaleString()}`;

  async function handleUpdateBookingStatus(bookingId: string, status: string, staffId?: string) {
    await bookingCall(`${bookingId}/status`, "PATCH", { status, staff_id: staffId }, (d) =>
      d.refund?.state === "pending" || d.refund?.state === "refunded" ? "Cancelled. The customer's money is being refunded."
        : d.refund?.state === "review" ? "Cancelled. Decide on the refund below."
        : d.released_ugx ? `Done. ${ugxLine(d.released_ugx)} has been added to your wallet.`
        : `Booking is now ${status.replace("_", " ")}.`);
  }

  async function handleVenuePayment(bookingId: string, balance: number) {
    const raw = window.prompt("Amount received (UGX)", String(balance));
    const amount = Math.round(Number(raw));
    if (!raw || !Number.isFinite(amount) || amount <= 0) return;
    await bookingCall(`${bookingId}/venue-payment`, "POST", { amount_ugx: amount }, () => "Payment recorded.");
  }

  async function handleQuote(bookingId: string) {
    const raw = window.prompt("Price for this job (UGX)");
    const amount = Math.round(Number(raw));
    if (!raw || !Number.isFinite(amount) || amount <= 0) return;
    await bookingCall(`${bookingId}/quote`, "POST", { total_ugx: amount }, () => "Price sent to the customer.");
  }

  function copySiteLink() {
    if (!business?.slug) return;
    const url = `https://peebee.online/services/${business.slug}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }

  const filteredBookings = bookings.filter((b) => {
    if (bookingFilter === "all") return true;
    return b.status === bookingFilter;
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 space-y-6 pb-28">
      {/* Platform Switcher Banner: Standalone Architecture */}
      <div className="rounded-2xl border border-ink/10 bg-surface-primary p-4 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gold/15 flex items-center justify-center shrink-0">
            <Store className="h-5 w-5 text-gold-dark" />
          </div>
          <div>
            <div className="text-xs font-bold text-ink-500 uppercase tracking-wider">Business Rail Switcher</div>
            <div className="text-sm font-semibold text-ink">Need to manage physical retail & inventory?</div>
          </div>
        </div>
        <Link
          href="/store"
          className="inline-flex items-center gap-2 rounded-xl bg-ink/5 hover:bg-ink/10 px-4 py-2 text-xs font-bold text-ink transition-colors"
        >
          <span>Switch to Retail Store OS</span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-gold/10 px-3 py-1 text-xs font-black uppercase tracking-wider text-gold-dark">
            <Briefcase className="h-3.5 w-3.5" />
            Standalone Services Engine
          </div>
          <h1 className="text-2xl font-black text-ink tracking-tight mt-1">
            {business ? business.name : "Service Support & Booking Platform"}
          </h1>
          <p className="text-sm text-ink-500 mt-0.5">
            {business
              ? `${CATEGORY_LABELS[business.category] || business.category} · ${business.service_area}`
              : "Launch your dedicated service site, offer appointments & consultations, and manage your bookings in one place."}
          </p>
        </div>

        {business && (
          <div className="flex items-center gap-2">
            <button
              onClick={copySiteLink}
              className="inline-flex items-center gap-1.5 rounded-xl border border-ink/10 bg-surface-primary px-3 py-2 text-xs font-bold text-ink hover:bg-ink/5 transition-colors shadow-sm"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copied ? "Link Copied!" : "Copy Site URL"}</span>
            </button>
            <Link
              href={`https://peebee.online/services/${business.slug}`}
              target="_blank"
              className="inline-flex items-center gap-1.5 rounded-xl bg-gold px-3.5 py-2 text-xs font-black text-black hover:bg-gold-light transition-colors shadow-sm"
            >
              <span>View Live Site</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </div>

      {/* Alerts */}
      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 p-3.5 text-xs text-red-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-red-600" />
            <span>{error}</span>
          </div>
          <button onClick={() => setError(null)} className="text-red-500 hover:text-red-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {successMsg && (
        <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3.5 text-xs text-emerald-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)} className="text-emerald-500 hover:text-emerald-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Empty State / Not Launched Yet */}
      {!business && !loading && (
        <div className="rounded-3xl border border-ink/10 bg-surface-primary p-8 text-center space-y-6 shadow-sm">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-gold/15 flex items-center justify-center text-gold-dark">
            <Briefcase className="h-8 w-8" />
          </div>

          <div className="max-w-md mx-auto space-y-2">
            <h2 className="text-xl font-black text-ink">Launch Your Service Business Site</h2>
            <p className="text-xs text-ink-500 leading-relaxed">
              Enable clients to book appointments, virtual consultations, and field services directly.
              Choose your services, availability and supported payment methods before publishing.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-lg mx-auto text-left">
            <div className="p-3 rounded-xl bg-cream/70 border border-ink/5 space-y-1">
              <div className="text-xs font-black text-ink">Broad Services</div>
              <p className="text-[11px] text-ink-500">Legal, Health, Trades, Beauty, Coaching, Tech & Custom Quotes.</p>
            </div>
            <div className="p-3 rounded-xl bg-cream/70 border border-ink/5 space-y-1">
              <div className="text-xs font-black text-ink">Dedicated Site</div>
              <p className="text-[11px] text-ink-500">Custom URL (e.g. peebee.online/services/your-brand).</p>
            </div>
            <div className="p-3 rounded-xl bg-cream/70 border border-ink/5 space-y-1">
              <div className="text-xs font-black text-ink">Booking setup</div>
              <p className="text-[11px] text-ink-500">Set prices, availability and payment instructions for clients.</p>
            </div>
          </div>

          <button
            onClick={() => setLaunchModalOpen(true)}
            className="inline-flex items-center gap-2 rounded-2xl bg-gold px-6 py-3.5 text-sm font-black text-black shadow-md hover:bg-gold-light active:scale-98 transition-all"
          >
            <Sparkles className="h-4 w-4" />
            <span>Launch My Service Site Now</span>
          </button>
        </div>
      )}

      {/* Main Business Hub */}
      {business && (
        <div className="space-y-6">
          {/* Navigation Sub-Tabs */}
          <div className="flex items-center gap-1.5 border-b border-ink/10 pb-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab("offerings")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors shrink-0 ${
                activeTab === "offerings" ? "bg-ink text-cream" : "text-ink-600 hover:bg-ink/5"
              }`}
            >
              Service Offerings ({offerings.length})
            </button>
            <button
              onClick={() => setActiveTab("bookings")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors shrink-0 ${
                activeTab === "bookings" ? "bg-ink text-cream" : "text-ink-600 hover:bg-ink/5"
              }`}
            >
              Bookings & CRM ({bookings.length})
            </button>
            <button
              onClick={() => setActiveTab("staff")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors shrink-0 ${
                activeTab === "staff" ? "bg-ink text-cream" : "text-ink-600 hover:bg-ink/5"
              }`}
            >
              Team Specialists ({staff.length})
            </button>
            <button
              onClick={() => setActiveTab("hours")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors shrink-0 ${
                activeTab === "hours" ? "bg-ink text-cream" : "text-ink-600 hover:bg-ink/5"
              }`}
            >
              Opening hours
            </button>
            <button
              onClick={() => setActiveTab("compliance")}
              className={`rounded-xl px-4 py-2 text-xs font-bold transition-colors shrink-0 ${
                activeTab === "compliance" ? "bg-ink text-cream" : "text-ink-600 hover:bg-ink/5"
              }`}
            >
              Payment Rails & Compliance
            </button>
          </div>

          {/* TAB 1: SERVICE OFFERINGS */}
          {activeTab === "offerings" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-ink">Active Service Offerings</h3>
                  <p className="text-xs text-ink-500">Configure appointment types, pricing models and coverage</p>
                </div>
                <button
                  onClick={() => setOfferingModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gold px-3.5 py-2 text-xs font-black text-black shadow hover:bg-gold-light transition-all"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Service</span>
                </button>
              </div>

              {offerings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-ink/20 p-8 text-center space-y-3 bg-surface-primary">
                  <p className="text-xs text-ink-500">No services added yet. Add your first consultation or service package.</p>
                  <button
                    onClick={() => setOfferingModalOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-cream px-4 py-2 text-xs font-bold"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create Service Offering</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {offerings.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-2xl border border-ink/10 bg-surface-primary p-4 shadow-sm space-y-3 relative group"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2 py-0.5 text-[10px] font-black uppercase text-ink-600 mb-1">
                            {item.location_type === "virtual" ? (
                              <Video className="h-3 w-3 text-sky-600" />
                            ) : item.location_type === "client_site" ? (
                              <MapPin className="h-3 w-3 text-amber-600" />
                            ) : (
                              <Building className="h-3 w-3 text-emerald-600" />
                            )}
                            <span>{item.location_type.replace("_", " ")}</span>
                          </div>
                          <h4 className="text-sm font-bold text-ink">{item.title}</h4>
                        </div>
                        <button
                          onClick={() => handleDeleteOffering(item.id)}
                          className="text-ink-400 hover:text-red-600 text-xs p-1"
                          title="Remove service"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <p className="text-xs text-ink-500 line-clamp-2">{item.description}</p>

                      <div className="flex items-center justify-between text-xs pt-2 border-t border-ink/5">
                        <div className="space-y-0.5">
                          <div className="text-[10px] uppercase font-bold text-ink-400">
                            {item.pricing_type === "custom_quote"
                              ? "Free Custom Quote"
                              : item.pricing_type === "hourly"
                              ? "Hourly Rate"
                              : "Standard Fee"}
                          </div>
                          <div className="font-black text-ink text-sm">
                            {item.pricing_type === "custom_quote" ? "Quote on Inquiry" : ugx(item.price_ugx)}
                            {item.pricing_type === "hourly" && <span className="text-xs font-normal text-ink-500"> / hr</span>}
                          </div>
                        </div>

                        <div className="text-right space-y-0.5">
                          <div className="text-[10px] uppercase font-bold text-ink-400">Duration</div>
                          <div className="font-semibold text-ink flex items-center gap-1">
                            <Clock className="h-3 w-3 text-ink-400" />
                            <span>{item.duration_minutes} mins</span>
                          </div>
                        </div>
                      </div>

                      {item.deliverables && item.deliverables.length > 0 && (
                        <div className="pt-2 border-t border-ink/5 space-y-1">
                          <div className="text-[10px] uppercase font-bold text-ink-400">Included Deliverables:</div>
                          <ul className="text-[11px] text-ink-600 space-y-0.5">
                            {item.deliverables.map((d, i) => (
                              <li key={i} className="flex items-center gap-1.5">
                                <Check className="h-3 w-3 text-emerald-600 shrink-0" />
                                <span>{d}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 2: BOOKINGS CRM */}
          {activeTab === "bookings" && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 overflow-x-auto">
                  {["all", "pending", "confirmed", "in_progress", "completed", "cancelled"].map((st) => (
                    <button
                      key={st}
                      onClick={() => setBookingFilter(st)}
                      className={`rounded-xl px-3 py-1.5 text-xs font-bold capitalize transition-colors ${
                        bookingFilter === st ? "bg-ink text-cream" : "bg-surface-primary border border-ink/10 text-ink-600"
                      }`}
                    >
                      {st.replace("_", " ")}
                    </button>
                  ))}
                </div>

                <button
                  onClick={() => setBookingModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-ink text-cream px-3.5 py-2 text-xs font-bold shadow hover:bg-black transition-all shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Manual Walk-In Entry</span>
                </button>
              </div>

              {filteredBookings.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-ink/20 p-8 text-center space-y-2 bg-surface-primary">
                  <Calendar className="h-8 w-8 text-ink-400 mx-auto" />
                  <p className="text-xs text-ink-500">No bookings match the selected status filter.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filteredBookings.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-2xl border border-ink/10 bg-surface-primary p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                              b.status === "confirmed"
                                ? "bg-emerald-100 text-emerald-800"
                                : b.status === "in_progress"
                                ? "bg-sky-100 text-sky-800"
                                : b.status === "completed"
                                ? "bg-gray-100 text-gray-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {b.status.replace("_", " ")}
                          </span>
                          <span className="text-xs font-bold text-ink">{b.service_title}</span>
                          {b.booking_code && <span className="text-[10px] font-mono tracking-widest text-ink-400">{b.booking_code}</span>}
                        </div>

                        <div className="text-xs text-ink-600">
                          <strong>{b.customer_name}</strong> · {b.customer_phone}
                          {b.address && <span> · {b.address}</span>}
                        </div>

                        <div className="flex items-center gap-3 text-[11px] text-ink-400">
                          <span className="flex items-center gap-1 font-semibold text-ink-600">
                            <Calendar className="h-3 w-3" />
                            {b.scheduled_date} at {b.scheduled_time}
                          </span>
                          <span>•</span>
                          <span>{b.duration_minutes} mins</span>
                          <span>•</span>
                          <span>Fee: {ugx(b.total_price_ugx)}</span>
                          <span>•</span>
                          <span className="capitalize">Rail: {b.payment_rail.replace("_", " ")}</span>
                        </div>
                        <div className="text-[11px] font-semibold text-ink-600">
                          {String(b.payment_status).replace("_", " ")} · paid {ugx(Number(b.paid_ugx ?? 0))}
                          {b.refund_state && b.refund_state !== "none" ? ` · refund ${b.refund_state}` : ""}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {b.status === "pending" && (
                          <button
                            onClick={() => handleUpdateBookingStatus(b.id, "confirmed")}
                            className="rounded-xl bg-emerald-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-emerald-700"
                          >
                            Confirm Booking
                          </button>
                        )}
                        {b.status === "confirmed" && (
                          <button
                            onClick={() => handleUpdateBookingStatus(b.id, "in_progress")}
                            className="rounded-xl bg-sky-600 text-white px-3 py-1.5 text-xs font-bold hover:bg-sky-700"
                          >
                            Start Service
                          </button>
                        )}
                        {b.status === "in_progress" && (
                          <button
                            onClick={() => handleUpdateBookingStatus(b.id, "completed")}
                            className="rounded-xl bg-ink text-cream px-3 py-1.5 text-xs font-bold hover:bg-black"
                          >
                            Mark Completed
                          </button>
                        )}
                        {b.status === "confirmed" && (
                          <button
                            onClick={() => handleUpdateBookingStatus(b.id, "no_show")}
                            className="rounded-xl border border-ink/10 px-3 py-1.5 text-xs font-bold text-ink-600 hover:bg-ink/5"
                          >
                            No-show
                          </button>
                        )}
                        {["pending", "confirmed", "in_progress", "completed"].includes(b.status) && Number(b.total_price_ugx) > Number(b.paid_ugx ?? 0) && b.payment_status !== "waived" && (
                          <>
                            <button onClick={() => handleVenuePayment(b.id, Number(b.total_price_ugx) - Number(b.paid_ugx ?? 0))} className="rounded-xl border border-ink/10 px-3 py-1.5 text-xs font-bold text-ink hover:bg-ink/5">Record payment</button>
                            <button onClick={() => bookingCall(`${b.id}/waive`, "POST", {}, () => "Balance waived.")} className="rounded-xl border border-ink/10 px-3 py-1.5 text-xs font-bold text-ink-600 hover:bg-ink/5">Waive balance</button>
                          </>
                        )}
                        {Number(b.total_price_ugx) === 0 && ["pending", "confirmed"].includes(b.status) && (
                          <button onClick={() => handleQuote(b.id)} className="rounded-xl border border-gold px-3 py-1.5 text-xs font-bold text-ink">Set price</button>
                        )}
                        {b.refund_state === "review" && (
                          <>
                            <button onClick={() => bookingCall(`${b.id}/refund-decision`, "POST", { decision: "refund" }, () => "Refund sent.")} className="rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white">Refund customer</button>
                            <button onClick={() => bookingCall(`${b.id}/refund-decision`, "POST", { decision: "keep" }, () => "You kept the payment.")} className="rounded-xl border border-ink/10 px-3 py-1.5 text-xs font-bold text-ink-600">Keep payment</button>
                          </>
                        )}
                        {["pending", "confirmed", "in_progress"].includes(b.status) && (
                          <button
                            onClick={() => handleUpdateBookingStatus(b.id, "cancelled")}
                            className="rounded-xl border border-red-200 text-red-600 hover:bg-red-50 px-3 py-1.5 text-xs font-bold"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === "hours" && <OpeningHours token={token} />}

          {/* TAB 3: TEAM SPECIALISTS */}
          {activeTab === "staff" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-black text-ink">Team Specialists & Practitioners</h3>
                  <p className="text-xs text-ink-500">Assign bookings to specific team members</p>
                </div>
                <button
                  onClick={() => setStaffModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gold px-3.5 py-2 text-xs font-black text-black shadow hover:bg-gold-light transition-all"
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Specialist</span>
                </button>
              </div>

              {staff.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-ink/20 p-8 text-center space-y-2 bg-surface-primary">
                  <Users className="h-8 w-8 text-ink-400 mx-auto" />
                  <p className="text-xs text-ink-500">No staff specialists added yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {staff.map((s) => (
                    <div
                      key={s.id}
                      className="rounded-2xl border border-ink/10 bg-surface-primary p-4 shadow-sm flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-ink/10 flex items-center justify-center font-bold text-ink">
                          {s.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-bold text-ink">{s.name}</div>
                          <div className="text-xs text-ink-500">{s.role}</div>
                          <div className="text-[11px] text-ink-400 mt-0.5">{s.phone}</div>
                        </div>
                      </div>
                      <span className="rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5">
                        Active
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: PAYMENT RAILS & COMPLIANCE */}
          {activeTab === "compliance" && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-ink/10 bg-surface-primary p-6 space-y-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0 text-amber-800">
                    <ShieldCheck className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-ink">Payment methods and booking policies</h3>
                    <p className="text-xs text-ink-500 mt-1 leading-relaxed">
                      Service bookings use the payment methods enabled for this business. A displayed payment instruction does not confirm collection. Check each booking’s payment status before delivering a service.
                    </p>
                  </div>
                </div>

                <div className="rounded-xl bg-cream/70 border border-ink/5 p-4 space-y-2 text-xs text-ink-700">
                  <div className="font-bold text-ink flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    How Peebee Protects Your Business:
                  </div>
                  <ul className="space-y-1 list-disc pl-5 text-ink-600">
                    <li><strong>Separation of Rails:</strong> Physical retail and products use standard e-commerce card checkout.</li>
                    <li><strong>Service-Compliant Settlement:</strong> Services operate via instant Mobile Money (MTN MoMo, Airtel Money), on-site cash, or bank wire escrow.</li>
                    <li><strong>Zero Chargeback Risk:</strong> Direct carrier-authenticated push eliminates unauthorized card fraud chargebacks for service practitioners.</li>
                  </ul>
                </div>

                <div className="pt-2 border-t border-ink/10 space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-wider text-ink">Permitted Rails For Your Service Site</h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50/50">
                      <Smartphone className="h-4 w-4 text-emerald-600" />
                      <div>
                        <strong>MTN Mobile Money</strong>
                        <div className="text-[10px] text-ink-500">Direct carrier push PIN prompt</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50/50">
                      <Smartphone className="h-4 w-4 text-red-600" />
                      <div>
                        <strong>Airtel Money</strong>
                        <div className="text-[10px] text-ink-500">Direct carrier push PIN prompt</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50/50">
                      <DollarSign className="h-4 w-4 text-emerald-700" />
                      <div>
                        <strong>Cash / On-Site Settle</strong>
                        <div className="text-[10px] text-ink-500">Settle balance upon service delivery</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 p-3 rounded-xl border border-emerald-200 bg-emerald-50/50">
                      <Building className="h-4 w-4 text-blue-700" />
                      <div>
                        <strong>Direct Bank Wire</strong>
                        <div className="text-[10px] text-ink-500">For enterprise / B2B corporate contracts</div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* MODAL 1: LAUNCH SERVICE BUSINESS */}
      {launchModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-surface-primary p-6 space-y-4 shadow-2xl border border-ink/10 my-8">
            <div className="flex items-center justify-between border-b border-ink/10 pb-3">
              <h3 className="text-base font-black text-ink">Launch Your Service Business</h3>
              <button onClick={() => setLaunchModalOpen(false)} className="text-ink-400 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleLaunchBusiness} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-ink">Business / Practice Name *</label>
                <div className="field-box rounded-xl">
                  <input
                    type="text"
                    required
                    value={launchName}
                    onChange={(e) => setLaunchName(e.target.value)}
                    placeholder="e.g. Apex Engineering & Power Advisory"
                    className="w-full p-2.5 text-xs text-ink outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink">Primary Category *</label>
                <div className="field-box rounded-xl">
                  <select
                    value={launchCategory}
                    onChange={(e) => setLaunchCategory(e.target.value as ServiceBusinessCategory)}
                    className="w-full p-2.5 text-xs text-ink outline-none bg-transparent"
                  >
                    {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink">Tagline / Headline</label>
                <div className="field-box rounded-xl">
                  <input
                    type="text"
                    value={launchTagline}
                    onChange={(e) => setLaunchTagline(e.target.value)}
                    placeholder="e.g. Licensed Solar PV & Industrial Electrical Audits"
                    className="w-full p-2.5 text-xs text-ink outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-ink">Direct Phone / WhatsApp *</label>
                  <div className="field-box rounded-xl">
                    <input
                      type="text"
                      required
                      value={launchPhone}
                      onChange={(e) => setLaunchPhone(e.target.value)}
                      placeholder="+256 701 000 000"
                      className="w-full p-2.5 text-xs text-ink outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-ink">Coverage Area *</label>
                  <div className="field-box rounded-xl">
                    <input
                      type="text"
                      required
                      value={launchServiceArea}
                      onChange={(e) => setLaunchServiceArea(e.target.value)}
                      placeholder="e.g. Greater Kampala & Entebbe"
                      className="w-full p-2.5 text-xs text-ink outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink">Facility / Studio Address</label>
                <div className="field-box rounded-xl">
                  <input
                    type="text"
                    value={launchAddress}
                    onChange={(e) => setLaunchAddress(e.target.value)}
                    placeholder="e.g. Plot 14, Acacia Avenue, Kololo"
                    className="w-full p-2.5 text-xs text-ink outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink">Description of Services</label>
                <div className="field-box rounded-xl">
                  <textarea
                    rows={2}
                    value={launchDesc}
                    onChange={(e) => setLaunchDesc(e.target.value)}
                    placeholder="Detail your experience, certifications and services offered..."
                    className="w-full p-2.5 text-xs text-ink outline-none resize-none"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-gold/10 border border-gold/20 text-ink-700 space-y-1 text-[11px]">
                <div className="font-bold flex items-center gap-1.5 text-gold-dark">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Booking payment methods
                </div>
                <p>Choose the supported payment methods you accept. Review the booking and cancellation terms before publishing your services.</p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink/10">
                <button
                  type="button"
                  onClick={() => setLaunchModalOpen(false)}
                  className="rounded-xl px-4 py-2 font-bold text-ink-500 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={launching}
                  className="rounded-xl bg-gold px-5 py-2.5 font-black text-black shadow hover:bg-gold-light disabled:opacity-50"
                >
                  {launching ? "Creating Site..." : "Publish Service Site"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: ADD SERVICE OFFERING */}
      {offeringModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-surface-primary p-6 space-y-4 shadow-2xl border border-ink/10 my-8">
            <div className="flex items-center justify-between border-b border-ink/10 pb-3">
              <h3 className="text-base font-black text-ink">Add Service Offering</h3>
              <button onClick={() => setOfferingModalOpen(false)} className="text-ink-400 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateOffering} className="space-y-4 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-ink">Service Title *</label>
                <div className="field-box rounded-xl">
                  <input
                    type="text"
                    required
                    value={offeringTitle}
                    onChange={(e) => setOfferingTitle(e.target.value)}
                    placeholder="e.g. Inverter & Solar Terminal Diagnostic"
                    className="w-full p-2.5 text-xs text-ink outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-ink">Pricing Model *</label>
                  <div className="field-box rounded-xl">
                    <select
                      value={offeringPricingType}
                      onChange={(e) => setOfferingPricingType(e.target.value as ServicePricingModel)}
                      className="w-full p-2.5 text-xs text-ink outline-none bg-transparent"
                    >
                      <option value="fixed">Fixed Price</option>
                      <option value="hourly">Hourly Rate</option>
                      <option value="custom_quote">Free Custom Quote</option>
                      <option value="deposit">Deposit Required</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-ink">Location / Delivery Mode *</label>
                  <div className="field-box rounded-xl">
                    <select
                      value={offeringLocation}
                      onChange={(e) => setOfferingLocation(e.target.value as ServiceLocationModel)}
                      className="w-full p-2.5 text-xs text-ink outline-none bg-transparent"
                    >
                      <option value="in_facility">At Provider Facility / Studio</option>
                      <option value="client_site">At Client Location / Home Visit</option>
                      <option value="virtual">Virtual Online Video Call</option>
                    </select>
                  </div>
                </div>
              </div>

              {offeringPricingType !== "custom_quote" && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="font-bold text-ink">Fee (UGX) *</label>
                    <div className="field-box rounded-xl">
                      <input
                        type="number"
                        min="0"
                        step="5000"
                        required
                        value={offeringPrice}
                        onChange={(e) => setOfferingPrice(Number(e.target.value))}
                        className="w-full p-2.5 text-xs text-ink outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-bold text-ink">Advance Deposit (UGX)</label>
                    <div className="field-box rounded-xl">
                      <input
                        type="number"
                        min="0"
                        step="5000"
                        value={offeringDeposit}
                        onChange={(e) => setOfferingDeposit(Number(e.target.value))}
                        placeholder="0 for full pay"
                        className="w-full p-2.5 text-xs text-ink outline-none"
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-ink">Duration (Minutes) *</label>
                  <div className="field-box rounded-xl">
                    <input
                      type="number"
                      min="15"
                      step="15"
                      required
                      value={offeringDuration}
                      onChange={(e) => setOfferingDuration(Number(e.target.value))}
                      className="w-full p-2.5 text-xs text-ink outline-none"
                    />
                  </div>
                </div>

                {offeringLocation === "virtual" && (
                  <div className="space-y-1">
                    <label className="font-bold text-ink">Meeting Link (Google Meet/Zoom)</label>
                    <div className="field-box rounded-xl">
                      <input
                        type="url"
                        value={offeringVirtualUrl}
                        onChange={(e) => setOfferingVirtualUrl(e.target.value)}
                        placeholder="https://meet.google.com/..."
                        className="w-full p-2.5 text-xs text-ink outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink">Service Description</label>
                <div className="field-box rounded-xl">
                  <textarea
                    rows={2}
                    value={offeringDesc}
                    onChange={(e) => setOfferingDesc(e.target.value)}
                    placeholder="Describe what the client receives..."
                    className="w-full p-2.5 text-xs text-ink outline-none resize-none"
                  />
                </div>
              </div>

              {/* Deliverables tags */}
              <div className="space-y-1.5">
                <label className="font-bold text-ink">Key Deliverables (What's included)</label>
                <div className="flex gap-2">
                  <div className="field-box rounded-xl flex-1">
                    <input
                      type="text"
                      value={offeringDeliverableInput}
                      onChange={(e) => setOfferingDeliverableInput(e.target.value)}
                      placeholder="e.g. Formal written diagnostic report"
                      className="w-full p-2 text-xs text-ink outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!offeringDeliverableInput.trim()) return;
                      setOfferingDeliverables([...offeringDeliverables, offeringDeliverableInput.trim()]);
                      setOfferingDeliverableInput("");
                    }}
                    className="rounded-xl bg-ink/10 px-3 py-1.5 font-bold text-ink hover:bg-ink/20"
                  >
                    Add
                  </button>
                </div>

                {offeringDeliverables.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {offeringDeliverables.map((d, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-md bg-ink/5 px-2 py-0.5 text-[11px] text-ink font-semibold"
                      >
                        <span>{d}</span>
                        <button
                          type="button"
                          onClick={() => setOfferingDeliverables(offeringDeliverables.filter((_, idx) => idx !== i))}
                          className="text-ink-400 hover:text-red-600"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink/10">
                <button
                  type="button"
                  onClick={() => setOfferingModalOpen(false)}
                  className="rounded-xl px-4 py-2 font-bold text-ink-500 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingOffering}
                  className="rounded-xl bg-gold px-5 py-2.5 font-black text-black shadow hover:bg-gold-light disabled:opacity-50"
                >
                  {savingOffering ? "Saving..." : "Create Offering"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: ADD STAFF SPECIALIST */}
      {staffModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-3xl bg-surface-primary p-6 space-y-4 shadow-2xl border border-ink/10">
            <div className="flex items-center justify-between border-b border-ink/10 pb-3">
              <h3 className="text-base font-black text-ink">Add Team Specialist</h3>
              <button onClick={() => setStaffModalOpen(false)} className="text-ink-400 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateStaff} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-ink">Specialist Name *</label>
                <div className="field-box rounded-xl">
                  <input
                    type="text"
                    required
                    value={staffName}
                    onChange={(e) => setStaffName(e.target.value)}
                    placeholder="e.g. Eng. Brian Mukasa"
                    className="w-full p-2.5 text-xs text-ink outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink">Role / Specialty *</label>
                <div className="field-box rounded-xl">
                  <input
                    type="text"
                    required
                    value={staffRole}
                    onChange={(e) => setStaffRole(e.target.value)}
                    placeholder="e.g. Lead Solar Technician"
                    className="w-full p-2.5 text-xs text-ink outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink">Phone Number *</label>
                <div className="field-box rounded-xl">
                  <input
                    type="text"
                    required
                    value={staffPhone}
                    onChange={(e) => setStaffPhone(e.target.value)}
                    placeholder="+256 700 000 000"
                    className="w-full p-2.5 text-xs text-ink outline-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink/10">
                <button
                  type="button"
                  onClick={() => setStaffModalOpen(false)}
                  className="rounded-xl px-4 py-2 font-bold text-ink-500 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStaff}
                  className="rounded-xl bg-gold px-5 py-2.5 font-black text-black shadow hover:bg-gold-light disabled:opacity-50"
                >
                  {savingStaff ? "Adding..." : "Add to Team"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 4: MANUAL BOOKING ENTRY */}
      {bookingModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-3xl bg-surface-primary p-6 space-y-4 shadow-2xl border border-ink/10 my-8">
            <div className="flex items-center justify-between border-b border-ink/10 pb-3">
              <h3 className="text-base font-black text-ink">Manual Walk-In / Phone Booking</h3>
              <button onClick={() => setBookingModalOpen(false)} className="text-ink-400 hover:text-ink">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateManualBooking} className="space-y-3 text-xs">
              <div className="space-y-1">
                <label className="font-bold text-ink">Select Service Offering *</label>
                <div className="field-box rounded-xl">
                  <select
                    value={bkServiceId}
                    onChange={(e) => setBkServiceId(e.target.value)}
                    className="w-full p-2.5 text-xs text-ink outline-none bg-transparent"
                  >
                    {offerings.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.title} — {ugx(o.price_ugx)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-ink">Customer Full Name *</label>
                  <div className="field-box rounded-xl">
                    <input
                      type="text"
                      required
                      value={bkCustomerName}
                      onChange={(e) => setBkCustomerName(e.target.value)}
                      placeholder="e.g. Baker Lubega"
                      className="w-full p-2.5 text-xs text-ink outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-ink">Customer Phone *</label>
                  <div className="field-box rounded-xl">
                    <input
                      type="text"
                      required
                      value={bkCustomerPhone}
                      onChange={(e) => setBkCustomerPhone(e.target.value)}
                      placeholder="+256 700 000 000"
                      className="w-full p-2.5 text-xs text-ink outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-bold text-ink">Scheduled Date *</label>
                  <div className="field-box rounded-xl">
                    <input
                      type="date"
                      required
                      value={bkDate}
                      onChange={(e) => setBkDate(e.target.value)}
                      className="w-full p-2.5 text-xs text-ink outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="font-bold text-ink">Scheduled Time *</label>
                  <div className="field-box rounded-xl">
                    <input
                      type="time"
                      required
                      value={bkTime}
                      onChange={(e) => setBkTime(e.target.value)}
                      className="w-full p-2.5 text-xs text-ink outline-none"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-bold text-ink">Client Address / Notes</label>
                <div className="field-box rounded-xl">
                  <textarea
                    rows={2}
                    value={bkNotes}
                    onChange={(e) => setBkNotes(e.target.value)}
                    placeholder="Specific requests or address details..."
                    className="w-full p-2.5 text-xs text-ink outline-none resize-none"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-ink/10">
                <button
                  type="button"
                  onClick={() => setBookingModalOpen(false)}
                  className="rounded-xl px-4 py-2 font-bold text-ink-500 hover:text-ink"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingBooking}
                  className="rounded-xl bg-ink px-5 py-2.5 font-bold text-cream shadow hover:bg-black disabled:opacity-50"
                >
                  {savingBooking ? "Saving..." : "Confirm Booking"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
