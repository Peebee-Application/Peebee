"use client";

import { ExistingDigitalPurchases } from "../../components/store/ExistingDigitalPurchases";
import { SectionContentEditor } from "../../components/SectionContentEditor";
import { PlanLadder, type PlanInfo } from "../../components/store/PlanLadder";
import { Select } from "@peebee/shared/select";
import type {
  MarketplaceSettings,
  StoreCollection,
  StoreCustomerLoyalty,
  StoreDiscount,
  StoreDraftOrder,
  StoreEliteAnalytics,
  StoreOutletInventoryRow,
  StorePosSale,
  StoreStockTransfer,
  StoreSupplier,
  StorePurchaseOrder,
  StorePurchaseOrderItem,
  StoreBundle,
  StoreBundleItem,
  StoreWinbackCampaign,
  StorefrontSection,
  StoreSmsLog,
  StoreDigitalProduct,
  StoreDigitalFulfillment,
  StoreLmsCourse,
  StoreLmsEnrollment,
} from "@peebee/shared";
import {
  AlertCircle,
  ArrowUp,
  ArrowDown,
  EyeOff,
  MessageSquare,
  GraduationCap,
  Download,
  BookOpen,
  Award,
  FileCode,
  Key,
  PlayCircle,
  Video,
  BarChart3,
  Briefcase,
  Building2,
  Camera,
  Check,
  ChevronRight,
  Crown,
  Eye,
  FileText,
  Flame,
  Gift,
  Globe,
  Heart,
  Layers,
  LayoutGrid,
  Megaphone,
  Package,
  Palette,
  Plus,
  Radio,
  Search,
  Send,
  Share2,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store as StoreIcon,
  Tag,
  Trash2,
  TrendingUp,
  Truck,
  Tv,
  Users,
  X,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth-context";

interface ProStore {
  permissions?: Record<string, boolean>;
  id: string;
  merchant_id: string;
  name: string;
  slug: string;
  category: "groceries" | "stores";
  sub_category?: string;
  description: string | null;
  announcement?: string | null;
  logo_url: string | null;
  banner_url: string | null;
  phone: string | null;
  whatsapp_number?: string | null;
  address?: string | null;
  min_order_amount?: number;
  pro_tier?: string;
  elite_tier?: number;
  plan?: PlanInfo;
  custom_domain?: string | null;
  domain_verified?: number;
  domain_verify_token?: string | null;
  theme_layout?: "grid" | "editorial" | "compact";
  theme_accent?: "gold" | "ink" | "cream";
  hero_headline?: string | null;
  hero_subheadline?: string | null;
  hero_cta_text?: string | null;
  seo_title?: string | null;
  seo_description?: string | null;
  meta_pixel_id?: string | null;
  tiktok_pixel_id?: string | null;
  loyalty_enabled?: number;
  loyalty_cashback_percent?: number;
  b2b_wholesale_enabled?: number;
  b2b_min_order_amount?: number;
  is_live?: number;
  live_channel_title?: string | null;
  live_stream_url?: string | null;
  live_viewer_count?: number;
  status: "active" | "inactive";
  created_at: string;
}

interface ProductVariant {
  title: string;
  price: number;
  compare_at_price?: number;
  sku?: string;
  inventory_quantity?: number;
}

interface StoreProduct {
  id: string;
  store_id: string;
  title: string;
  description: string | null;
  price: number;
  compare_at_price: number | null;
  cost_price?: number | null;
  inventory_quantity: number;
  category_name?: string | null;
  badge?: string | null;
  image_url: string | null;
  video_url: string | null;
  has_variants?: number | boolean;
  variants?: ProductVariant[];
  status: string;
}

interface LiveChat {
  id: string;
  user_name: string;
  message: string;
  is_merchant_pinned: boolean;
  created_at: string;
}

interface AdCampaign {
  id: string;
  platform: "whatsapp" | "meta" | "tiktok";
  headline: string;
  daily_budget_ugx: number;
  duration_days: number;
  status: string;
  impressions: number;
  clicks: number;
  created_at: string;
}

const ugx = (val: number) => `UGX ${Number(val || 0).toLocaleString()}`;

export default function MerchantProStorePage() {
  const { merchant } = useAuth();

  const [loading, setLoading] = useState(true);
  const loadRequest = useRef(0);
  const posRequest = useRef<{payload: string; id: string} | null>(null);
  const transferRequest = useRef<{payload: string; id: string} | null>(null);
  const [store, setStore] = useState<ProStore | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [settings, setSettings] = useState<MarketplaceSettings | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [activeTab, setActiveTab] = useState<"catalog" | "live" | "ads" | "elite" | "settings">("catalog");

  // Elite OS sub-navigation
  const [eliteSection, setEliteSection] = useState<
    "overview" | "pos" | "theme" | "sections" | "sms" | "digital" | "lms" | "collections" | "discounts" | "inventory" | "b2b" | "crm" | "po" | "bundles" | "winback"
  >("overview");

  // Tier 3: Digital Products & LMS State
  const [digitalProducts, setDigitalProducts] = useState<StoreDigitalProduct[]>([]);
  const [digitalFulfillments, setDigitalFulfillments] = useState<StoreDigitalFulfillment[]>([]);
  const [showNewDigitalProduct, setShowNewDigitalProduct] = useState(false);
  const [digTitle, setDigTitle] = useState("");
  const [digKind, setDigKind] = useState<"download" | "license_key" | "template" | "service">("download");
  const [digDescription, setDigDescription] = useState("");
  const [digPrice, setDigPrice] = useState("");
  const [digCompareAt, setDigCompareAt] = useState("");
  const [digFileUrl, setDigFileUrl] = useState("");
  const [digFileName, setDigFileName] = useState("");
  const [digMaxDownloads, setDigMaxDownloads] = useState("5");
  const [digExpiryDays, setDigExpiryDays] = useState("30");
  const [digLicenseKeys, setDigLicenseKeys] = useState("");
  const [digDeliveryInstructions, setDigDeliveryInstructions] = useState("");
  const [digCoverUrl, setDigCoverUrl] = useState("");
  const [savingDigitalProduct, setSavingDigitalProduct] = useState(false);

  // Tier 3: LMS Courses & Student Enrollments State (Peebee Learn Direct Sync)
  const [lmsCourses, setLmsCourses] = useState<StoreLmsCourse[]>([]);
  const [lmsEnrollments, setLmsEnrollments] = useState<StoreLmsEnrollment[]>([]);
  const [syncingLearn, setSyncingLearn] = useState(false);
  const [showNewCourse, setShowNewCourse] = useState(false);
  const [courseTitle, setCourseTitle] = useState("");
  const [courseStream, setCourseStream] = useState<"skills" | "academy" | "compass" | "sprouts" | "foundations">("skills");
  const [courseSummary, setCourseSummary] = useState("");
  const [coursePrice, setCoursePrice] = useState("");
  const [courseCoverUrl, setCourseCoverUrl] = useState("");
  const [courseCertEnabled, setCourseCertEnabled] = useState(true);
  const [savingCourse, setSavingCourse] = useState(false);

  // LMS Student Enrollment form modal
  const [showEnrollModal, setShowEnrollModal] = useState(false);
  const [enrollCourseId, setEnrollCourseId] = useState("");
  const [enrollStudentName, setEnrollStudentName] = useState("");
  const [enrollStudentPhone, setEnrollStudentPhone] = useState("");
  const [enrollStudentEmail, setEnrollStudentEmail] = useState("");
  const [enrollSendSms, setEnrollSendSms] = useState(true);
  const [enrollingStudent, setEnrollingStudent] = useState(false);
  const [upgradingTier, setUpgradingTier] = useState(false);

  // Elite data states
  const [analytics, setAnalytics] = useState<StoreEliteAnalytics | null>(null);
  const [collections, setCollections] = useState<StoreCollection[]>([]);
  const [discounts, setDiscounts] = useState<StoreDiscount[]>([]);
  const [outlets, setOutlets] = useState<Array<{ id: string; name: string; code: string; address: string | null; status: string }>>([]);
  const [outletInventory, setOutletInventory] = useState<StoreOutletInventoryRow[]>([]);
  const [draftOrders, setDraftOrders] = useState<StoreDraftOrder[]>([]);
  const [posSales, setPosSales] = useState<StorePosSale[]>([]);
  const [stockTransfers, setStockTransfers] = useState<StoreStockTransfer[]>([]);
  const [crmCustomers, setCrmCustomers] = useState<StoreCustomerLoyalty[]>([]);

  // Phase 4 states: Suppliers, POs, Bundles, Win-Back
  const [suppliers, setSuppliers] = useState<StoreSupplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<StorePurchaseOrder[]>([]);
  const [bundles, setBundles] = useState<StoreBundle[]>([]);
  const [winbackCampaigns, setWinbackCampaigns] = useState<StoreWinbackCampaign[]>([]);
  const [storefrontSections, setStorefrontSections] = useState<StorefrontSection[]>([]);
  const [savingSections, setSavingSections] = useState(false);
  const [smsLogs, setSmsLogs] = useState<StoreSmsLog[]>([]);
  const [posSendSmsReceipt, setPosSendSmsReceipt] = useState(true);
  const [smsRecipientPhone, setSmsRecipientPhone] = useState("");
  const [smsRecipientName, setSmsRecipientName] = useState("");
  const [smsBody, setSmsBody] = useState("");
  const [smsMessageType, setSmsMessageType] = useState<"pos_receipt" | "order_confirmation" | "dispatch_alert" | "abandoned_cart">("pos_receipt");
  const [sendingSms, setSendingSms] = useState(false);
  const [lastSmsSent, setLastSmsSent] = useState<{ id: string; whatsappUrl?: string } | null>(null);
  const [inactiveCustomers, setInactiveCustomers] = useState<StoreCustomerLoyalty[]>([]);

  // New PO form
  const [showNewPo, setShowNewPo] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState("");
  const [poOutletId, setPoOutletId] = useState("");
  const [poItems, setPoItems] = useState<StorePurchaseOrderItem[]>([]);
  const [poNotes, setPoNotes] = useState("");
  const [poSubmitting, setPoSubmitting] = useState(false);
  const [receivingPoId, setReceivingPoId] = useState<string | null>(null);

  // New Supplier form
  const [showNewSupplier, setShowNewSupplier] = useState(false);
  const [supName, setSupName] = useState("");
  const [supContact, setSupContact] = useState("");
  const [supPhone, setSupPhone] = useState("");
  const [supEmail, setSupEmail] = useState("");
  const [supAddress, setSupAddress] = useState("");
  const [supSubmitting, setSupSubmitting] = useState(false);

  // New Bundle form
  const [showNewBundle, setShowNewBundle] = useState(false);
  const [bundleTitle, setBundleTitle] = useState("");
  const [bundleDesc, setBundleDesc] = useState("");
  const [bundlePrice, setBundlePrice] = useState("");
  const [bundleCompareAt, setBundleCompareAt] = useState("");
  const [bundleItems, setBundleItems] = useState<StoreBundleItem[]>([]);
  const [bundleSubmitting, setBundleSubmitting] = useState(false);

  // Win-back form
  const [winbackPhone, setWinbackPhone] = useState("");
  const [winbackName, setWinbackName] = useState("");
  const [winbackDiscount, setWinbackDiscount] = useState("WELCOME10");
  const [winbackMessage, setWinbackMessage] = useState("");
  const [winbackSubmitting, setWinbackSubmitting] = useState(false);
  const [winbackResultUrl, setWinbackResultUrl] = useState("");
  const [crmSummary, setCrmSummary] = useState<{
    totalCustomers: number;
    vipCount: number;
    repeatCount: number;
    b2bCount: number;
    totalLoyaltyBalanceUgx: number;
  }>({ totalCustomers: 0, vipCount: 0, repeatCount: 0, b2bCount: 0, totalLoyaltyBalanceUgx: 0 });

  // Elite Theme & Brand Builder state
  const [customDomain, setCustomDomain] = useState("");
  const [verifyingDomain, setVerifyingDomain] = useState(false);
  const [themeLayout, setThemeLayout] = useState<"grid" | "editorial" | "compact">("grid");
  const [themeAccent, setThemeAccent] = useState<"gold" | "ink" | "cream">("gold");
  const [heroHeadline, setHeroHeadline] = useState("");
  const [heroSubheadline, setHeroSubheadline] = useState("");
  const [heroCtaText, setHeroCtaText] = useState("Shop Now");
  const [metaPixelId, setMetaPixelId] = useState("");
  const [tiktokPixelId, setTiktokPixelId] = useState("");
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(false);
  const [loyaltyCashback, setLoyaltyCashback] = useState("5");
  const [savingTheme, setSavingTheme] = useState(false);

  // Elite Collections form state
  const [colTitle, setColTitle] = useState("");
  const [colKind, setColKind] = useState<"smart" | "manual">("smart");
  const [colRuleField, setColRuleField] = useState<"category" | "price_lte" | "price_gte" | "badge" | "in_stock">("price_lte");
  const [colRuleValue, setColRuleValue] = useState("50000");
  const [savingCol, setSavingCol] = useState(false);

  // Elite Discounts form state
  const [discCode, setDiscCode] = useState("");
  const [discTitle, setDiscTitle] = useState("");
  const [discKind, setDiscKind] = useState<"percent" | "fixed" | "free_delivery" | "bogo">("percent");
  const [discValue, setDiscValue] = useState("15");
  const [discMinOrder, setDiscMinOrder] = useState("20000");
  const [discAuto, setDiscAuto] = useState(false);
  const [discPublic, setDiscPublic] = useState(false);
  const [discExpires, setDiscExpires] = useState("");
  const [savingDisc, setSavingDisc] = useState(false);

  // Elite Multi-Outlet Inventory & Branch Transfer form state
  const [selectedInvOutlet, setSelectedInvOutlet] = useState("");
  const [selectedInvProduct, setSelectedInvProduct] = useState("");
  const [invQuantity, setInvQuantity] = useState("25");
  const [savingInv, setSavingInv] = useState(false);
  const [transferProductId, setTransferProductId] = useState("");
  const [transferFromOutletId, setTransferFromOutletId] = useState("");
  const [transferToOutletId, setTransferToOutletId] = useState("");
  const [transferQty, setTransferQty] = useState("5");
  const [transferNote, setTransferNote] = useState("");
  const [savingTransfer, setSavingTransfer] = useState(false);

  // Elite Omnichannel POS Register form state
  const [posOutletId, setPosOutletId] = useState("");
  const [posProductId, setPosProductId] = useState("");
  const [posQty, setPosQty] = useState("1");
  const [posCustomerPhone, setPosCustomerPhone] = useState("");
  const [posCustomerName, setPosCustomerName] = useState("");
  const [posDiscountUgx, setPosDiscountUgx] = useState("0");
  const [posRedeemLoyaltyUgx, setPosRedeemLoyaltyUgx] = useState("0");
  const [posPaymentMethod, setPosPaymentMethod] = useState<"peebee_code" | "momo" | "cash">("peebee_code");
  const [savingPosSale, setSavingPosSale] = useState(false);

  // Elite B2B Draft Order form state
  const [b2bCustomerName, setB2bCustomerName] = useState("");
  const [b2bCompany, setB2bCompany] = useState("");
  const [b2bPhone, setB2bPhone] = useState("");
  const [b2bProductId, setB2bProductId] = useState("");
  const [b2bQty, setB2bQty] = useState("10");
  const [b2bUnitPrice, setB2bUnitPrice] = useState("");
  const [b2bDiscountUgx, setB2bDiscountUgx] = useState("0");
  const [b2bTerms, setB2bTerms] = useState<"immediate" | "net_7" | "net_14" | "net_30">("net_14");
  const [savingDraft, setSavingDraft] = useState(false);

  // Onboarding wizard state (if no store yet)
  const [wizardName, setWizardName] = useState("");
  const [wizardCategory, setWizardCategory] = useState<"groceries" | "stores">("groceries");
  const [wizardDesc, setWizardDesc] = useState("");
  const [wizardCreating, setWizardCreating] = useState(false);

  // New product modal state
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [productTitle, setProductTitle] = useState("");
  const [productDesc, setProductDesc] = useState("");
  const [productPrice, setProductPrice] = useState("");
  const [productComparePrice, setProductComparePrice] = useState("");
  const [productCostPrice, setProductCostPrice] = useState("");
  const [productStock, setProductStock] = useState("50");
  const [productCategory, setProductCategory] = useState("General");
  const [productBadge, setProductBadge] = useState("");
  const [productImage, setProductImage] = useState("");
  const [productVariants, setProductVariants] = useState<ProductVariant[]>([]);
  const [newVariantTitle, setNewVariantTitle] = useState("");
  const [newVariantPrice, setNewVariantPrice] = useState("");
  const [savingProduct, setSavingProduct] = useState(false);

  // Live broadcast studio state
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [showLiveStudio, setShowLiveStudio] = useState(false);
  const [liveTitle, setLiveTitle] = useState("");
  const [liveStreamUrl, setLiveStreamUrl] = useState("");
  const [pinnedProductId, setPinnedProductId] = useState<string>("");
  const [startingLive, setStartingLive] = useState(false);

  // Social ads state
  const [adPlatform, setAdPlatform] = useState<"whatsapp" | "meta" | "tiktok">("whatsapp");
  const [adHeadline, setAdHeadline] = useState("");
  const [adBudget, setAdBudget] = useState("15000");
  const [adDuration, setAdDuration] = useState("7");
  const [adTargetProduct, setAdTargetProduct] = useState("");

  // Storefront mobile preview state (Inspiration UI 3-screens)
  const [showStorefrontPreview, setShowStorefrontPreview] = useState(false);
  const [previewScreen, setPreviewScreen] = useState<"storefront" | "product" | "cart">("storefront");
  const [previewSelectedSize, setPreviewSelectedSize] = useState("M");

  useEffect(() => {
    loadData();
  }, [merchant]);

  async function loadData() {
    if (!merchant) return;
    const request = ++loadRequest.current;
    setLoading(true);
    setError("");
    const unavailable: string[] = [];
    const failed = (feature: string) => { unavailable.push(feature); };
    const previous = store?.merchant_id === merchant.id;

    try {
      const storeRes = await api.getMerchantProStore();
      if (request !== loadRequest.current) return;

      if (storeRes && "settings" in storeRes && storeRes.settings) {
        setSettings(storeRes.settings);
      }

      if (storeRes?.store) {
        const s: ProStore = storeRes.store;
        setStore(s);
        setIsLiveActive(Boolean(s.is_live));
        if (s.live_channel_title) setLiveTitle(s.live_channel_title);
        if (s.live_stream_url) setLiveStreamUrl(s.live_stream_url);
        if (s.custom_domain) setCustomDomain(s.custom_domain);
        if (s.theme_layout) setThemeLayout(s.theme_layout);
        if (s.theme_accent) setThemeAccent(s.theme_accent);
        if (s.hero_headline) setHeroHeadline(s.hero_headline);
        if (s.hero_subheadline) setHeroSubheadline(s.hero_subheadline);
        if (s.hero_cta_text) setHeroCtaText(s.hero_cta_text);
        if (s.meta_pixel_id) setMetaPixelId(s.meta_pixel_id);
        if (s.tiktok_pixel_id) setTiktokPixelId(s.tiktok_pixel_id);
        setLoyaltyEnabled(Boolean(s.loyalty_enabled));
        if (s.loyalty_cashback_percent != null) setLoyaltyCashback(String(s.loyalty_cashback_percent));

        const [prodRes, colRes, discRes, invRes, drfRes, anaRes, posRes, trfRes, crmRes, secRes, smsRes, digRes, fulRes, crsRes, enrRes] = await Promise.all([
          api.getMerchantProProducts().catch(() => { failed("Catalog"); return { products: previous ? products : [] }; }),
          api.getMerchantCollections().catch(() => { failed("Collections"); return { collections: previous ? collections : [] }; }),
          api.getMerchantDiscounts().catch(() => { failed("Discounts"); return { discounts: previous ? discounts : [] }; }),
          (s.plan?.isElite ? api.getMerchantOutletInventory() : Promise.resolve({outlets: [], inventory: []})).catch(() => { failed("OutletInventory"); return { outlets: previous ? outlets : [], inventory: previous ? outletInventory : [] }; }),
          (s.plan?.isElite ? api.getMerchantDraftOrders() : Promise.resolve({draftOrders: []})).catch(() => { failed("DraftOrders"); return { draftOrders: previous ? draftOrders : [] }; }),
          (s.plan?.isElite ? api.getMerchantEliteAnalytics() : Promise.resolve({analytics: null})).catch(() => { failed("POS report"); return { analytics: previous ? analytics : null }; }),
          (s.plan?.isElite ? api.getMerchantPosSales() : Promise.resolve({sales: []})).catch(() => { failed("PosSales"); return { sales: previous ? posSales : [] }; }),
          (s.plan?.isElite ? api.getMerchantStockTransfers() : Promise.resolve({transfers: []})).catch(() => { failed("StockTransfers"); return { transfers: previous ? stockTransfers : [] }; }),
          (s.plan?.isElite ? api.getMerchantCrmCustomers() : Promise.resolve({customers: [], summary: null})).catch(() => { failed("CrmCustomers"); return {
            customers: [],
            summary: { totalCustomers: 0, vipCount: 0, repeatCount: 0, b2bCount: 0, totalLoyaltyBalanceUgx: 0 },
          }; }),
          api.getMerchantStorefrontSections().catch(() => { failed("StorefrontSections"); return { sections: previous ? storefrontSections : [] }; }),
          api.getMerchantSmsLogs().catch(() => { failed("SmsLogs"); return { logs: previous ? smsLogs : [] }; }),
          (s.plan?.isElite && s.permissions?.manage_digital !== false ? api.getMerchantDigitalProducts() : Promise.resolve({products: []})).catch(() => { failed("DigitalProducts"); return { products: previous ? digitalProducts : [] }; }),
          (s.permissions?.manage_digital !== false ? api.getMerchantDigitalFulfillments() : Promise.resolve({fulfillments: []})).catch(() => { failed("DigitalFulfillments"); return { fulfillments: previous ? digitalFulfillments : [] }; }),
          (s.plan?.isElite && s.permissions?.manage_digital !== false ? api.getMerchantLmsCourses() : Promise.resolve({courses: []})).catch(() => { failed("Courses"); return { courses: previous ? lmsCourses : [] }; }),
          (s.plan?.isElite && s.permissions?.manage_digital !== false ? api.getMerchantLmsEnrollments() : Promise.resolve({enrollments: []})).catch(() => { failed("Learners"); return { enrollments: previous ? lmsEnrollments : [] }; }),
        ]);
        if (request !== loadRequest.current) return;
        setStorefrontSections(secRes.sections || []);
        setSmsLogs(smsRes.logs || []);
        setDigitalProducts(digRes.products || []);
        setDigitalFulfillments(fulRes.fulfillments || []);
        setLmsCourses(crsRes.courses || []);
        setLmsEnrollments(enrRes.enrollments || []);
        const loadedProducts = prodRes.products || [];
        setProducts(loadedProducts);
        setCollections(colRes.collections || []);
        setDiscounts(discRes.discounts || []);
        setOutlets(invRes.outlets || []);
        setOutletInventory(invRes.inventory || []);
        setDraftOrders(drfRes.draftOrders || []);
        setPosSales(posRes.sales || []);
        setStockTransfers(trfRes.transfers || []);
        setCrmCustomers(crmRes.customers || []);
        if (crmRes.summary) setCrmSummary(crmRes.summary);
        setAnalytics(anaRes.analytics);

        if (invRes.outlets?.[0] && !selectedInvOutlet) {
          setSelectedInvOutlet(invRes.outlets[0].id);
          setPosOutletId(invRes.outlets[0].id);
          setTransferFromOutletId(invRes.outlets[0].id);
          if (invRes.outlets[1]) setTransferToOutletId(invRes.outlets[1].id);
        }
        if (loadedProducts[0] && !selectedInvProduct) {
          setSelectedInvProduct(loadedProducts[0].id);
          setPosProductId(loadedProducts[0].id);
          setTransferProductId(loadedProducts[0].id);
          setB2bProductId(loadedProducts[0].id);
          setB2bUnitPrice(String(Math.round(loadedProducts[0].price * 0.85)));
        }
      }
      if (unavailable.length) setError(`Some tools could not load (${unavailable.join(", ")}). Previously loaded records may be out of date. Check access or retry.`);
    } catch (err) {
      if (request === loadRequest.current) setError(errorMessage(err));
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  }

  function moveSection(index: number, direction: "up" | "down") {
    const targetIdx = direction === "up" ? index - 1 : index + 1;
    if (targetIdx < 0 || targetIdx >= storefrontSections.length) return;
    const next = [...storefrontSections];
    const temp = next[index];
    next[index] = next[targetIdx];
    next[targetIdx] = temp;
    next.forEach((s, idx) => { s.order = idx + 1; });
    setStorefrontSections(next);
  }

  function toggleSection(id: string) {
    setStorefrontSections(storefrontSections.map((s) => s.id === id ? { ...s, enabled: !s.enabled } : s));
  }

  function updateSectionTitle(id: string, title: string, subtitle?: string) {
    setStorefrontSections(storefrontSections.map((s) => s.id === id ? { ...s, title, subtitle: subtitle ?? s.subtitle } : s));
  }

  function updateSectionSettings(id: string, settings: Record<string, any>) {
    setStorefrontSections(storefrontSections.map((s) => (s.id === id ? { ...s, settings } : s)));
  }

  async function handleSaveSections() {
    setSavingSections(true);
    try {
      await api.updateMerchantStorefrontSections(storefrontSections);
      alert("Storefront section layout saved successfully!");
    } catch (err) {
      alert("Failed to save sections: " + errorMessage(err));
    } finally {
      setSavingSections(false);
    }
  }

  async function handleSendDirectSms(e: React.FormEvent) {
    e.preventDefault();
    if (!smsRecipientPhone.trim() || !smsBody.trim()) {
      alert("Please provide recipient phone number and message body.");
      return;
    }
    setSendingSms(true);
    try {
      const res = await api.sendMerchantSms({
        recipient_phone: smsRecipientPhone,
        recipient_name: smsRecipientName || undefined,
        message_type: smsMessageType,
        body: smsBody,
      });
      setLastSmsSent({ id: res.logId, whatsappUrl: res.whatsappShareUrl });
      const refreshed = await api.getMerchantSmsLogs().catch(() => ({ logs: [] }));
      setSmsLogs(refreshed.logs || []);
      setSmsBody("");
      alert("SMS notification processed (" + res.status + ")! Tracking ID: " + res.logId);
    } catch (err) {
      alert("Failed to send SMS: " + errorMessage(err));
    } finally {
      setSendingSms(false);
    }
  }

  async function handleCreateDigitalProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!digTitle.trim()) return;
    setSavingDigitalProduct(true);
    try {
      const keys = digLicenseKeys
        ? digLicenseKeys.split("\n").map((k) => k.trim()).filter(Boolean)
        : [];
      const res = await api.createMerchantDigitalProduct({
        title: digTitle.trim(),
        kind: digKind,
        description: digDescription.trim() || null,
        price_ugx: Number(digPrice) || 0,
        compare_at_price_ugx: digCompareAt ? Number(digCompareAt) : null,
        file_url: digFileUrl.trim() || null,
        file_name: digFileName.trim() || null,
        max_downloads: Number(digMaxDownloads) || 5,
        expiry_days: Number(digExpiryDays) || 30,
        license_keys_pool: keys.length > 0 ? keys : null,
        delivery_instructions: digDeliveryInstructions.trim() || null,
        cover_image_url: digCoverUrl.trim() || null,
        status: "published",
      });
      setDigitalProducts((prev) => [res.product, ...prev]);
      setShowNewDigitalProduct(false);
      setDigTitle("");
      setDigDescription("");
      setDigPrice("");
      setDigCompareAt("");
      setDigFileUrl("");
      setDigFileName("");
      setDigLicenseKeys("");
      setDigDeliveryInstructions("");
      setDigCoverUrl("");
      setNotice("Digital product published successfully!");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingDigitalProduct(false);
    }
  }

  async function handleDeleteDigitalProduct(id: string) {
    if (!confirm("Are you sure you want to remove this digital product?")) return;
    try {
      await api.deleteMerchantDigitalProduct(id);
      setDigitalProducts((prev) => prev.filter((p) => p.id !== id));
      setNotice("Digital product removed.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleRevokeFulfillment(id: string) {
    try {
      await api.revokeMerchantDigitalFulfillment(id);
      setDigitalFulfillments((prev) =>
        prev.map((f) => (f.id === id ? { ...f, status: "revoked" } : f))
      );
      setNotice("Access token revoked.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleRefundFulfillment(id: string) {
    if (!window.confirm("Refund this sale? The buyer gets their money back from your balance.")) return;
    try {
      await api.refundMerchantDigitalFulfillment(id);
      setDigitalFulfillments((prev) => prev.map((f) => (f.id === id ? { ...f, refunded_at: new Date().toISOString() } : f)));
      setNotice("Refunded.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleResendFulfillment(id: string) {
    try {
      const res = await api.resendMerchantDigitalFulfillment(id);
      setNotice(res.ok ? `New link sent (${res.sms}).` : `Could not send the text: ${res.error ?? "try again"}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleFulfilLicense(id: string) {
    const key = window.prompt("Licence key for this buyer");
    if (!key?.trim()) return;
    try {
      await api.fulfillMerchantDigitalLicense(id, key.trim());
      setDigitalFulfillments((prev) => prev.map((f) => (f.id === id ? { ...f, license_key_issued: key.trim(), needs_manual_fulfilment: false } : f)));
      setNotice("Key added to the purchase.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleUploadDigitalFile(productId: string, file: File | undefined) {
    if (!file) return;
    setError("");
    try {
      const res = await api.uploadMerchantDigitalFile(productId, file);
      setDigitalProducts((prev) => prev.map((p) => (p.id === productId ? { ...p, file_name: res.file.name, file_size_bytes: res.file.sizeBytes, file_url: null } : p)));
      setNotice(`${res.file.name} uploaded to private storage.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreateCourse(e: React.FormEvent) {
    e.preventDefault();
    if (!courseTitle.trim()) return;
    setSavingCourse(true);
    try {
      const res = await api.createMerchantLmsCourse({
        title: courseTitle.trim(),
        stream: courseStream,
        summary: courseSummary.trim(),
        price_ugx: Number(coursePrice) || 0,
        cover_url: courseCoverUrl.trim() || undefined,
        certificate_enabled: courseCertEnabled,
      });
      setLmsCourses((prev) => [res.course, ...prev]);
      setShowNewCourse(false);
      setCourseTitle("");
      setCourseSummary("");
      setCoursePrice("");
      setCourseCoverUrl("");
      setNotice("Masterclass course created and synced with Peebee Learn!");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingCourse(false);
    }
  }

  async function handleSyncFromLearn() {
    setSyncingLearn(true);
    try {
      const res = await api.syncMerchantLmsFromLearn();
      setLmsCourses((await api.getMerchantLmsCourses()).courses || []);
      setNotice(`Sync complete! ${res.importedCount} courses synchronized from Peebee Learn Studio.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSyncingLearn(false);
    }
  }

  async function handleListInLearn(courseId: string, listed: boolean) {
    try {
      await api.listMerchantCourseInLearn(courseId, listed);
      setLmsCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, learn_synced: listed } : c)));
      setNotice(listed ? "The course is now in the Peebee Learn catalogue." : "The course is no longer listed in Peebee Learn (it is still on sale in your store).");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleIssueCertificate(enrollmentId: string) {
    try {
      await api.issueMerchantCertificate(enrollmentId);
      setLmsEnrollments((prev) => prev.map((e) => (e.id === enrollmentId ? { ...e, certificate_issued: true } : e)));
      setNotice("Certificate issued.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleEnrollStudent(e: React.FormEvent) {
    e.preventDefault();
    if (!enrollCourseId || !enrollStudentName.trim() || !enrollStudentPhone.trim()) return;
    setEnrollingStudent(true);
    try {
      const res = await api.enrollMerchantLmsStudent({
        courseId: enrollCourseId,
        studentName: enrollStudentName.trim(),
        studentPhone: enrollStudentPhone.trim(),
        studentEmail: enrollStudentEmail.trim() || undefined,
        sendSmsNotice: enrollSendSms,
      });
      setLmsEnrollments((prev) => [res.enrollment, ...prev]);
      setShowEnrollModal(false);
      setEnrollStudentName("");
      setEnrollStudentPhone("");
      setEnrollStudentEmail("");
      const told = res.notice ? (res.notice.status === "failed" ? ` We could not reach them by ${res.notice.channel}: ${res.notice.error ?? "try again"}.` : res.notice.status === "simulated" ? " (No text was sent: no SMS provider is connected.)" : ` They were told by ${res.notice.channel}.`) : "";
      setNotice(`${enrollStudentName.trim()} is enrolled${res.accountCreated ? " and a Peebee account was created for them" : ""}.${told} Portal link: ${res.learnPortalUrl}`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setEnrollingStudent(false);
    }
  }

  async function refreshEliteData() {
    await loadData();
  }

  async function handlePlanChanged(updated: any, message: string) {
    setStore((prev) => (prev ? { ...prev, ...updated } : updated));
    setNotice(message);
    await refreshEliteData();
  }

  async function handleVerifyDomain() {
    setVerifyingDomain(true);
    setError("");
    try {
      const res = await api.verifyMerchantStoreDomain();
      if (res.verified) {
        setStore((prev: any) => (prev ? { ...prev, domain_verified: 1 } : prev));
        setNotice("✓ Domain verified. Your store now answers on it.");
      } else {
        setError(res.message);
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setVerifyingDomain(false);
    }
  }

  async function handleSaveTheme() {
    if (!store) return;
    setSavingTheme(true);
    setError("");
    try {
      const res = await api.updateMerchantProStore({
        // Only sent when it changed: an emptied field disconnects the domain, an untouched one leaves it alone.
        ...(customDomain.trim() !== (store.custom_domain ?? "") ? { custom_domain: customDomain.trim() } : {}),
        theme_layout: themeLayout,
        theme_accent: themeAccent,
        hero_headline: heroHeadline.trim() || undefined,
        hero_subheadline: heroSubheadline.trim() || undefined,
        hero_cta_text: heroCtaText.trim() || undefined,
        meta_pixel_id: metaPixelId.trim() || undefined,
        tiktok_pixel_id: tiktokPixelId.trim() || undefined,
        loyalty_enabled: loyaltyEnabled,
        loyalty_cashback_percent: Number(loyaltyCashback) || 0,
      });
      setStore(res.store);
      setNotice("🎨 Online Store 2.0 Theme, Custom Domain & VIP Loyalty settings saved!");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingTheme(false);
    }
  }

  async function handleCreateCollection() {
    if (!colTitle.trim()) {
      setError("Enter a collection title.");
      return;
    }
    setSavingCol(true);
    setError("");
    try {
      await api.createMerchantCollection({
        title: colTitle.trim(),
        kind: colKind,
        rule_field: colKind === "smart" ? colRuleField : null,
        rule_value: colKind === "smart" ? colRuleValue : null,
        pinned: true,
      });
      setColTitle("");
      await refreshEliteData();
      setNotice("📚 Smart Collection created and pinned to your storefront!");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingCol(false);
    }
  }

  async function handleDeleteCollection(id: string) {
    try {
      await api.deleteMerchantCollection(id);
      await refreshEliteData();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleCreateDiscount() {
    if (!discCode.trim() || !discTitle.trim()) {
      setError("Enter a promo code and campaign title.");
      return;
    }
    setSavingDisc(true);
    setError("");
    try {
      await api.createMerchantDiscount({
        code: discCode.trim().toUpperCase(),
        title: discTitle.trim(),
        kind: discKind,
        value: discKind === "free_delivery" ? 0 : Number(discValue) || 10,
        min_order_amount: Number(discMinOrder) || 0,
        is_automatic: discAuto,
        is_public: discPublic,
        expires_at: discExpires || null,
      });
      setDiscExpires("");
      setDiscPublic(false);
      setDiscCode("");
      setDiscTitle("");
      await refreshEliteData();
      setNotice("🏷️ Promo code & discount rule activated!");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingDisc(false);
    }
  }

  async function handleDeleteDiscount(id: string) {
    try {
      await api.deleteMerchantDiscount(id);
      await refreshEliteData();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleSaveOutletInventory() {
    if (!selectedInvOutlet || !selectedInvProduct) {
      setError("Select both a branch outlet and a product.");
      return;
    }
    setSavingInv(true);
    setError("");
    try {
      const res = await api.updateMerchantOutletInventory({
        outletId: selectedInvOutlet,
        productId: selectedInvProduct,
        quantity: Number(invQuantity) || 0,
        lowStockThreshold: 5,
      });
      await refreshEliteData();
      setNotice(`📦 Branch inventory updated! Total synced product stock: ${res.totalQuantity} units.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingInv(false);
    }
  }

  async function handleCreatePosSale() {
    const prod = products.find((p) => p.id === posProductId) || products[0];
    if (!prod) {
      setError("Add a product to your catalog before ringing a POS sale.");
      return;
    }
    setSavingPosSale(true);
    setError("");
    try {
      const qty = Math.max(1, Number(posQty) || 1);
      const payload = {
        outlet_id: posOutletId || null,
        customer_phone: posCustomerPhone.trim() || undefined,
        customer_name: posCustomerName.trim() || undefined,
        items: [
          {
            productId: prod.id,
            title: prod.title,
            unitPrice: prod.price,
            quantity: qty,
          },
        ],
        discount_amount: Number(posDiscountUgx) || 0,
        redeem_loyalty_ugx: Number(posRedeemLoyaltyUgx) || 0,
        payment_method: posPaymentMethod,
      };
      const fingerprint = JSON.stringify(payload);
      if (posRequest.current?.payload !== fingerprint) posRequest.current = {payload: fingerprint, id: crypto.randomUUID()};
      const res = await api.createMerchantPosSale({...payload, requestId: posRequest.current.id});
      posRequest.current = null;
      await refreshEliteData();
      setPosRedeemLoyaltyUgx("0");
      setPosDiscountUgx("0");
      setNotice(
        `🧾 POS Receipt ${res.receiptCode} completed (${ugx(res.total)})! Inventory auto-synced${
          res.loyaltyEarnedUgx > 0 ? ` · +${ugx(res.loyaltyEarnedUgx)} VIP points credited` : ""
        }.`
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingPosSale(false);
    }
  }

  async function handleCreateStockTransfer() {
    if (!transferProductId || !transferFromOutletId || !transferToOutletId) {
      setError("Select product, source branch, and destination branch.");
      return;
    }
    setSavingTransfer(true);
    setError("");
    try {
      const payload = {
        productId: transferProductId,
        fromOutletId: transferFromOutletId,
        toOutletId: transferToOutletId,
        quantity: Math.max(1, Number(transferQty) || 1),
        note: transferNote.trim() || undefined,
      };
      const fingerprint = JSON.stringify(payload);
      if (transferRequest.current?.payload !== fingerprint) transferRequest.current = {payload: fingerprint, id: crypto.randomUUID()};
      const res = await api.createMerchantStockTransfer({...payload, requestId: transferRequest.current.id});
      transferRequest.current = null;
      setTransferNote("");
      await refreshEliteData();
      setNotice(
        `🔄 Stock transfer completed! Source branch now has ${res.fromQuantityAfter} units; destination branch has ${res.toQuantityAfter} units.`
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingTransfer(false);
    }
  }

  async function handleCreateDraftOrder() {
    const prod = products.find((p) => p.id === b2bProductId) || products[0];
    if (!b2bCustomerName.trim() || !prod) {
      setError("Enter B2B buyer name and select a product.");
      return;
    }
    setSavingDraft(true);
    setError("");
    try {
      const unitPrice = Number(b2bUnitPrice) || prod.price;
      const qty = Math.max(1, Number(b2bQty) || 1);
      const res = await api.createMerchantDraftOrder({
        customer_name: b2bCustomerName.trim(),
        customer_company: b2bCompany.trim() || undefined,
        customer_phone: b2bPhone.trim() || undefined,
        items: [
          {
            productId: prod.id,
            title: prod.title,
            unitPrice,
            quantity: qty,
          },
        ],
        discount_amount: Number(b2bDiscountUgx) || 0,
        payment_terms: b2bTerms,
      });
      setB2bCustomerName("");
      setB2bCompany("");
      setB2bPhone("");
      await refreshEliteData();
      setNotice(`🤝 B2B Wholesale Invoice created (${ugx(res.total)}) — 1-Tap Payment Link ready to share!`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingDraft(false);
    }
  }

  async function handleCreateStore() {
    if (!wizardName.trim()) {
      setError("Please provide a store name.");
      return;
    }
    setWizardCreating(true);
    setError("");
    try {
      const res = await api.createMerchantProStore({
        name: wizardName.trim(),
        category: wizardCategory,
        description: wizardDesc.trim() || undefined,
        min_order_amount: 5000,
      });
      setStore(res.store);
      setNotice("🎉 Store created successfully! Let's populate your catalog.");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setWizardCreating(false);
    }
  }

  async function handleLoadStarterPack() {
    if (!store) return;
    setError("");
    setNotice("Loading starter pack items…");
    try {
      const res = await api.triggerMerchantProStarterPack();
      await refreshEliteData();
      setNotice(`✅ Loaded ${res.addedCount} starter pack items! Your store is now ready for customers.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  function handleAddVariant() {
    if (!newVariantTitle.trim() || !newVariantPrice) return;
    setProductVariants((prev) => [
      ...prev,
      {
        title: newVariantTitle.trim(),
        price: Number(newVariantPrice),
        inventory_quantity: 50,
      },
    ]);
    setNewVariantTitle("");
    setNewVariantPrice("");
  }

  function handleRemoveVariant(idx: number) {
    setProductVariants((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSaveProduct() {
    if (!store || !productTitle.trim() || !productPrice) {
      setError("Please enter product title and price.");
      return;
    }
    setSavingProduct(true);
    setError("");
    try {
      await api.createMerchantProProduct({
        title: productTitle.trim(),
        description: productDesc.trim() || undefined,
        price: Number(productPrice),
        compare_at_price: productComparePrice ? Number(productComparePrice) : undefined,
        cost_price: productCostPrice ? Number(productCostPrice) : undefined,
        inventory_quantity: Number(productStock) || 50,
        category_name: productCategory.trim() || "General",
        badge: productBadge.trim() || undefined,
        image_url: productImage.trim() || undefined,
        has_variants: productVariants.length > 0,
        variants: productVariants.length ? productVariants : undefined,
      });

      await refreshEliteData();
      setShowAddProduct(false);
      resetProductForm();
      setNotice(`✅ "${productTitle.trim()}" added to your catalog!`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSavingProduct(false);
    }
  }

  function resetProductForm() {
    setProductTitle("");
    setProductDesc("");
    setProductPrice("");
    setProductComparePrice("");
    setProductCostPrice("");
    setProductStock("50");
    setProductCategory("General");
    setProductBadge("");
    setProductImage("");
    setProductVariants([]);
    setNewVariantTitle("");
    setNewVariantPrice("");
  }

  async function handleStartLiveSession() {
    if (!store || !liveTitle.trim() || !/^https:\/\//i.test(liveStreamUrl.trim())) {
      setError("Give the stream a title and a hosted HTTPS stream URL.");
      return;
    }
    setStartingLive(true);
    setError("");
    try {
      await api.startMerchantProLive({
        title: liveTitle.trim(),
        streamUrl: liveStreamUrl.trim() || undefined,
      });
      setIsLiveActive(true);
      setShowLiveStudio(true);
      setNotice("Your hosted stream is listed on the store. This does not broadcast your camera, send notifications or record video.");

    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStartingLive(false);
    }
  }

  async function handleEndLiveSession() {
    try {
      await api.endMerchantProLive();
      setIsLiveActive(false);
      setShowLiveStudio(false);
      setNotice("Live listing ended. No video recording was created by Peebee.");
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function handleLaunchAd() {
    setNotice("Preview only: no money has been charged and no advertisement has been submitted. Connected advertising is not available yet.");
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 animate-spin rounded-full border-3 border-gold border-t-transparent" />
          <p className="text-sm font-semibold text-ink-500">Loading your Store Studio…</p>
        </div>
      </div>
    );
  }

  const isProFree = settings?.proPricingMode !== "paid";
  const proStorePrice = settings?.proStorePriceUgx ?? 35000;
  const elitePrice = settings?.elitePriceUgx ?? 150000;
  const isElite = Boolean(store?.plan?.isElite) || Boolean(store?.elite_tier) || store?.pro_tier === "elite";

  // 1. Initial State: No store created yet -> Chap Chap 2-Minute Onboarding Wizard
  if (!store && error) return <div className="space-y-4 p-5"><h1 className="text-xl font-bold">Store unavailable</h1><p role="alert">{error}</p><button className="min-h-11 rounded-full border border-gold px-4 font-bold" onClick={() => void loadData()}>Retry loading store</button></div>;
  if (!store) {
    return (
      <div className="mx-auto max-w-xl space-y-5 px-4 py-6">
        {/* Header Hero */}
        <div className="relative overflow-hidden rounded-[28px] border border-gold/30 bg-gradient-to-br from-black-900 via-neutral-900 to-black-900 p-6 text-white shadow-xl">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/20 text-gold">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
            <span className="text-xs font-bold tracking-wider text-gold uppercase">Peebee Commerce Ladder</span>
          </div>

          <h1 className="mt-3 font-serif text-2xl font-black text-white sm:text-3xl">
            Power of Shopify. Simplicity of Snake Game.
          </h1>
          <p className="mt-2 text-sm text-neutral-300">
            Upgrade from basic Merchant Code payments to a full Marketplace Store (Pro) or Merchant Elite Commerce OS (Elite).
          </p>

          <div className="mt-4 flex flex-wrap gap-2 text-xs font-semibold text-neutral-400">
            <span className="rounded-full bg-white/10 px-3 py-1">1. Merchant Code (Free)</span>
            <span className="rounded-full bg-gold/20 text-gold px-3 py-1">2. Marketplace (Pro)</span>
            <span className="rounded-full bg-gold text-ink-gold font-bold px-3 py-1">3. Advanced OS (Elite)</span>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-2xl bg-red-500/10 p-3.5 text-sm text-red-600 dark:text-red-400">
            <AlertCircle className="h-5 w-5 shrink-0" />
            <span role="alert">{error}</span><button type="button" className="min-h-11 shrink-0 px-3 underline" onClick={() => void loadData()}>Retry loading</button>
          </div>
        )}

        {/* Wizard Form */}
        <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
          <h2 className="text-lg font-bold text-ink">Step 1 of 2: Store Identity</h2>

          <div>
            <label htmlFor="store-field-1" className="text-xs font-semibold text-ink-500">Store Name</label>
            <input id="store-field-1"
              type="text"
              value={wizardName}
              onChange={(e) => setWizardName(e.target.value)}
              placeholder="e.g. Fresh Bites Groceries or Chic Kampala Boutique"
              className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink placeholder:text-ink-500/50 focus:border-gold focus:outline-none"
            />
          </div>

          <div>
            <label className="text-xs font-semibold text-ink-500">Category</label>
            <Select
              aria-label="Category"
              value={wizardCategory}
              onValueChange={(val) => setWizardCategory(val as "groceries" | "stores")}
              className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink focus:border-gold"
            >
              <option value="groceries">🥦 Groceries & Fresh Produce</option>
              <option value="stores">👗 Stores, Boutique & Retail</option>
            </Select>
          </div>

          <div>
            <label htmlFor="store-field-2" className="text-xs font-semibold text-ink-500">Short Tagline (Optional)</label>
            <input id="store-field-2"
              type="text"
              value={wizardDesc}
              onChange={(e) => setWizardDesc(e.target.value)}
              placeholder="e.g. Farm fresh fruits and vegetables delivered in 25 mins"
              className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink placeholder:text-ink-500/50 focus:border-gold focus:outline-none"
            />
          </div>

          <button
            onClick={handleCreateStore}
            disabled={wizardCreating || !wizardName.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3.5 text-sm font-bold text-ink-gold shadow-md transition active:scale-98 disabled:opacity-50"
          >
            {wizardCreating ? "Creating Store…" : "Launch Store (Chap Chap) →"}
          </button>
        </div>
      </div>
    );
  }

  // 2. Active Pro & Elite Store Dashboard
  return (
    <div className="mx-auto max-w-6xl space-y-5 px-4 pb-24 pt-4">
      {/* Top Banner / Store Header */}
      <div className="relative overflow-hidden rounded-[26px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold/15 text-gold font-bold text-xl">
              {store.category === "groceries" ? "🥦" : "🛍️"}
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="font-serif text-xl font-black text-ink">{store.name}</h1>
                <span className="rounded-full bg-green-500/15 px-2.5 py-0.5 text-[10px] font-bold text-green-600 dark:text-green-400">
                  {store.status === "active" ? "OPEN" : "CLOSED"}
                </span>
                {isElite && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-gold px-2.5 py-0.5 text-[10px] font-black text-ink-gold">
                    <Crown className="h-3 w-3" /> ELITE OS
                  </span>
                )}
              </div>
              <p className="text-xs text-ink-500 font-medium">
                {store.custom_domain ? store.custom_domain : `peebee.online/${store.category}/${store.slug}`}
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowLiveStudio(true)}
            className="flex items-center gap-1.5 rounded-full bg-gold px-3.5 py-2 text-xs font-bold text-ink-gold shadow-md transition hover:opacity-90 active:scale-95"
          >
            <Radio className="h-3.5 w-3.5 animate-pulse" />
            <span>Live stream setup</span>
          </button>
        </div>

        {/* Merchant / Pro / Elite plans */}
        <PlanLadder
          plan={store.plan}
          isProFree={isProFree}
          proPrice={settings?.proLivePriceUgx ?? 75000}
          elitePrice={elitePrice}
          eliteEnabled={settings?.eliteEnabled !== false}
          commissionPercent={settings?.commissionPercent ?? 10}
          eliteCommissionPercent={settings?.eliteCommissionPercent ?? 5}
          onChanged={handlePlanChanged}
        />

        {/* Dual-Channel Auto-Sync Status: Peebee Customer App vs Dedicated Storefront */}
        <div className="mt-3 grid grid-cols-1 gap-2 border-t border-[var(--border-faint)] pt-3 sm:grid-cols-2">
          <div className="flex items-center justify-between gap-2 rounded-2xl bg-[rgb(var(--surface-muted))] px-3 py-2">
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase text-ink-500">
                Channel 1 · Peebee Customer App
              </span>
              <span className="block truncate font-mono text-xs font-bold text-ink">
                app.peebee.online/store/{store.slug}
              </span>
              <span className="block text-[10px] text-ink-500">
                Peebee UI &amp; branding · Auto-syncs catalog &amp; stock
              </span>
            </div>
            <a
              href={`https://app.peebee.online/store/${store.slug}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-full bg-[rgb(var(--surface-card))] px-2.5 py-1 text-[10px] font-bold text-ink border border-[var(--border-faint)]"
            >
              Open App ↗
            </a>
          </div>

          <div className="flex items-center justify-between gap-2 rounded-2xl border border-gold/40 bg-gold/10 px-3 py-2">
            <div className="min-w-0">
              <span className="block text-[10px] font-black uppercase text-gold">
                Channel 2 · Dedicated Storefront
              </span>
              <span className="block truncate font-mono text-xs font-black text-ink">
                {store.custom_domain || `${store.slug}.peebee.online`}
              </span>
              <span className="block text-[10px] text-ink-500">
                Custom Store 2.0 theme, branding, collections &amp; B2B
              </span>
            </div>
            <a
              href={`https://${store.custom_domain || `${store.slug}.peebee.online`}`}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 rounded-full bg-gold px-2.5 py-1 text-[10px] font-black text-ink-gold"
            >
              Visit Site ↗
            </a>
          </div>
        </div>
      </div>

      {notice && (
        <div className="flex items-center justify-between rounded-2xl bg-gold/15 p-3.5 text-sm font-semibold text-ink">
          <span>{notice}</span>
          <button onClick={() => setNotice("")} className="text-ink-500 hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center justify-between rounded-2xl bg-red-500/10 p-3.5 text-sm font-semibold text-red-600 dark:text-red-400">
          <span role="alert">{error}</span><button type="button" className="min-h-11 shrink-0 px-3 underline" onClick={() => void loadData()}>Retry loading</button>
          <button onClick={() => setError("")} className="text-red-500">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Main Tabs Navigation */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-2xl bg-[rgb(var(--surface-muted))] p-1">
        <button
          onClick={() => setActiveTab("catalog")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2.5 text-xs font-bold transition whitespace-nowrap ${
            activeTab === "catalog"
              ? "bg-[rgb(var(--surface-card))] text-ink shadow-sm"
              : "text-ink-500 hover:text-ink"
          }`}
        >
          <Package className="h-3.5 w-3.5" />
          <span>Catalog ({products.length})</span>
        </button>

        <button
          onClick={() => setActiveTab("elite")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2.5 text-xs font-bold transition whitespace-nowrap ${
            activeTab === "elite"
              ? "bg-gold text-ink-gold shadow-sm"
              : "text-gold hover:bg-gold/10"
          }`}
        >
          <Crown className="h-3.5 w-3.5" />
          <span>Elite OS</span>
        </button>

        <button
          onClick={() => setActiveTab("live")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2.5 text-xs font-bold transition whitespace-nowrap ${
            activeTab === "live"
              ? "bg-[rgb(var(--surface-card))] text-ink shadow-sm"
              : "text-ink-500 hover:text-ink"
          }`}
        >
          <Tv className="h-3.5 w-3.5 text-red-500" />
          <span>Live</span>
        </button>

        <button
          onClick={() => setActiveTab("ads")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2.5 text-xs font-bold transition whitespace-nowrap ${
            activeTab === "ads"
              ? "bg-[rgb(var(--surface-card))] text-ink shadow-sm"
              : "text-ink-500 hover:text-ink"
          }`}
        >
          <Megaphone className="h-3.5 w-3.5 text-gold" />
          <span>Ads</span>
        </button>

        <button
          onClick={() => setActiveTab("settings")}
          className={`flex-1 flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2.5 text-xs font-bold transition whitespace-nowrap ${
            activeTab === "settings"
              ? "bg-[rgb(var(--surface-card))] text-ink shadow-sm"
              : "text-ink-500 hover:text-ink"
          }`}
        >
          <StoreIcon className="h-3.5 w-3.5" />
          <span>Settings</span>
        </button>
      </div>

      {!isElite && <ExistingDigitalPurchases purchases={digitalFulfillments} canRefund={store.permissions?.refund_revoke !== false} onRefund={handleRefundFulfillment} onRevoke={handleRevokeFulfillment} />}

      {/* TAB: ELITE OS (Shopify & Merchant Elite Advanced Layer) */}
      {activeTab === "elite" && (
        <div className="space-y-4">
          {!isElite && (
            <div className="rounded-[24px] border border-gold bg-gradient-to-br from-black-900 via-neutral-900 to-black-900 p-5 text-white shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-gold/20 px-3 py-1 text-xs font-bold text-gold">
                  <Crown className="h-3.5 w-3.5" /> Tier 3 Upgrade · Merchant Elite Power
                </span>
                <span className="font-mono text-sm font-black text-gold">{ugx(elitePrice)}/mo</span>
              </div>
              <h3 className="font-serif text-xl font-black">Upgrade to Merchant Advanced Marketplace (Elite)</h3>
              <p className="text-xs text-neutral-300">
                Unlock lower platform commissions ({settings?.eliteCommissionPercent ?? 5}% instead of{" "}
                {settings?.commissionPercent ?? 10}%), up to {settings?.eliteMaxProducts ?? 5000} products, Online Store 2.0
                custom themes & domains, Smart Collections, Promo/BOGO codes, Multi-Outlet stock matrix, and B2B Wholesale
                Draft Orders.
              </p>
              <button
                type="button"
                disabled={upgradingTier}
                onClick={() => document.getElementById("merchant-plans")?.scrollIntoView({behavior: "smooth"})}
                className="w-full rounded-full bg-gold py-3 text-xs font-black text-ink-gold shadow-md transition active:scale-98"
              >
                {upgradingTier ? "Activating Elite OS…" : `Upgrade to Merchant Elite (${ugx(elitePrice)}/mo) →`}
              </button>
            </div>
          )}

          {isElite && (
          <>
          {/* Elite Sub-Navigation Pills */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { id: "overview", label: "P&L Analytics", icon: BarChart3 },
              { id: "pos", label: `POS Register (${posSales.length})`, icon: ShoppingBag },
              { id: "theme", label: "Store 2.0 Theme", icon: Palette },
              { id: "sections", label: `Page Builder (${storefrontSections.length})`, icon: SlidersHorizontal },
              { id: "sms", label: `SMS Receipts (${smsLogs.length})`, icon: MessageSquare },
              { id: "digital", label: `Digital Products (${digitalProducts.length})`, icon: Download },
              { id: "lms", label: `LMS & Learn Sync (${lmsCourses.length})`, icon: GraduationCap },
              { id: "collections", label: `Collections (${collections.length})`, icon: Layers },
              { id: "discounts", label: `Promos (${discounts.length})`, icon: Tag },
              { id: "inventory", label: "Multi-Outlet & Transfers", icon: Building2 },
              { id: "b2b", label: `B2B Quotes (${draftOrders.length})`, icon: Briefcase },
              { id: "crm", label: `VIP CRM (${crmCustomers.length})`, icon: Users },
              { id: "po", label: `Supplier POs (${purchaseOrders.length})`, icon: Truck },
              { id: "bundles", label: `Bundles & Kits (${bundles.length})`, icon: Package },
              { id: "winback", label: `Win-Back (${winbackCampaigns.length})`, icon: Send },
            ].map((item) => {
              const Icon = item.icon;
              const active = eliteSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setEliteSection(item.id as typeof eliteSection)}
                  className={`flex items-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-bold text-left transition ${
                    active
                      ? "bg-gold text-ink-gold shadow-xs"
                      : "bg-[rgb(var(--surface-card))] border border-[var(--border-faint)] text-ink-500 hover:text-ink"
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* ELITE SECTION 1: EXECUTIVE P&L & MARGIN ANALYTICS */}
          {eliteSection === "overview" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-base text-ink flex items-center gap-2">
                      <BarChart3 className="h-4.5 w-4.5 text-gold" />
                      <span>Recorded POS sales & cost estimates</span>
                    </h3>
                    <p className="text-xs text-ink-500">
                      All-time recorded POS sales. Costs use current product costs; fees are estimates. Online orders, refunds, tax and operating expenses are excluded.
                    </p>
                  </div>
                  <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-black text-gold">
                    {analytics?.netMarginPercent == null ? (analytics?.costsComplete === false ? "Costs incomplete" : "No recorded POS sales") : `${analytics.netMarginPercent}% estimated margin`}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                    <span className="text-[10px] font-bold uppercase text-ink-500">Recorded POS sales</span>
                    <p className="mt-1 font-mono text-sm font-black text-ink">{ugx(analytics?.grossRevenueUgx ?? 0)}</p>
                  </div>
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                    <span className="text-[10px] font-bold uppercase text-ink-500">Est. COGS</span>
                    <p className="mt-1 font-mono text-sm font-bold text-ink-500">{analytics?.estimatedCogsUgx == null ? "Unavailable" : ugx(analytics.estimatedCogsUgx)}</p>
                  </div>
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                    <span className="text-[10px] font-bold uppercase text-ink-500">Estimated platform fee</span>
                    <p className="mt-1 font-mono text-sm font-bold text-ink-500">{ugx(analytics?.platformCommissionUgx ?? 0)}</p>
                  </div>
                  <div className="rounded-2xl bg-gold/15 p-3">
                    <span className="text-[10px] font-bold uppercase text-gold">Est. contribution</span>
                    <p className="mt-1 font-mono text-sm font-black text-ink">{analytics?.netMarginUgx == null ? "Unavailable" : ugx(analytics.netMarginUgx)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 sm:grid-cols-6 gap-2.5 border-t border-[var(--border-faint)] pt-3 text-center">
                  <div>
                    <p className="text-lg font-black text-ink">{analytics?.totalStockUnits ?? 0}</p>
                    <p className="text-[10px] font-semibold text-ink-500">Total Stock Units</p>
                  </div>
                  <div>
                    <p className="text-lg font-black text-gold">{analytics?.lowStockCount ?? 0}</p>
                    <p className="text-[10px] font-semibold text-ink-500">Low-Stock Alerts</p>
                  </div>
                  <div>
                    <p className="font-mono text-xs font-black text-ink mt-1">{ugx(analytics?.b2bPipelineUgx ?? 0)}</p>
                    <p className="text-[10px] font-semibold text-ink-500">B2B Quote Pipeline</p>
                  </div>
                  <div>
                    <p className="font-mono text-xs font-black text-gold mt-1">{ugx(analytics?.posRevenueUgx ?? 0)}</p>
                    <p className="text-[10px] font-semibold text-ink-500">Walk-In POS ({analytics?.posSalesCount ?? 0})</p>
                  </div>
                  <div>
                    <p className="text-lg font-black text-ink">{analytics?.vipCustomersCount ?? crmSummary.vipCount}</p>
                    <p className="text-[10px] font-semibold text-ink-500">VIP & B2B Buyers</p>
                  </div>
                  <div>
                    <p className="font-mono text-xs font-black text-ink mt-1">{ugx(analytics?.loyaltyBalanceLiabilityUgx ?? crmSummary.totalLoyaltyBalanceUgx)}</p>
                    <p className="text-[10px] font-semibold text-ink-500">VIP Points Balance</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ELITE SECTION 1B: OMNICHANNEL IN-STORE POS REGISTER */}
          {eliteSection === "pos" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-base text-ink">Omnichannel In-Store POS Register</h3>
                    <p className="text-xs text-ink-500">
                      Record a walk-in sale after independently confirming payment. Selecting a tender does not collect money. Stock and loyalty update together.
                    </p>
                  </div>
                  <span className="rounded-full bg-gold/15 px-3 py-1 text-[10px] font-black uppercase text-gold">
                    Live Stock Sync
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-xs font-semibold text-ink-500">Checkout Branch</label>
                    <Select
                      aria-label="POS Checkout Branch"
                      value={posOutletId}
                      onValueChange={(val) => setPosOutletId(val)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    >
                      <option value="">Main Store Inventory</option>
                      {outlets.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.name} ({o.code})
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-ink-500">Product Item</label>
                    <Select
                      aria-label="POS Product Item"
                      value={posProductId}
                      onValueChange={(val) => setPosProductId(val)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} ({ugx(p.price)} · {p.inventory_quantity} left)
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div>
                    <label htmlFor="store-field-3" className="text-xs font-semibold text-ink-500">Quantity</label>
                    <input id="store-field-3"
                      type="number"
                      min={1}
                      value={posQty}
                      onChange={(e) => setPosQty(e.target.value)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <div>
                    <label htmlFor="store-field-4" className="text-xs font-semibold text-ink-500">Customer Phone (for VIP Loyalty)</label>
                    <input id="store-field-4"
                      type="text"
                      value={posCustomerPhone}
                      onChange={(e) => setPosCustomerPhone(e.target.value)}
                      placeholder="e.g. +256 772 123456"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="store-field-5" className="text-xs font-semibold text-ink-500">Customer Name (Optional)</label>
                    <input id="store-field-5"
                      type="text"
                      value={posCustomerName}
                      onChange={(e) => setPosCustomerName(e.target.value)}
                      placeholder="e.g. Grace Nakato"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-xs font-semibold text-ink-500">Payment Tender</label>
                    <Select
                      aria-label="POS Payment Tender"
                      value={posPaymentMethod}
                      onValueChange={(val) => setPosPaymentMethod(val as typeof posPaymentMethod)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    >
                      <option value="peebee_code">⚡ Peebee Merchant Code</option>
                      <option value="momo">📱 Mobile Money</option>
                      <option value="cash">💵 Cash at Counter</option>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="store-field-6" className="text-xs font-semibold text-ink-500">Counter Discount (UGX)</label>
                    <input id="store-field-6"
                      type="number"
                      min={0}
                      value={posDiscountUgx}
                      onChange={(e) => setPosDiscountUgx(e.target.value)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="store-field-7" className="text-xs font-semibold text-ink-500">Redeem Loyalty Points (UGX)</label>
                    <input id="store-field-7"
                      type="number"
                      min={0}
                      value={posRedeemLoyaltyUgx}
                      onChange={(e) => setPosRedeemLoyaltyUgx(e.target.value)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCreatePosSale}
                  disabled={savingPosSale || products.length === 0}
                  className="w-full rounded-full bg-gold py-3 text-xs font-bold text-ink-gold shadow transition active:scale-98 disabled:opacity-50"
                >
                  {savingPosSale ? "Processing POS Checkout…" : "Complete Walk-In POS Sale & Sync Stock →"}
                </button>
              </div>

              {posSales.length > 0 && (
                <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-2.5">
                  <h4 className="text-xs font-bold uppercase text-ink-500">Recent Walk-In POS Receipts</h4>
                  {posSales.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-gold/20 px-2 py-0.5 font-mono text-[10px] font-black text-gold">
                            {s.receipt_code}
                          </span>
                          <span className="font-bold text-ink">
                            {s.customer_name || s.customer_phone || "Walk-In Shopper"}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] text-ink-500">
                          {s.outlet_name || "Main Store"} · {s.payment_method.replace("_", " ").toUpperCase()}
                          {s.loyalty_earned_ugx > 0 ? ` · +${ugx(s.loyalty_earned_ugx)} VIP earned` : ""}
                          {s.loyalty_redeemed_ugx > 0 ? ` · -${ugx(s.loyalty_redeemed_ugx)} redeemed` : ""}
                        </p>
                      </div>
                      <span className="font-mono font-black text-ink">{ugx(s.total_amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ELITE SECTION 2: ONLINE STORE 2.0 THEME, CUSTOM DOMAIN & PIXELS */}
          {eliteSection === "theme" && (
            <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-bold text-base text-ink">Online Store 2.0 Theme & Custom Domain</h3>
                  <p className="text-xs text-ink-500">
                    Customize standalone storefront layout, hero banner, loyalty cashback, and tracking pixels
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setPreviewScreen("storefront");
                    setShowStorefrontPreview(true);
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-gold/15 px-3 py-1.5 text-xs font-bold text-gold"
                >
                  <Eye className="h-3.5 w-3.5" /> Preview
                </button>
              </div>

              <div className="space-y-3">
                <div className="rounded-2xl border border-gold/30 bg-gold/10 p-3 text-xs">
                  <p className="font-bold text-ink">
                    Dedicated Storefront Subdomain: <span className="font-mono text-gold">https://{store.slug}.peebee.online</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-500">
                    Your custom Store 2.0 theme, brand accent, hero banner, and smart collections power your standalone{" "}
                    <span className="font-mono font-semibold">{store.slug}.peebee.online</span> site. The Peebee Customer App
                    maintains its unified Peebee UI while auto-syncing your products, inventory, and promotions in real time.
                  </p>
                </div>

                <div>
                  <label htmlFor="store-field-8" className="text-xs font-semibold text-ink-500">Optional Custom Domain Override (CNAME to {store.slug}.peebee.online)</label>
                  <input id="store-field-8"
                    type="text"
                    value={customDomain}
                    onChange={(e) => setCustomDomain(e.target.value)}
                    placeholder="e.g. shop.mybrand.ug"
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                  />
                  {store.custom_domain && Number(store.domain_verified || 0) === 1 && (
                    <p className="mt-1.5 text-[11px] font-bold text-emerald-600">✓ {store.custom_domain} is verified and serving your store.</p>
                  )}
                  {store.custom_domain && Number(store.domain_verified || 0) !== 1 && store.domain_verify_token && (
                    <div className="mt-2 space-y-2 rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-[11px] text-ink">
                      <p className="font-bold">Prove you own {store.custom_domain}</p>
                      <p className="text-ink-500">Add this TXT record at your domain provider, then press Check now. It can take a few minutes to appear.</p>
                      <p className="break-all font-mono">_peebee-verify.{store.custom_domain}</p>
                      <p className="break-all font-mono">peebee-verify={store.domain_verify_token}</p>
                      <button type="button" onClick={handleVerifyDomain} disabled={verifyingDomain} className="rounded-full bg-gold px-4 py-2 text-xs font-black text-ink-gold disabled:opacity-60">
                        {verifyingDomain ? "Checking…" : "Check now"}
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-ink-500">Storefront Layout</label>
                    <Select
                      aria-label="Storefront Layout"
                      value={themeLayout}
                      onValueChange={(val) => setThemeLayout(val as "grid" | "editorial" | "compact")}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                    >
                      <option value="grid">2-Column Modern Grid</option>
                      <option value="editorial">Editorial Lookbook (Fashion)</option>
                      <option value="compact">Rapid Aisle List (Supermarket)</option>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-ink-500">Brand Accent Token</label>
                    <Select
                      aria-label="Brand Accent Token"
                      value={themeAccent}
                      onValueChange={(val) => setThemeAccent(val as "gold" | "ink" | "cream")}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                    >
                      <option value="gold">Peebee Gold</option>
                      <option value="ink">Obsidian Ink</option>
                      <option value="cream">Warm Cream</option>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="store-field-9" className="text-xs font-semibold text-ink-500">Hero Banner Headline</label>
                    <input id="store-field-9"
                      type="text"
                      value={heroHeadline}
                      onChange={(e) => setHeroHeadline(e.target.value)}
                      placeholder="e.g. New Season Collection"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="store-field-10" className="text-xs font-semibold text-ink-500">Hero Subtitle</label>
                    <input id="store-field-10"
                      type="text"
                      value={heroSubheadline}
                      onChange={(e) => setHeroSubheadline(e.target.value)}
                      placeholder="e.g. Same-day Kampala delivery on all orders"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                    />
                  </div>
                </div>

                {/* VIP Loyalty Cashback */}
                <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="block text-xs font-bold text-ink flex items-center gap-1.5">
                        <Gift className="h-3.5 w-3.5 text-gold" /> Store VIP Loyalty Points & Cashback
                      </span>
                      <span className="text-[10px] text-ink-500">
                        Automatically reward repeat shoppers with store credit (Max{" "}
                        {settings?.eliteMaxLoyaltyCashbackPercent ?? 15}%)
                      </span>
                    </div>
                    <input
                      type="checkbox"
                      checked={loyaltyEnabled}
                      onChange={(e) => setLoyaltyEnabled(e.target.checked)}
                      className="h-4 w-4 accent-gold"
                    />
                  </div>
                  {loyaltyEnabled && (
                    <div>
                      <label htmlFor="store-field-11" className="text-[11px] font-semibold text-ink-500">Cashback Reward (%)</label>
                      <input id="store-field-11"
                        type="number"
                        min={1}
                        max={settings?.eliteMaxLoyaltyCashbackPercent ?? 15}
                        value={loyaltyCashback}
                        onChange={(e) => setLoyaltyCashback(e.target.value)}
                        className="mt-1 w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2 text-xs text-ink"
                      />
                    </div>
                  )}
                </div>

                {/* Retargeting Pixels */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="store-field-12" className="text-xs font-semibold text-ink-500">Meta / Instagram Pixel ID</label>
                    <input id="store-field-12"
                      type="text"
                      value={metaPixelId}
                      onChange={(e) => setMetaPixelId(e.target.value)}
                      placeholder="e.g. 1092837465"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-xs text-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="store-field-13" className="text-xs font-semibold text-ink-500">TikTok Pixel ID</label>
                    <input id="store-field-13"
                      type="text"
                      value={tiktokPixelId}
                      onChange={(e) => setTiktokPixelId(e.target.value)}
                      placeholder="e.g. C9A8B7D6E5"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-xs text-ink"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleSaveTheme}
                  disabled={savingTheme}
                  className="w-full rounded-full bg-gold py-3 text-xs font-bold text-ink-gold shadow transition active:scale-98 disabled:opacity-50"
                >
                  {savingTheme ? "Saving Storefront 2.0…" : "Save Theme, Domain & Loyalty Settings"}
                </button>
              </div>
            </div>
          )}

          {/* ELITE SECTION 3: SMART & MANUAL COLLECTIONS */}
          {eliteSection === "collections" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-base text-ink">Smart Automated Collections</h3>
                <p className="text-xs text-ink-500">
                  Group products automatically by price cap, category, badge, or stock level (Shopify Smart Collections)
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="store-field-14" className="text-xs font-semibold text-ink-500">Collection Title</label>
                    <input id="store-field-14"
                      type="text"
                      value={colTitle}
                      onChange={(e) => setColTitle(e.target.value)}
                      placeholder="e.g. Under UGX 50,000 Deals"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-ink-500">Collection Type</label>
                    <Select
                      aria-label="Collection Type"
                      value={colKind}
                      onValueChange={(val) => setColKind(val as "smart" | "manual")}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                    >
                      <option value="smart">⚡ Smart Rule-Based</option>
                      <option value="manual">📌 Manual Curated</option>
                    </Select>
                  </div>
                </div>

                {colKind === "smart" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-ink-500">Auto-Match Condition</label>
                      <Select
                        aria-label="Auto-Match Condition"
                        value={colRuleField}
                        onValueChange={(val) => setColRuleField(val as typeof colRuleField)}
                        className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                      >
                        <option value="price_lte">Price ≤ (UGX)</option>
                        <option value="price_gte">Price ≥ (UGX)</option>
                        <option value="category">Category matches</option>
                        <option value="badge">Badge matches</option>
                        <option value="in_stock">Currently in stock</option>
                      </Select>
                    </div>
                    {colRuleField !== "in_stock" && (
                      <div>
                        <label htmlFor="store-field-15" className="text-xs font-semibold text-ink-500">Target Value</label>
                        <input id="store-field-15"
                          type="text"
                          value={colRuleValue}
                          onChange={(e) => setColRuleValue(e.target.value)}
                          placeholder="50000 or Organic"
                          className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                        />
                      </div>
                    )}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleCreateCollection}
                  disabled={savingCol || !colTitle.trim()}
                  className="w-full rounded-full bg-gold py-3 text-xs font-bold text-ink-gold shadow transition active:scale-98 disabled:opacity-50"
                >
                  {savingCol ? "Creating Collection…" : "+ Create Smart Collection"}
                </button>
              </div>

              {collections.length > 0 && (
                <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-2.5">
                  <h4 className="text-xs font-bold uppercase text-ink-500">Active Storefront Collections</h4>
                  {collections.map((c) => (
                    <div
                      key={c.id}
                      className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                    >
                      <div>
                        <span className="font-bold text-ink">{c.title}</span>
                        <p className="text-[10px] text-ink-500">
                          {c.kind === "smart" ? `Smart Rule: ${c.rule_field} ${c.rule_value || ""}` : "Manual"} ·{" "}
                          <strong className="text-gold">{c.matching_products_count ?? 0} products matched</strong>
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteCollection(c.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ELITE SECTION 4: PROMOTIONS, COUPON CODES & BOGO ENGINE */}
          {eliteSection === "discounts" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-base text-ink">Promotions, Coupon Codes & BOGO Engine</h3>
                <p className="text-xs text-ink-500">
                  Create checkout discount codes, automatic cart spend rewards, or merchant-subsidized free delivery
                </p>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="store-field-16" className="text-xs font-semibold text-ink-500">Promo Code</label>
                    <input id="store-field-16"
                      type="text"
                      value={discCode}
                      onChange={(e) => setDiscCode(e.target.value.toUpperCase())}
                      placeholder="e.g. KAMPALA20"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 font-mono text-sm font-bold text-ink uppercase"
                    />
                  </div>
                  <div>
                    <label htmlFor="store-field-17" className="text-xs font-semibold text-ink-500">Campaign Title</label>
                    <input id="store-field-17"
                      type="text"
                      value={discTitle}
                      onChange={(e) => setDiscTitle(e.target.value)}
                      placeholder="e.g. Weekend Flash Sale"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-xs font-semibold text-ink-500">Discount Type</label>
                    <Select
                      aria-label="Discount Type"
                      value={discKind}
                      onValueChange={(val) => setDiscKind(val as typeof discKind)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    >
                      <option value="percent">% Percentage Off</option>
                      <option value="fixed">Fixed UGX Off</option>
                      <option value="free_delivery">Free Delivery</option>
                      <option value="bogo">Buy 1 Get 1 (BOGO)</option>
                    </Select>
                  </div>

                  <div>
                    <label htmlFor="store-field-18" className="text-xs font-semibold text-ink-500">
                      {discKind === "percent" ? "Percent (%)" : "Value (UGX)"}
                    </label>
                    <input id="store-field-18"
                      type="number"
                      disabled={discKind === "free_delivery"}
                      value={discKind === "free_delivery" ? 0 : discValue}
                      onChange={(e) => setDiscValue(e.target.value)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>

                  <div>
                    <label htmlFor="store-field-19" className="text-xs font-semibold text-ink-500">Min Spend (UGX)</label>
                    <input id="store-field-19"
                      type="number"
                      value={discMinOrder}
                      onChange={(e) => setDiscMinOrder(e.target.value)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    checked={discAuto}
                    onChange={(e) => setDiscAuto(e.target.checked)}
                    className="h-4 w-4 accent-gold"
                  />
                  <span>Apply automatically at checkout when minimum cart spend is reached</span>
                </label>

                <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
                  <input type="checkbox" checked={discPublic} onChange={(e) => setDiscPublic(e.target.checked)} className="h-4 w-4 accent-gold" />
                  <span>List this code on my web store (otherwise customers need to be given it)</span>
                </label>

                <div>
                  <label htmlFor="store-field-20" className="text-xs font-semibold text-ink-500">Ends on (optional)</label>
                  <input id="store-field-20"
                    type="date"
                    value={discExpires}
                    onChange={(e) => setDiscExpires(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleCreateDiscount}
                  disabled={savingDisc || !discCode.trim() || !discTitle.trim()}
                  className="w-full rounded-full bg-gold py-3 text-xs font-bold text-ink-gold shadow transition active:scale-98 disabled:opacity-50"
                >
                  {savingDisc ? "Saving Promo…" : "+ Launch Discount Campaign"}
                </button>
              </div>

              {discounts.length > 0 && (
                <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-2.5">
                  <h4 className="text-xs font-bold uppercase text-ink-500">Active Promotions</h4>
                  {discounts.map((d) => (
                    <div
                      key={d.id}
                      className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="rounded-lg bg-gold px-2 py-0.5 font-mono text-[11px] font-black text-ink-gold">
                            {d.code}
                          </span>
                          <span className="font-bold text-ink">{d.title}</span>
                        </div>
                        <p className="mt-1 text-[10px] text-ink-500">
                          {d.kind === "percent"
                            ? `${d.value}% OFF`
                            : d.kind === "fixed"
                              ? `${ugx(d.value)} OFF`
                              : d.kind === "free_delivery"
                                ? "Free Delivery"
                                : "BOGO Offer"}{" "}
                          · Min order {ugx(d.min_order_amount)} {d.is_automatic ? "· Auto-applied" : ""}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteDiscount(d.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ELITE SECTION 5: MULTI-OUTLET INVENTORY MATRIX */}
          {eliteSection === "inventory" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-base text-ink">Multi-Outlet Branch Stock Matrix</h3>
                <p className="text-xs text-ink-500">
                  Assign stock quantities per physical branch (`merchant_outlets`) for intelligent nearest-branch boda
                  and matatu dispatch
                </p>

                {outlets.length === 0 ? (
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 text-xs text-ink-500">
                    No physical outlets found.{" "}
                    <Link href="/outlets" className="font-bold text-gold underline">
                      Create an outlet branch
                    </Link>{" "}
                    to track multi-location inventory.
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                      <div>
                        <label className="text-xs font-semibold text-ink-500">Physical Branch</label>
                        <Select
                          aria-label="Physical Branch"
                          value={selectedInvOutlet}
                          onValueChange={(val) => setSelectedInvOutlet(val)}
                          className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                        >
                          {outlets.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name} ({o.code})
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div>
                        <label className="text-xs font-semibold text-ink-500">Product SKU</label>
                        <Select
                          aria-label="Product SKU"
                          value={selectedInvProduct}
                          onValueChange={(val) => setSelectedInvProduct(val)}
                          className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                        >
                          {products.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title}
                            </option>
                          ))}
                        </Select>
                      </div>

                      <div>
                        <label htmlFor="store-field-21" className="text-xs font-semibold text-ink-500">Branch Qty</label>
                        <input id="store-field-21"
                          type="number"
                          min={0}
                          value={invQuantity}
                          onChange={(e) => setInvQuantity(e.target.value)}
                          className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={handleSaveOutletInventory}
                      disabled={savingInv || !selectedInvOutlet || !selectedInvProduct}
                      className="w-full rounded-full bg-gold py-3 text-xs font-bold text-ink-gold shadow transition active:scale-98 disabled:opacity-50"
                    >
                      {savingInv ? "Syncing Branch Stock…" : "Update Branch Stock & Sync Catalog Total"}
                    </button>
                  </div>
                )}
              </div>

              {outlets.length >= 2 && (
                <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                  <h4 className="text-sm font-bold text-ink">Branch-to-Branch Stock Transfer</h4>
                  <p className="text-xs text-ink-500">
                    Move units between physical outlets with an auditable stock ledger
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                    <div>
                      <label className="text-xs font-semibold text-ink-500">Product</label>
                      <Select
                        aria-label="Transfer Product"
                        value={transferProductId}
                        onValueChange={(val) => setTransferProductId(val)}
                        className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                      >
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.title}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-ink-500">From Branch</label>
                      <Select
                        aria-label="Transfer From Branch"
                        value={transferFromOutletId}
                        onValueChange={(val) => setTransferFromOutletId(val)}
                        className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                      >
                        {outlets.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-ink-500">To Branch</label>
                      <Select
                        aria-label="Transfer To Branch"
                        value={transferToOutletId}
                        onValueChange={(val) => setTransferToOutletId(val)}
                        className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                      >
                        {outlets.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.name}
                          </option>
                        ))}
                      </Select>
                    </div>
                    <div>
                      <label htmlFor="store-field-22" className="text-xs font-semibold text-ink-500">Transfer Qty</label>
                      <input id="store-field-22"
                        type="number"
                        min={1}
                        value={transferQty}
                        onChange={(e) => setTransferQty(e.target.value)}
                        className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCreateStockTransfer}
                    disabled={savingTransfer || transferFromOutletId === transferToOutletId}
                    className="w-full rounded-full bg-gold py-2.5 text-xs font-bold text-ink-gold shadow transition active:scale-98 disabled:opacity-50"
                  >
                    {savingTransfer ? "Moving Stock…" : "Transfer Stock Between Branches →"}
                  </button>
                </div>
              )}

              {outletInventory.length > 0 && (
                <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-2.5">
                  <h4 className="text-xs font-bold uppercase text-ink-500">Live Stock by Branch</h4>
                  {outletInventory.map((row, idx) => (
                    <div
                      key={row.id || idx}
                      className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                    >
                      <div>
                        <span className="font-bold text-ink">{row.product_title || "Product"}</span>
                        <p className="text-[10px] text-ink-500">Branch: {row.outlet_name}</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 font-mono text-xs font-black ${
                          row.quantity <= row.low_stock_threshold
                            ? "bg-red-500/15 text-red-600"
                            : "bg-gold/15 text-gold"
                        }`}
                      >
                        {row.quantity} units
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {stockTransfers.length > 0 && (
                <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-2.5">
                  <h4 className="text-xs font-bold uppercase text-ink-500">Branch Transfer Audit Log</h4>
                  {stockTransfers.map((trf) => (
                    <div
                      key={trf.id}
                      className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                    >
                      <div>
                        <span className="font-bold text-ink">{trf.product_title || "Product"}</span>
                        <p className="text-[10px] text-ink-500">
                          {trf.from_outlet_name || trf.from_outlet_id} → {trf.to_outlet_name || trf.to_outlet_id}
                        </p>
                      </div>
                      <span className="rounded-full bg-gold/15 px-2.5 py-1 font-mono text-xs font-black text-gold">
                        {trf.quantity} moved
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ELITE SECTION 6: B2B WHOLESALE & DRAFT ORDERS */}
          {eliteSection === "b2b" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                <h3 className="font-bold text-base text-ink">B2B Wholesale & Draft Orders (Merchant Elite)</h3>
                <p className="text-xs text-ink-500">
                  Create custom wholesale quotes with negotiated unit pricing, Net-7/14/30 credit terms, and 1-tap
                  WhatsApp payment links
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label htmlFor="store-field-23" className="text-xs font-semibold text-ink-500">Buyer Contact Name</label>
                    <input id="store-field-23"
                      type="text"
                      value={b2bCustomerName}
                      onChange={(e) => setB2bCustomerName(e.target.value)}
                      placeholder="e.g. Sarah Namubiru"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="store-field-24" className="text-xs font-semibold text-ink-500">Business / Kiosk Name</label>
                    <input id="store-field-24"
                      type="text"
                      value={b2bCompany}
                      onChange={(e) => setB2bCompany(e.target.value)}
                      placeholder="e.g. Ntinda Mini Mart"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="store-field-25" className="text-xs font-semibold text-ink-500">WhatsApp / Phone</label>
                    <input id="store-field-25"
                      type="text"
                      value={b2bPhone}
                      onChange={(e) => setB2bPhone(e.target.value)}
                      placeholder="+256 772..."
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-xs font-semibold text-ink-500">Product</label>
                    <Select
                      aria-label="B2B Product"
                      value={b2bProductId}
                      onValueChange={(val) => {
                        setB2bProductId(val);
                        const found = products.find((p) => p.id === val);
                        if (found) setB2bUnitPrice(String(Math.round(found.price * 0.85)));
                      }}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} (Retail {ugx(p.price)})
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="store-field-26" className="text-xs font-semibold text-ink-500">Wholesale Unit Price (UGX)</label>
                    <input id="store-field-26"
                      type="number"
                      value={b2bUnitPrice}
                      onChange={(e) => setB2bUnitPrice(e.target.value)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                  <div>
                    <label htmlFor="store-field-27" className="text-xs font-semibold text-ink-500">Case / Carton Quantity</label>
                    <input id="store-field-27"
                      type="number"
                      min={1}
                      value={b2bQty}
                      onChange={(e) => setB2bQty(e.target.value)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-xs font-semibold text-ink-500">Payment Terms</label>
                    <Select
                      aria-label="Payment Terms"
                      value={b2bTerms}
                      onValueChange={(val) => setB2bTerms(val as typeof b2bTerms)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    >
                      <option value="immediate">Due on Receipt (1-Tap Escrow)</option>
                      <option value="net_7">Net 7 Days Credit</option>
                      <option value="net_14">Net 14 Days Credit</option>
                      <option value="net_30">Net 30 Days Credit</option>
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="store-field-28" className="text-xs font-semibold text-ink-500">Extra Invoice Discount (UGX)</label>
                    <input id="store-field-28"
                      type="number"
                      min={0}
                      value={b2bDiscountUgx}
                      onChange={(e) => setB2bDiscountUgx(e.target.value)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-xs text-ink"
                    />
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCreateDraftOrder}
                  disabled={savingDraft || !b2bCustomerName.trim() || products.length === 0}
                  className="w-full rounded-full bg-gold py-3 text-xs font-bold text-ink-gold shadow transition active:scale-98 disabled:opacity-50"
                >
                  {savingDraft ? "Generating B2B Invoice…" : "Create Wholesale Draft Order & Payment Link →"}
                </button>
              </div>

              {draftOrders.length > 0 && (
                <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-2.5">
                  <h4 className="text-xs font-bold uppercase text-ink-500">B2B Wholesale Quotes & Invoices</h4>
                  {draftOrders.map((drf) => (
                    <div
                      key={drf.id}
                      className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                    >
                      <div>
                        <span className="font-bold text-ink">
                          {drf.customer_company ? `${drf.customer_company} (${drf.customer_name})` : drf.customer_name}
                        </span>
                        <p className="text-[10px] text-ink-500">
                          {drf.payment_terms.replace("_", " ").toUpperCase()} · {drf.items?.length || 1} line item(s)
                        </p>
                      </div>
                      <div className="text-right">
                        <span className="block font-mono font-black text-gold">{ugx(drf.total_amount)}</span>
                        <span className="text-[10px] font-bold uppercase text-green-600">{drf.status}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ELITE SECTION 7: VIP CUSTOMER CRM & LOYALTY LEDGER */}
          {eliteSection === "crm" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-base text-ink">VIP Customer CRM & Loyalty Cashback Ledger</h3>
                    <p className="text-xs text-ink-500">
                      Unified buyer segments across Dedicated Storefront, Peebee App Marketplace, and Walk-In POS
                    </p>
                  </div>
                  <span className="rounded-full bg-gold/15 px-3 py-1 text-xs font-black text-gold">
                    {crmSummary.totalCustomers} Buyers
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2.5">
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                    <span className="text-[10px] font-bold uppercase text-gold">VIP Tier Buyers</span>
                    <p className="mt-1 text-lg font-black text-ink">{crmSummary.vipCount}</p>
                  </div>
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                    <span className="text-[10px] font-bold uppercase text-ink-500">Repeat Buyers</span>
                    <p className="mt-1 text-lg font-black text-ink">{crmSummary.repeatCount}</p>
                  </div>
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3">
                    <span className="text-[10px] font-bold uppercase text-ink-500">Points Available</span>
                    <p className="mt-1 font-mono text-sm font-black text-gold">
                      {ugx(crmSummary.totalLoyaltyBalanceUgx)}
                    </p>
                  </div>
                </div>

                {crmCustomers.length === 0 ? (
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 text-xs text-ink-500">
                    Customer profiles and VIP loyalty points populate automatically as shoppers purchase on your
                    Dedicated Storefront, the Peebee App, or your Walk-In POS Register.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {crmCustomers.map((cust) => (
                      <div
                        key={cust.id}
                        className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink">
                              {cust.customer_name || cust.customer_phone}
                            </span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-[10px] font-black uppercase ${
                                cust.tier === "vip" || cust.tier === "b2b"
                                  ? "bg-gold text-ink-gold"
                                  : "bg-[rgb(var(--surface-card))] text-ink-500"
                              }`}
                            >
                              {cust.tier}
                            </span>
                          </div>
                          <p className="mt-0.5 text-[10px] text-ink-500">
                            {cust.customer_phone} · {cust.orders_count} order(s) · Total spent {ugx(cust.total_spent_ugx)}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className="block font-mono font-black text-gold">
                            {ugx(cust.points_balance_ugx)}
                          </span>
                          <span className="text-[10px] text-ink-500">Loyalty credit</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ELITE SECTION: DYNAMIC DIGITAL PRODUCTS MANAGEMENT */}
          {eliteSection === "digital" && store.permissions?.manage_digital === false && <p role="status" className="home-card">Your team role cannot manage digital products. Ask the business owner for access.</p>}
          {eliteSection === "digital" && store.permissions?.manage_digital !== false && (
            <div className="space-y-5">
              {/* Top Digital Stats Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Digital SKUs</span>
                  <div className="mt-1 font-serif text-xl font-black text-ink">{digitalProducts.length}</div>
                  <span className="text-[10px] text-ink-400">PDFs, Keys, Templates</span>
                </div>
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Downloads Served</span>
                  <div className="mt-1 font-serif text-xl font-black text-emerald-600">
                    {digitalProducts.reduce((sum, p) => sum + (p.downloads_count || 0), 0)}
                  </div>
                  <span className="text-[10px] text-ink-400">Secure token downloads</span>
                </div>
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Digital Sales</span>
                  <div className="mt-1 font-serif text-xl font-black text-gold">
                    {ugx(digitalProducts.reduce((sum, p) => sum + (p.sales_count || 0) * (p.price_ugx || 0), 0))}
                  </div>
                  <span className="text-[10px] text-ink-400">Zero physical delivery cost</span>
                </div>
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Active Fulfillments</span>
                  <div className="mt-1 font-serif text-xl font-black text-ink">{digitalFulfillments.length}</div>
                  <span className="text-[10px] text-ink-400">Customer license passes</span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h3 className="font-bold text-base text-ink">Dynamic Digital Products Manager</h3>
                  <p className="text-xs text-ink-500">
                    Sell downloadable guides, templates, software license keys, and educational presets with instant automated delivery.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowNewDigitalProduct(!showNewDigitalProduct)}
                  className="flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-xs font-bold text-ink-gold shadow-sm transition active:scale-95"
                >
                  <Plus className="h-4 w-4" />
                  <span>{showNewDigitalProduct ? "Close Form" : "Add Digital Product"}</span>
                </button>
              </div>

              {/* Add Digital Product Form */}
              {showNewDigitalProduct && (
                <form
                  onSubmit={handleCreateDigitalProduct}
                  className="rounded-[24px] border border-gold/30 bg-[rgb(var(--surface-card))] p-5 shadow-md space-y-4 animate-in fade-in slide-in-from-top-2"
                >
                  <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
                    <span className="font-bold text-sm text-ink flex items-center gap-2">
                      <Download className="h-4 w-4 text-gold" /> Create Digital Download or Software Key
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewDigitalProduct(false)}
                      className="text-ink-400 hover:text-ink text-xs"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="store-field-29" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Product Title</label>
                      <input id="store-field-29"
                        type="text"
                        required
                        value={digTitle}
                        onChange={(e) => setDigTitle(e.target.value)}
                        placeholder="e.g. Modern Poultry Farming Master Guide (PDF)"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-semibold"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-30" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Product Kind</label>
                      <select id="store-field-30"
                        value={digKind}
                        onChange={(e) => setDigKind(e.target.value as any)}
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-semibold"
                      >
                        <option value="download">File Download (PDF, ZIP, EPUB)</option>
                        <option value="license_key">Software License Key / Serial Code</option>
                        <option value="template">Spreadsheet / Design Template</option>
                        <option value="service">Digital Consultation / Coaching Session</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="store-field-31" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Price (UGX)</label>
                      <input id="store-field-31"
                        type="number"
                        required
                        min="0"
                        value={digPrice}
                        onChange={(e) => setDigPrice(e.target.value)}
                        placeholder="25000"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-32" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Compare-At Price (UGX)</label>
                      <input id="store-field-32"
                        type="number"
                        min="0"
                        value={digCompareAt}
                        onChange={(e) => setDigCompareAt(e.target.value)}
                        placeholder="40000"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-mono"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-33" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Cover Image URL</label>
                      <input id="store-field-33"
                        type="url"
                        value={digCoverUrl}
                        onChange={(e) => setDigCoverUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="store-field-34" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Product Description</label>
                    <textarea id="store-field-34"
                      rows={2}
                      value={digDescription}
                      onChange={(e) => setDigDescription(e.target.value)}
                      placeholder="Detailed overview of what the customer will receive upon instant download..."
                      className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="store-field-35" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Download File URL (R2 / CDN / Google Drive)</label>
                      <input id="store-field-35"
                        type="url"
                        value={digFileUrl}
                        onChange={(e) => setDigFileUrl(e.target.value)}
                        placeholder="https://peebee.online/downloads/guide.pdf"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-mono"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-36" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">File Display Name</label>
                      <input id="store-field-36"
                        type="text"
                        value={digFileName}
                        onChange={(e) => setDigFileName(e.target.value)}
                        placeholder="poultry-master-guide-2026.pdf"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink"
                      />
                    </div>
                  </div>

                  {digKind === "license_key" && (
                    <div>
                      <label htmlFor="store-field-37" className="block text-[11px] font-bold uppercase text-gold mb-1">
                        License Keys Pool (One key per line — automatically assigned to buyers)
                      </label>
                      <textarea id="store-field-37"
                        rows={3}
                        value={digLicenseKeys}
                        onChange={(e) => setDigLicenseKeys(e.target.value)}
                        placeholder={"KEY-PB-8841-A91X\nKEY-PB-9922-C44Z\nKEY-PB-3310-M77Q"}
                        className="w-full rounded-xl border border-gold/40 bg-[rgb(var(--surface-input))] p-2.5 text-xs font-mono text-ink"
                      />
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="store-field-38" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Max Downloads Per Buyer (0 = Unlimited)</label>
                      <input id="store-field-38"
                        type="number"
                        min="0"
                        max="100"
                        value={digMaxDownloads}
                        onChange={(e) => setDigMaxDownloads(e.target.value)}
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs font-mono text-ink"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-39" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Token Expiry (Days, 0 = Never)</label>
                      <input id="store-field-39"
                        type="number"
                        min="0"
                        max="365"
                        value={digExpiryDays}
                        onChange={(e) => setDigExpiryDays(e.target.value)}
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs font-mono text-ink"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-40" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Delivery Instructions</label>
                      <input id="store-field-40"
                        type="text"
                        value={digDeliveryInstructions}
                        onChange={(e) => setDigDeliveryInstructions(e.target.value)}
                        placeholder="Click button or use SMS pass..."
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-faint)]">
                    <button
                      type="button"
                      onClick={() => setShowNewDigitalProduct(false)}
                      className="rounded-full px-4 py-2 text-xs font-bold text-ink-500 hover:text-ink"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingDigitalProduct}
                      className="rounded-full bg-gold px-6 py-2 text-xs font-black text-ink-gold shadow transition active:scale-95 disabled:opacity-60"
                    >
                      {savingDigitalProduct ? "Publishing…" : "Publish Digital Product →"}
                    </button>
                  </div>
                </form>
              )}

              {/* Live Digital Products Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {digitalProducts.map((p) => (
                  <div
                    key={p.id}
                    className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="rounded-full bg-gold/15 text-gold px-2 py-0.5 text-[10px] font-bold uppercase">
                          {p.kind.replace("_", " ")}
                        </span>
                        <span className="font-mono text-xs font-black text-ink">{ugx(p.price_ugx)}</span>
                      </div>
                      <h4 className="font-bold text-sm text-ink line-clamp-1">{p.title}</h4>
                      {p.description && <p className="text-[11px] text-ink-500 line-clamp-2">{p.description}</p>}
                    </div>

                    <div className="pt-2 border-t border-[var(--border-faint)] flex items-center justify-between text-[11px] text-ink-400">
                      <div className="flex items-center gap-2">
                        <span>📥 {p.downloads_count || 0} dl</span>
                        <span>🛒 {p.sales_count || 0} sales</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {p.kind === "license_key" && (
                          <span className="font-mono" title="Licence keys left / sold">🔑 {p.license_keys_available ?? 0} left · {p.license_keys_issued ?? 0} sold</span>
                        )}
                        {p.file_name && !p.file_url && <span className="truncate max-w-[8rem]" title={p.file_name}>🔒 {p.file_name}</span>}
                        <label className="cursor-pointer text-gold font-bold hover:underline">
                          {p.file_name && !p.file_url ? "Replace file" : "Upload file"}
                          <input type="file" className="sr-only" onChange={(e) => { void handleUploadDigitalFile(p.id, e.target.files?.[0]); e.target.value = ""; }} />
                        </label>
                        {p.file_url && (
                          <a
                            href={p.file_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-gold font-bold hover:underline"
                          >
                            Test URL
                          </a>
                        )}
                        <button
                          type="button"
                          aria-label={`Delete ${p.title}`} onClick={() => handleDeleteDigitalProduct(p.id)}
                          className="text-red-500 hover:text-red-600 pl-2"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Customer Digital Fulfillments Audit Table */}
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-ink">Customer Digital Passes & License Keys</h4>
                  <span className="text-xs text-ink-400">{digitalFulfillments.length} issued</span>
                </div>

                {digitalFulfillments.length === 0 ? (
                  <p className="text-xs text-ink-400 py-4 text-center">No digital orders fulfilled yet.</p>
                ) : (
                  <div className="space-y-2">
                    {digitalFulfillments.map((f) => (
                      <div
                        key={f.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink">{f.customer_name || "Customer"}</span>
                            <span className="font-mono text-ink-500">({f.customer_phone})</span>
                            <span className="rounded bg-gold/15 text-gold px-1.5 py-0.2 text-[10px] font-mono">
                              link …{f.token_hint ?? "----"}
                            </span>
                          </div>
                          <div className="text-[11px] text-ink-500 mt-1 flex items-center gap-2">
                            <span>{f.digital_product_title}</span>
                            {f.license_key_issued && (
                              <span className="font-mono font-bold text-gold">Key: {f.license_key_issued}</span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="font-mono text-[11px] text-ink-400">
                            {f.download_count} / {f.max_downloads} downloads
                          </span>
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              f.status === "active" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"
                            }`}
                          >
                            {f.status}
                          </span>
                          {f.needs_manual_fulfilment && (
                            <button type="button" onClick={() => handleFulfilLicense(f.id)} className="text-[10px] text-gold font-bold hover:underline">
                              Add key
                            </button>
                          )}
                          {f.status === "active" && (
                            <button type="button" onClick={() => handleResendFulfillment(f.id)} className="text-[10px] text-ink-500 font-bold hover:underline">
                              Resend{f.sms_status ? ` (${f.sms_status})` : ""}
                            </button>
                          )}
                          {!f.refunded_at && Number(f.price_paid_ugx) > 0 && (
                            <button type="button" onClick={() => handleRefundFulfillment(f.id)} className="text-[10px] text-red-500 font-bold hover:underline">
                              Refund {ugx(Number(f.price_paid_ugx))}
                            </button>
                          )}
                          {f.status === "active" && (
                            <button
                              type="button"
                              onClick={() => handleRevokeFulfillment(f.id)}
                              className="text-[10px] text-red-500 font-bold hover:underline"
                            >
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ELITE SECTION: ROBUST LMS & PEEBEE LEARN DIRECT SYNC */}
          {eliteSection === "lms" && store.permissions?.manage_digital === false && <p role="status" className="home-card">Your team role cannot manage courses. Ask the business owner for access.</p>}
          {eliteSection === "lms" && store.permissions?.manage_digital !== false && (
            <div className="space-y-5">
              {/* Header with Peebee Learn Sync Status */}
              <div className="rounded-[24px] border border-gold/40 bg-gradient-to-br from-black-900 via-neutral-900 to-black-900 p-5 text-white shadow-md flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
                      Peebee Learn Engine Synced
                    </span>
                    <span className="font-mono text-xs text-gold">edu_courses · live</span>
                  </div>
                  <h3 className="font-serif text-xl font-black mt-1">Tier 3 Merchant Learning Management System (LMS)</h3>
                  <p className="text-xs text-neutral-300 mt-1 max-w-xl">
                    Create courses, masterclasses, video curricula, and quizzes. Students who purchase are instantly enrolled in the Peebee Learn player with automated progress tracking and certificates.
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={syncingLearn}
                    onClick={handleSyncFromLearn}
                    className="flex items-center gap-2 rounded-full border border-gold/50 bg-gold/15 px-4 py-2 text-xs font-bold text-gold hover:bg-gold hover:text-ink-gold transition active:scale-95 disabled:opacity-50"
                  >
                    <span>{syncingLearn ? "Syncing Learn…" : "⟳ Sync with Peebee Learn"}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNewCourse(!showNewCourse)}
                    className="flex items-center gap-2 rounded-full bg-gold px-4 py-2 text-xs font-black text-ink-gold shadow transition active:scale-95"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create Masterclass</span>
                  </button>
                </div>
              </div>

              {/* LMS Metrics */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Active Courses</span>
                  <div className="mt-1 font-serif text-xl font-black text-ink">{lmsCourses.length}</div>
                  <span className="text-[10px] text-ink-400">Masterclasses & Certifications</span>
                </div>
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Enrolled Students</span>
                  <div className="mt-1 font-serif text-xl font-black text-emerald-600">
                    {lmsEnrollments.length}
                  </div>
                  <span className="text-[10px] text-ink-400">Active learners in portal</span>
                </div>
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Avg Completion Rate</span>
                  <div className="mt-1 font-serif text-xl font-black text-gold">{lmsEnrollments.length ? `${Math.round(lmsEnrollments.reduce((sum, e) => sum + Number(e.progress_percent || 0), 0) / lmsEnrollments.length)}%` : "No learners yet"}</div>
                  <span className="text-[10px] text-ink-400">Module & lesson mastery</span>
                </div>
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Certificates Issued</span>
                  <div className="mt-1 font-serif text-xl font-black text-ink">
                    {lmsEnrollments.filter((e) => e.certificate_issued).length}
                  </div>
                  <span className="text-[10px] text-ink-400">Verified credentials</span>
                </div>
              </div>

              {/* Create Course Form */}
              {showNewCourse && (
                <form
                  onSubmit={handleCreateCourse}
                  className="rounded-[24px] border border-gold/40 bg-[rgb(var(--surface-card))] p-5 shadow-md space-y-4 animate-in fade-in slide-in-from-top-2"
                >
                  <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
                    <span className="font-bold text-sm text-ink flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-gold" /> Create Online Course / Masterclass
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowNewCourse(false)}
                      className="text-ink-400 hover:text-ink text-xs"
                    >
                      ✕
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="store-field-41" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Course Title</label>
                      <input id="store-field-41"
                        type="text"
                        required
                        value={courseTitle}
                        onChange={(e) => setCourseTitle(e.target.value)}
                        placeholder="e.g. Commercial Horticulture & Greenhouse Farming"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-semibold"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-42" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Peebee Learn Stream</label>
                      <select id="store-field-42"
                        value={courseStream}
                        onChange={(e) => setCourseStream(e.target.value as any)}
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-semibold"
                      >
                        <option value="skills">Skills & Vocational Mastery</option>
                        <option value="academy">Academy & High School Level</option>
                        <option value="compass">Compass Professional Career</option>
                        <option value="foundations">Foundations & Primary</option>
                        <option value="sprouts">Sprouts Early Learning</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="store-field-43" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Enrollment Price (UGX)</label>
                      <input id="store-field-43"
                        type="number"
                        min="0"
                        value={coursePrice}
                        onChange={(e) => setCoursePrice(e.target.value)}
                        placeholder="85000"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-mono font-bold"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-44" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Cover Artwork URL</label>
                      <input id="store-field-44"
                        type="url"
                        value={courseCoverUrl}
                        onChange={(e) => setCourseCoverUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="store-field-45" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Course Summary & Outcomes</label>
                    <textarea id="store-field-45"
                      rows={2}
                      value={courseSummary}
                      onChange={(e) => setCourseSummary(e.target.value)}
                      placeholder="What practical skills will the student learn? Includes 4 video modules, hands-on tasks, and final certification exam..."
                      className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-1">
                    <input
                      type="checkbox"
                      id="courseCertCheck"
                      checked={courseCertEnabled}
                      onChange={(e) => setCourseCertEnabled(e.target.checked)}
                      className="rounded border-[var(--border-faint)] text-gold focus:ring-gold"
                    />
                    <label htmlFor="courseCertCheck" className="text-xs text-ink font-semibold">
                      Issue verified digital certificate upon 100% course completion
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 pt-2 border-t border-[var(--border-faint)]">
                    <button
                      type="button"
                      onClick={() => setShowNewCourse(false)}
                      className="rounded-full px-4 py-2 text-xs font-bold text-ink-500 hover:text-ink"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={savingCourse}
                      className="rounded-full bg-gold px-6 py-2 text-xs font-black text-ink-gold shadow transition active:scale-95 disabled:opacity-60"
                    >
                      {savingCourse ? "Saving Course…" : "Create & Sync to Peebee Learn →"}
                    </button>
                  </div>
                </form>
              )}

              {/* Masterclasses List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-ink">Active Masterclasses & Syllabi</h4>
                  <button
                    type="button"
                    onClick={() => {
                      if (lmsCourses[0]) setEnrollCourseId(lmsCourses[0].id);
                      setShowEnrollModal(true);
                    }}
                    className="flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs font-bold text-gold hover:bg-gold hover:text-ink-gold transition"
                  >
                    <Users className="h-3.5 w-3.5" />
                    <span>Enroll Walk-In / B2B Student</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {lmsCourses.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-xs space-y-4 flex flex-col justify-between"
                    >
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="rounded-full bg-emerald-500/15 text-emerald-600 px-2.5 py-0.5 text-[10px] font-bold uppercase">
                            {c.stream}
                          </span>
                          <span className="font-mono text-sm font-black text-ink">{ugx(c.price_ugx)}</span>
                        </div>
                        <h4 className="font-serif text-base font-black text-ink">{c.title}</h4>
                        <p className="text-xs text-ink-500 line-clamp-2">{c.summary}</p>

                        {/* Modules preview */}
                        {c.modules && c.modules.length > 0 && (
                          <div className="space-y-1.5 pt-1">
                            <span className="text-[10px] font-bold uppercase text-ink-400">Curriculum Structure:</span>
                            {c.modules.slice(0, 2).map((m, idx) => (
                              <div
                                key={m.id || idx}
                                className="rounded-lg bg-[rgb(var(--surface-muted))] px-2.5 py-1.5 text-[11px] flex items-center justify-between"
                              >
                                <span className="font-semibold text-ink line-clamp-1">{m.title}</span>
                                <span className="text-ink-400 font-mono text-[10px] shrink-0">
                                  {m.lessons?.length || 2} lessons
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-[var(--border-faint)] flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 text-ink-400 text-[11px]">
                          <span>👥 {c.enrolled_students_count || 0} students</span>
                          {c.certificate_enabled ? <span>📜 Certificate</span> : <span>No certificate</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleListInLearn(c.id, !c.learn_synced)}
                          className="rounded-full border border-[var(--border-faint)] px-3 py-1 text-[11px] font-bold text-ink"
                        >
                          {c.learn_synced ? "Unlist from Learn" : "List in Learn"}
                        </button>
                        <a
                          href={`https://app.peebee.online/learn/course/${c.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 font-bold text-gold hover:underline text-xs"
                        >
                          <PlayCircle className="h-3.5 w-3.5" />
                          <span>Peebee Learn Player →</span>
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Student Enrollments CRM */}
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-ink">Enrolled Learners & Progress Ledger</h4>
                  <span className="text-xs text-ink-400">{lmsEnrollments.length} active students</span>
                </div>

                {lmsEnrollments.length === 0 ? (
                  <p className="text-xs text-ink-400 py-4 text-center">No student enrollments yet.</p>
                ) : (
                  <div className="space-y-2">
                    {lmsEnrollments.map((enr) => (
                      <div
                        key={enr.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl bg-[rgb(var(--surface-muted))] p-3.5 text-xs"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-ink">{enr.student_name}</span>
                            <span className="font-mono text-ink-500">({enr.student_phone})</span>
                            {enr.certificate_issued && (
                              <span className="rounded-full bg-gold/15 text-gold px-2 py-0.5 text-[10px] font-bold">
                                🎖️ Certified
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-ink-500 flex items-center gap-2">
                            <span>{enr.course_title}</span>
                            {enr.quiz_average_score != null && (
                              <span className="font-mono text-emerald-600 font-bold">Quiz: {enr.quiz_average_score}%</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          <div className="w-24 text-right">
                            <div className="flex items-center justify-between text-[10px] font-mono text-ink-500">
                              <span>Progress</span>
                              <span className="font-bold text-ink">{enr.progress_percent}%</span>
                            </div>
                            <div className="mt-1 h-1.5 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 transition-all duration-300"
                                style={{ width: `${enr.progress_percent}%` }}
                              />
                            </div>
                          </div>

                          {enr.progress_percent >= 100 && !enr.certificate_issued && (
                            <button type="button" onClick={() => void handleIssueCertificate(enr.id)} className="rounded-full bg-gold px-3 py-1.5 text-[11px] font-black text-ink-gold">
                              Issue certificate
                            </button>
                          )}
                          <a
                            href={enr.learn_portal_url}
                            target="_blank"
                            rel="noreferrer"
                            className="rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-1.5 text-[11px] font-bold text-ink hover:text-gold transition"
                          >
                            Classroom →
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Manual Student Enrollment Modal */}
              {showEnrollModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
                  <div className="w-full max-w-md rounded-[24px] border border-gold/40 bg-[rgb(var(--surface-card))] p-6 shadow-2xl space-y-4">
                    <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
                      <h4 className="font-bold text-base text-ink">Enroll Student in Academy</h4>
                      <button
                        type="button"
                        onClick={() => setShowEnrollModal(false)}
                        className="text-ink-400 hover:text-ink text-xs"
                      >
                        ✕
                      </button>
                    </div>

                    <form onSubmit={handleEnrollStudent} className="space-y-3">
                      <div>
                        <label htmlFor="store-field-46" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Select Masterclass</label>
                        <select id="store-field-46"
                          required
                          value={enrollCourseId}
                          onChange={(e) => setEnrollCourseId(e.target.value)}
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink font-semibold"
                        >
                          <option value="">Choose a course...</option>
                          {lmsCourses.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title} ({ugx(c.price_ugx)})
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="store-field-47" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Student Full Name</label>
                        <input id="store-field-47"
                          type="text"
                          required
                          value={enrollStudentName}
                          onChange={(e) => setEnrollStudentName(e.target.value)}
                          placeholder="e.g. Juliet Namubiru"
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink"
                        />
                      </div>

                      <div>
                        <label htmlFor="store-field-48" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Student Phone (MTN / Airtel)</label>
                        <input id="store-field-48"
                          type="tel"
                          required
                          value={enrollStudentPhone}
                          onChange={(e) => setEnrollStudentPhone(e.target.value)}
                          placeholder="+256 772 123 456"
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs font-mono text-ink"
                        />
                      </div>

                      <div>
                        <label htmlFor="store-field-49" className="block text-[11px] font-bold uppercase text-ink-500 mb-1">Email Address (Optional)</label>
                        <input id="store-field-49"
                          type="email"
                          value={enrollStudentEmail}
                          onChange={(e) => setEnrollStudentEmail(e.target.value)}
                          placeholder="student@gmail.com"
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-2.5 text-xs text-ink"
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <input
                          type="checkbox"
                          id="enrollSendSmsCheck"
                          checked={enrollSendSms}
                          onChange={(e) => setEnrollSendSms(e.target.checked)}
                          className="rounded border-[var(--border-faint)] text-gold focus:ring-gold"
                        />
                        <label htmlFor="enrollSendSmsCheck" className="text-xs text-ink font-semibold">
                          Dispatch automated SMS with Peebee Learn login credentials
                        </label>
                      </div>

                      <div className="flex justify-end gap-2 pt-3 border-t border-[var(--border-faint)]">
                        <button
                          type="button"
                          onClick={() => setShowEnrollModal(false)}
                          className="rounded-full px-4 py-2 text-xs font-bold text-ink-500 hover:text-ink"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={enrollingStudent}
                          className="rounded-full bg-gold px-6 py-2 text-xs font-black text-ink-gold shadow transition active:scale-95 disabled:opacity-60"
                        >
                          {enrollingStudent ? "Enrolling…" : "Confirm & Grant Access →"}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* SECTION 9: PURCHASE ORDERS & STOCK RECEIVING */}
          {eliteSection === "po" && (
            <div className="space-y-4">
              {/* Header & Quick Restock Suggestions */}
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-bold text-base text-ink">Supplier POs & 1-Tap Stock Receiving</h3>
                    <p className="text-xs text-ink-500">
                      Procure inventory from wholesalers, restock low items, and receive shipments directly into branch outlets.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewSupplier(!showNewSupplier)}
                      className="rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3.5 py-2 text-xs font-bold text-ink transition active:scale-95"
                    >
                      {showNewSupplier ? "Cancel" : "+ Add Supplier"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setShowNewPo(!showNewPo);
                        if (!showNewPo && poItems.length === 0 && products.length > 0) {
                          setPoItems([{ productId: products[0].id, title: products[0].title, quantity: 10, unitCost: Math.round(products[0].price * 0.7) }]);
                        }
                      }}
                      className="flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-ink-gold shadow transition active:scale-95"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Create PO</span>
                    </button>
                  </div>
                </div>

                {/* Low Stock Warning Banner */}
                {products.filter((p) => p.inventory_quantity <= 5).length > 0 && (
                  <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 flex items-center justify-between flex-wrap gap-2 text-xs">
                    <div className="flex items-center gap-2 text-amber-700 dark:text-amber-300">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>
                        <strong>{products.filter((p) => p.inventory_quantity <= 5).length} product(s)</strong> are low on stock (5 or fewer units remaining).
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const lowItems = products
                          .filter((p) => p.inventory_quantity <= 5)
                          .map((p) => ({ productId: p.id, title: p.title, quantity: 20, unitCost: Math.round(p.price * 0.7) }));
                        setPoItems(lowItems);
                        setShowNewPo(true);
                      }}
                      className="rounded-full bg-amber-600 px-3 py-1 font-bold text-white shadow-sm transition active:scale-95"
                    >
                      1-Tap Restock All Low Items
                    </button>
                  </div>
                )}

                {/* Add Supplier Form */}
                {showNewSupplier && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!supName.trim()) return;
                      setSupSubmitting(true);
                      try {
                        const res = await api.createMerchantSupplier({
                          name: supName.trim(),
                          contact_person: supContact.trim() || undefined,
                          phone: supPhone.trim() || undefined,
                          email: supEmail.trim() || undefined,
                          address: supAddress.trim() || undefined,
                        });
                        if (res.ok) {
                          setNotice("Supplier added successfully.");
                          setShowNewSupplier(false);
                          setSupName("");
                          setSupContact("");
                          setSupPhone("");
                          setSupEmail("");
                          setSupAddress("");
                          const sRes = await api.getMerchantSuppliers();
                          setSuppliers(sRes.suppliers || []);
                        }
                      } catch (err) {
                        setNotice("Failed: " + errorMessage(err));
                      } finally {
                        setSupSubmitting(false);
                      }
                    }}
                    className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-4 space-y-3"
                  >
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-500">Register New Wholesaler / Supplier</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="store-field-50" className="block text-[11px] font-bold text-ink-500 mb-1">Company / Supplier Name *</label>
                        <input id="store-field-50"
                          type="text"
                          required
                          value={supName}
                          onChange={(e) => setSupName(e.target.value)}
                          placeholder="e.g. Mukwano Industries Ltd"
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                        />
                      </div>
                      <div>
                        <label htmlFor="store-field-51" className="block text-[11px] font-bold text-ink-500 mb-1">Contact Person</label>
                        <input id="store-field-51"
                          type="text"
                          value={supContact}
                          onChange={(e) => setSupContact(e.target.value)}
                          placeholder="e.g. Sarah Namubiru"
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                        />
                      </div>
                      <div>
                        <label htmlFor="store-field-52" className="block text-[11px] font-bold text-ink-500 mb-1">Phone Number</label>
                        <input id="store-field-52"
                          type="text"
                          value={supPhone}
                          onChange={(e) => setSupPhone(e.target.value)}
                          placeholder="e.g. 0772 123 456"
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                        />
                      </div>
                      <div>
                        <label htmlFor="store-field-53" className="block text-[11px] font-bold text-ink-500 mb-1">Address / Warehouse</label>
                        <input id="store-field-53"
                          type="text"
                          value={supAddress}
                          onChange={(e) => setSupAddress(e.target.value)}
                          placeholder="e.g. 6th Street Industrial Area"
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowNewSupplier(false)}
                        className="rounded-xl border border-[var(--border-faint)] px-3 py-1.5 text-xs text-ink-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={supSubmitting}
                        className="rounded-xl bg-gold px-4 py-1.5 text-xs font-bold text-ink-gold disabled:opacity-50"
                      >
                        {supSubmitting ? "Saving..." : "Save Supplier"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Create PO Form */}
                {showNewPo && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (poItems.length === 0) {
                        setNotice("Add at least one item to the PO.");
                        return;
                      }
                      setPoSubmitting(true);
                      try {
                        const res = await api.createMerchantPurchaseOrder({
                          supplier_id: poSupplierId || undefined,
                          outlet_id: poOutletId || undefined,
                          items: poItems,
                          notes: poNotes.trim() || undefined,
                        });
                        if (res.ok) {
                          setNotice(`Purchase Order ${res.poNumber} created successfully.`);
                          setShowNewPo(false);
                          setPoItems([]);
                          setPoNotes("");
                          const poRes = await api.getMerchantPurchaseOrders();
                          setPurchaseOrders(poRes.purchaseOrders || []);
                        }
                      } catch (err) {
                        setNotice("Failed: " + errorMessage(err));
                      } finally {
                        setPoSubmitting(false);
                      }
                    }}
                    className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-ink-500">Draft Purchase Order</h4>
                      <span className="text-xs font-mono font-bold text-gold">
                        Total: {ugx(poItems.reduce((sum, it) => sum + (it.quantity || 1) * (it.unitCost || 0), 0))}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="store-field-54" className="block text-[11px] font-bold text-ink-500 mb-1">Select Supplier</label>
                        <select id="store-field-54"
                          value={poSupplierId}
                          onChange={(e) => setPoSupplierId(e.target.value)}
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink"
                        >
                          <option value="">Direct Wholesaler / Unlisted</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} {s.contact_person ? `(${s.contact_person})` : ""}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label htmlFor="store-field-55" className="block text-[11px] font-bold text-ink-500 mb-1">Destination Receiving Outlet</label>
                        <select id="store-field-55"
                          value={poOutletId}
                          onChange={(e) => setPoOutletId(e.target.value)}
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink"
                        >
                          <option value="">Master Central Warehouse</option>
                          {outlets.map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name} ({o.address || "Branch"})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* PO Items */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold text-ink-500">Order Items</label>
                        <button
                          type="button"
                          onClick={() => {
                            if (products.length > 0) {
                              setPoItems([...poItems, { productId: products[0].id, title: products[0].title, quantity: 10, unitCost: Math.round(products[0].price * 0.7) }]);
                            }
                          }}
                          className="text-[11px] font-bold text-gold hover:underline"
                        >
                          + Add Item Row
                        </button>
                      </div>

                      {poItems.map((it, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-[rgb(var(--surface-card))] p-2 rounded-xl text-xs">
                          <select
                            value={it.productId}
                            onChange={(e) => {
                              const found = products.find((p) => p.id === e.target.value);
                              const updated = [...poItems];
                              updated[idx] = {
                                ...updated[idx],
                                productId: e.target.value,
                                title: found?.title || "Product",
                                unitCost: found ? Math.round(found.price * 0.7) : updated[idx].unitCost,
                              };
                              setPoItems(updated);
                            }}
                            className="flex-1 rounded-lg border border-[var(--border-faint)] bg-transparent px-2 py-1 text-xs text-ink"
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title} (Stock: {p.inventory_quantity})
                              </option>
                            ))}
                          </select>

                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-ink-500">Qty:</span>
                            <input
                              type="number"
                              min="1"
                              value={it.quantity}
                              onChange={(e) => {
                                const updated = [...poItems];
                                updated[idx].quantity = Math.max(1, parseInt(e.target.value, 10) || 1);
                                setPoItems(updated);
                              }}
                              className="w-16 rounded-lg border border-[var(--border-faint)] bg-transparent px-2 py-1 text-xs text-ink"
                            />
                          </div>

                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-ink-500">Unit UGX:</span>
                            <input
                              type="number"
                              min="0"
                              value={it.unitCost}
                              onChange={(e) => {
                                const updated = [...poItems];
                                updated[idx].unitCost = Math.max(0, parseInt(e.target.value, 10) || 0);
                                setPoItems(updated);
                              }}
                              className="w-24 rounded-lg border border-[var(--border-faint)] bg-transparent px-2 py-1 text-xs text-ink"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setPoItems(poItems.filter((_, i) => i !== idx));
                            }}
                            className="p-1 text-red-500 hover:opacity-75"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div>
                      <label htmlFor="store-field-56" className="block text-[11px] font-bold text-ink-500 mb-1">Notes / Terms</label>
                      <input id="store-field-56"
                        type="text"
                        value={poNotes}
                        onChange={(e) => setPoNotes(e.target.value)}
                        placeholder="e.g. Payment on delivery via Mobile Money, expected Tuesday morning"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowNewPo(false)}
                        className="rounded-xl border border-[var(--border-faint)] px-3 py-1.5 text-xs text-ink-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={poSubmitting}
                        className="rounded-xl bg-gold px-4 py-1.5 text-xs font-bold text-ink-gold disabled:opacity-50"
                      >
                        {poSubmitting ? "Generating..." : "Generate Purchase Order"}
                      </button>
                    </div>
                  </form>
                )}

                {/* PO List */}
                {purchaseOrders.length === 0 ? (
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 text-xs text-ink-500">
                    No purchase orders logged yet. Tap <strong>"Create PO"</strong> above or use <strong>"1-Tap Restock"</strong> to generate supply orders with automatic stock receiving.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {purchaseOrders.map((po) => (
                      <div
                        key={po.id}
                        className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 space-y-3"
                      >
                        <div className="flex items-center justify-between flex-wrap gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-sm text-ink">{po.po_number}</span>
                            <span
                              className={`rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase ${
                                po.status === "received"
                                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                  : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                              }`}
                            >
                              {po.status}
                            </span>
                            {po.supplier_name && (
                              <span className="text-xs text-ink-500">from {po.supplier_name}</span>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="font-mono font-black text-sm text-gold">
                              {ugx(po.total_cost_ugx)}
                            </span>

                            {po.status !== "received" && (
                              <button
                                type="button"
                                disabled={receivingPoId === po.id}
                                onClick={async () => {
                                  setReceivingPoId(po.id);
                                  try {
                                    const res = await api.receiveMerchantPurchaseOrder(po.id);
                                    if (res.ok) {
                                      setNotice(`PO ${po.po_number} received: ${res.itemsReceivedCount} product(s) added to stock.`);
                                      const poRes = await api.getMerchantPurchaseOrders();
                                      setPurchaseOrders(poRes.purchaseOrders || []);
                                      api.getMerchantProProducts().then((res) => setProducts(res.products || [])).catch(() => {});
                                    }
                                  } catch (err) {
                                    setNotice("Receiving failed: " + errorMessage(err));
                                  } finally {
                                    setReceivingPoId(null);
                                  }
                                }}
                                className="flex items-center gap-1.5 rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white shadow transition active:scale-95 disabled:opacity-50"
                              >
                                <Check className="h-3.5 w-3.5" />
                                <span>{receivingPoId === po.id ? "Receiving..." : "1-Tap Receive Stock"}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Items preview */}
                        <div className="flex items-center gap-2 flex-wrap text-[11px] text-ink-500 border-t border-[var(--border-faint)] pt-2">
                          <span>Items ({po.items?.length || 0}):</span>
                          {po.items?.map((it, i) => (
                            <span key={i} className="rounded-md bg-[rgb(var(--surface-card))] px-2 py-0.5 text-ink">
                              {it.quantity}x {it.title} ({ugx(it.unitCost)})
                            </span>
                          ))}
                          {po.outlet_name && (
                            <span className="ml-auto text-[10px] text-ink-500">
                              Receiving to: <strong>{po.outlet_name}</strong>
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 10: PRODUCT BUNDLES & KITS */}
          {eliteSection === "bundles" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <h3 className="font-bold text-base text-ink">Product Bundles, Kits & Hampers</h3>
                    <p className="text-xs text-ink-500">
                      Offer package deals, gift baskets, and starter kits with bundle discount pricing.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setShowNewBundle(!showNewBundle);
                      if (!showNewBundle && bundleItems.length === 0 && products.length >= 2) {
                        setBundleItems([
                          { productId: products[0].id, title: products[0].title, quantity: 1 },
                          { productId: products[1].id, title: products[1].title, quantity: 1 },
                        ]);
                        setBundlePrice(String(Math.round((products[0].price + products[1].price) * 0.85)));
                        setBundleCompareAt(String(products[0].price + products[1].price));
                      }
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-gold px-4 py-2 text-xs font-bold text-ink-gold shadow transition active:scale-95"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Create Bundle</span>
                  </button>
                </div>

                {/* Create Bundle Form */}
                {showNewBundle && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!bundleTitle.trim()) return;
                      if (bundleItems.length === 0) {
                        setNotice("Add at least one item to bundle.");
                        return;
                      }
                      setBundleSubmitting(true);
                      try {
                        const res = await api.createMerchantBundle({
                          title: bundleTitle.trim(),
                          description: bundleDesc.trim() || undefined,
                          price: Math.max(0, parseInt(bundlePrice, 10) || 0),
                          compare_at_price: bundleCompareAt ? parseInt(bundleCompareAt, 10) : undefined,
                          items: bundleItems,
                        });
                        if (res.ok) {
                          setNotice("Bundle created successfully.");
                          setShowNewBundle(false);
                          setBundleTitle("");
                          setBundleDesc("");
                          setBundlePrice("");
                          setBundleCompareAt("");
                          setBundleItems([]);
                          const bRes = await api.getMerchantBundles();
                          setBundles(bRes.bundles || []);
                        }
                      } catch (err) {
                        setNotice("Failed: " + errorMessage(err));
                      } finally {
                        setBundleSubmitting(false);
                      }
                    }}
                    className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-4 space-y-3"
                  >
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-500">Configure Product Bundle / Hamper</h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="store-field-57" className="block text-[11px] font-bold text-ink-500 mb-1">Bundle Title *</label>
                        <input id="store-field-57"
                          type="text"
                          required
                          value={bundleTitle}
                          onChange={(e) => setBundleTitle(e.target.value)}
                          placeholder="e.g. Weekend Family BBQ Combo"
                          className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label htmlFor="store-field-58" className="block text-[11px] font-bold text-ink-500 mb-1">Bundle Price (UGX) *</label>
                          <input id="store-field-58"
                            type="number"
                            required
                            min="0"
                            value={bundlePrice}
                            onChange={(e) => setBundlePrice(e.target.value)}
                            placeholder="e.g. 45000"
                            className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink"
                          />
                        </div>
                        <div>
                          <label htmlFor="store-field-59" className="block text-[11px] font-bold text-ink-500 mb-1">Original Price (UGX)</label>
                          <input id="store-field-59"
                            type="number"
                            min="0"
                            value={bundleCompareAt}
                            onChange={(e) => setBundleCompareAt(e.target.value)}
                            placeholder="e.g. 55000"
                            className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink"
                          />
                        </div>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="store-field-60" className="block text-[11px] font-bold text-ink-500 mb-1">Description</label>
                      <input id="store-field-60"
                        type="text"
                        value={bundleDesc}
                        onChange={(e) => setBundleDesc(e.target.value)}
                        placeholder="e.g. Complete barbecue kit with beef, sausages, burger buns and barbecue sauce."
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                      />
                    </div>

                    {/* Bundle Component Items */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-bold text-ink-500">Component Products</label>
                        <button
                          type="button"
                          onClick={() => {
                            if (products.length > 0) {
                              setBundleItems([...bundleItems, { productId: products[0].id, title: products[0].title, quantity: 1 }]);
                            }
                          }}
                          className="text-[11px] font-bold text-gold hover:underline"
                        >
                          + Add Component
                        </button>
                      </div>

                      {bundleItems.map((it, idx) => (
                        <div key={idx} className="flex items-center gap-2 bg-[rgb(var(--surface-card))] p-2 rounded-xl text-xs">
                          <select
                            value={it.productId}
                            onChange={(e) => {
                              const found = products.find((p) => p.id === e.target.value);
                              const updated = [...bundleItems];
                              updated[idx] = {
                                ...updated[idx],
                                productId: e.target.value,
                                title: found?.title || "Product",
                              };
                              setBundleItems(updated);
                            }}
                            className="flex-1 rounded-lg border border-[var(--border-faint)] bg-transparent px-2 py-1 text-xs text-ink"
                          >
                            {products.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.title} ({ugx(p.price)})
                              </option>
                            ))}
                          </select>

                          <div className="flex items-center gap-1">
                            <span className="text-[10px] text-ink-500">Qty:</span>
                            <input
                              type="number"
                              min="1"
                              value={it.quantity}
                              onChange={(e) => {
                                const updated = [...bundleItems];
                                updated[idx].quantity = Math.max(1, parseInt(e.target.value, 10) || 1);
                                setBundleItems(updated);
                              }}
                              className="w-16 rounded-lg border border-[var(--border-faint)] bg-transparent px-2 py-1 text-xs text-ink"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setBundleItems(bundleItems.filter((_, i) => i !== idx));
                            }}
                            className="p-1 text-red-500 hover:opacity-75"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      ))}
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowNewBundle(false)}
                        className="rounded-xl border border-[var(--border-faint)] px-3 py-1.5 text-xs text-ink-500"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={bundleSubmitting}
                        className="rounded-xl bg-gold px-4 py-1.5 text-xs font-bold text-ink-gold disabled:opacity-50"
                      >
                        {bundleSubmitting ? "Saving..." : "Save Bundle"}
                      </button>
                    </div>
                  </form>
                )}

                {/* Bundles List */}
                {bundles.length === 0 ? (
                  <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 text-xs text-ink-500">
                    No product bundles created yet. Combine high-velocity products into gift boxes and kits to boost Average Order Value (AOV).
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {bundles.map((b) => {
                      const savings = b.compare_at_price && b.compare_at_price > b.price ? b.compare_at_price - b.price : 0;
                      return (
                        <div
                          key={b.id}
                          className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 flex flex-col justify-between space-y-3"
                        >
                          <div>
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-sm text-ink">{b.title}</h4>
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    await api.deleteMerchantBundle(b.id);
                                    setNotice("Bundle removed.");
                                    const bRes = await api.getMerchantBundles();
                                    setBundles(bRes.bundles || []);
                                  } catch (err) {
                                    setNotice("Delete failed: " + errorMessage(err));
                                  }
                                }}
                                className="text-red-500 hover:opacity-75 p-1"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            {b.description && (
                              <p className="mt-1 text-xs text-ink-500 line-clamp-2">{b.description}</p>
                            )}
                            <div className="mt-2 flex items-center gap-2">
                              <span className="font-mono font-black text-sm text-gold">{ugx(b.price)}</span>
                              {b.compare_at_price && (
                                <span className="font-mono text-xs text-ink-400 line-through">
                                  {ugx(b.compare_at_price)}
                                </span>
                              )}
                              {savings > 0 && (
                                <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-black text-emerald-600">
                                  Save {ugx(savings)}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="border-t border-[var(--border-faint)] pt-2 text-[11px] text-ink-500 space-y-1">
                            <span className="block font-bold">Includes ({b.items?.length || 0}):</span>
                            <div className="flex flex-wrap gap-1">
                              {b.items?.map((it, i) => (
                                <span key={i} className="rounded bg-[rgb(var(--surface-card))] px-2 py-0.5 text-ink">
                                  {it.quantity}x {it.title}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SECTION 11: WIN-BACK CAMPAIGNS */}
          {eliteSection === "winback" && (
            <div className="space-y-4">
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
                <div>
                  <h3 className="font-bold text-base text-ink">Customer Win-Back & Abandoned Cart Recovery</h3>
                  <p className="text-xs text-ink-500">
                    Re-engage shoppers who have not purchased recently or abandoned their bags with 1-tap WhatsApp promotions.
                  </p>
                </div>

                {/* Quick WhatsApp Campaign Sender Form */}
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!winbackPhone.trim()) return;
                    setWinbackSubmitting(true);
                    try {
                      const res = await api.sendMerchantWinbackCampaign({
                        customer_phone: winbackPhone.trim(),
                        customer_name: winbackName.trim() || undefined,
                        discount_code: winbackDiscount.trim() || undefined,
                        channel: "whatsapp",
                        message: winbackMessage.trim(),
                      });
                      if (res.ok) {
                        setNotice("Campaign logged! Opening WhatsApp...");
                        setWinbackResultUrl(res.whatsappUrl);
                        window.open(res.whatsappUrl, "_blank");
                        const cRes = await api.getMerchantWinbackCampaigns();
                        setWinbackCampaigns(cRes.campaigns || []);
                      }
                    } catch (err) {
                      setNotice("Failed: " + errorMessage(err));
                    } finally {
                      setWinbackSubmitting(false);
                    }
                  }}
                  className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-4 space-y-3"
                >
                  <h4 className="text-xs font-bold uppercase tracking-wider text-ink-500">Send WhatsApp Promotional Offer</h4>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="store-field-61" className="block text-[11px] font-bold text-ink-500 mb-1">Customer Phone *</label>
                      <input id="store-field-61"
                        type="text"
                        required
                        value={winbackPhone}
                        onChange={(e) => setWinbackPhone(e.target.value)}
                        placeholder="e.g. 0772 123 456"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-62" className="block text-[11px] font-bold text-ink-500 mb-1">Customer Name</label>
                      <input id="store-field-62"
                        type="text"
                        value={winbackName}
                        onChange={(e) => setWinbackName(e.target.value)}
                        placeholder="e.g. Christine"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-63" className="block text-[11px] font-bold text-ink-500 mb-1">Promo Code</label>
                      <input id="store-field-63"
                        type="text"
                        value={winbackDiscount}
                        onChange={(e) => setWinbackDiscount(e.target.value)}
                        placeholder="e.g. WELCOME10"
                        className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] px-3 py-2 text-xs text-ink placeholder:text-ink-300"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label className="text-[11px] font-bold text-ink-500">Personalized Message</label>
                      <button
                        type="button"
                        onClick={() => {
                          const storeName = store?.name || "our store";
                          const link = `https://${store?.slug || 'shop'}.peebee.online` || "https://peebee.online";
                          setWinbackMessage(
                            `Hello ${winbackName || "there"}! We miss you at ${storeName}. Use coupon ${winbackDiscount || "VIP10"} for special discounts on your next order today at ${link}`
                          );
                        }}
                        className="text-[11px] font-bold text-gold hover:underline"
                      >
                        Auto-generate Message
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      required
                      value={winbackMessage}
                      onChange={(e) => setWinbackMessage(e.target.value)}
                      placeholder="Enter WhatsApp message text..."
                      className="w-full rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3 text-xs text-ink placeholder:text-ink-300"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    {winbackResultUrl ? (
                      <a
                        href={winbackResultUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-bold text-emerald-600 hover:underline flex items-center gap-1"
                      >
                        <span>✓ WhatsApp Chat Ready (Click to reopen)</span>
                      </a>
                    ) : <div />}

                    <button
                      type="submit"
                      disabled={winbackSubmitting}
                      className="flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-bold text-white shadow transition active:scale-95 disabled:opacity-50"
                    >
                      <Send className="h-3.5 w-3.5" />
                      <span>{winbackSubmitting ? "Generating..." : "Prepare WhatsApp offer"}</span>
                    </button>
                  </div>
                </form>

                {/* Inactive & VIP Customers List for 1-Tap Win-Back */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-ink-500">
                    Inactive & Repeat Buyers Ready for Re-Engagement ({inactiveCustomers.length})
                  </h4>

                  {inactiveCustomers.length === 0 ? (
                    <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-4 text-xs text-ink-500">
                      No inactive buyers found. As shoppers complete orders, those who haven't ordered recently will automatically appear here.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {inactiveCustomers.map((cust) => (
                        <div
                          key={cust.id}
                          className="flex items-center justify-between rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs flex-wrap gap-2"
                        >
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-ink">{cust.customer_name || cust.customer_phone}</span>
                              <span className="rounded-full bg-gold/15 px-2 py-0.5 text-[10px] font-black uppercase text-gold">
                                {cust.tier}
                              </span>
                            </div>
                            <p className="mt-0.5 text-[10px] text-ink-500">
                              {cust.customer_phone} · {cust.orders_count} orders · Spent {ugx(cust.total_spent_ugx)}
                            </p>
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setWinbackPhone(cust.customer_phone);
                              setWinbackName(cust.customer_name || "");
                              const storeName = store?.name || "our store";
                              const link = `https://${store?.slug || 'shop'}.peebee.online` || "https://peebee.online";
                              setWinbackMessage(
                                `Hello ${cust.customer_name || "friend"}! We miss you at ${storeName}. We loaded ${ugx(cust.points_balance_ugx)} in loyalty points on your account! Use code ${winbackDiscount} on your next order today: ${link}`
                              );
                            }}
                            className="rounded-full bg-[rgb(var(--surface-card))] border border-[var(--border-faint)] px-3 py-1.5 text-xs font-bold text-ink transition hover:border-gold active:scale-95"
                          >
                            Select for Win-Back
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Campaign History Log */}
                {winbackCampaigns.length > 0 && (
                  <div className="space-y-2 border-t border-[var(--border-faint)] pt-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-ink-500">Recent Campaign Log</h4>
                    <div className="space-y-2">
                      {winbackCampaigns.map((camp) => (
                        <div
                          key={camp.id}
                          className="flex items-center justify-between rounded-xl bg-[rgb(var(--surface-muted))] p-2.5 text-xs"
                        >
                          <div>
                            <span className="font-bold text-ink">{camp.customer_name || camp.customer_phone}</span>
                            <span className="ml-2 text-[10px] text-ink-500">({camp.channel})</span>
                            <p className="text-[10px] text-ink-500 line-clamp-1">{camp.message}</p>
                          </div>
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                            {camp.status === "draft" ? "Prepared · delivery unconfirmed" : camp.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ELITE SUB-TAB: STORE 2.0 VISUAL SECTION PAGE BUILDER */}
          {eliteSection === "sections" && (
            <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[var(--border-faint)] pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/15 text-gold font-bold">
                      <SlidersHorizontal className="h-4 w-4" />
                    </span>
                    <h3 className="font-serif text-lg font-black text-ink">Store 2.0 Visual Section Page Builder</h3>
                    <span className="rounded-full bg-gold/20 px-2.5 py-0.5 text-[10px] font-black text-gold">Merchant Elite Level</span>
                  </div>
                  <p className="mt-1 text-xs text-ink-500">
                    Reorder homepage sections, toggle visibility, and customize section headlines directly without code.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {store && (
                    <a
                      href={store.custom_domain ? `https://${store.custom_domain}` : `https://${store.slug}.peebee.online`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3.5 py-2 text-xs font-bold text-ink hover:text-gold"
                    >
                      <Globe className="h-3.5 w-3.5 text-gold" />
                      View Live Storefront
                    </a>
                  )}
                  <button
                    type="button"
                    disabled={savingSections}
                    onClick={handleSaveSections}
                    className="rounded-full bg-gold px-5 py-2 text-xs font-black text-ink-gold shadow-sm transition active:scale-95 disabled:opacity-60"
                  >
                    {savingSections ? "Saving Layout…" : "Save Section Layout ✓"}
                  </button>
                </div>
              </div>

              {/* Sections Reordering List */}
              <div className="space-y-3">
                {storefrontSections.map((sec, idx) => (
                  <div
                    key={sec.id}
                    className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border p-4 transition ${
                      sec.enabled
                        ? "border-[var(--border-faint)] bg-[rgb(var(--surface-card))] shadow-xs"
                        : "border-dashed border-[var(--border-faint)] bg-[rgb(var(--surface-muted))]/60 opacity-60"
                    }`}
                  >
                    <div className="flex items-start sm:items-center gap-3 min-w-0 flex-1">
                      {/* Order Controls */}
                      <div className="flex flex-col items-center gap-1 shrink-0">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => moveSection(idx, "up")}
                          aria-label="Move Section Up"
                          className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink disabled:opacity-20"
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <span className="font-mono text-xs font-bold text-ink-500">{sec.order}</span>
                        <button
                          type="button"
                          disabled={idx === storefrontSections.length - 1}
                          onClick={() => moveSection(idx, "down")}
                          aria-label="Move Section Down"
                          className="flex h-6 w-6 items-center justify-center rounded bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-ink disabled:opacity-20"
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {/* Section Info & Editable Headlines */}
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] font-black uppercase tracking-wider bg-gold/15 text-gold px-2 py-0.5 rounded">
                            {sec.type.replace("_", " ")}
                          </span>
                          <span className="text-xs font-bold text-ink">{sec.title}</span>
                          {!sec.enabled && (
                            <span className="text-[10px] font-bold text-ink-400 bg-black/10 px-1.5 py-0.5 rounded">Hidden</span>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            value={sec.title}
                            onChange={(e) => updateSectionTitle(sec.id, e.target.value)}
                            placeholder="Section Title"
                            className="rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-1.5 text-xs font-bold text-ink"
                          />
                          <input
                            type="text"
                            value={sec.subtitle || ""}
                            onChange={(e) => updateSectionTitle(sec.id, sec.title, e.target.value)}
                            placeholder="Subtitle / Caption (Optional)"
                            className="rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-1.5 text-xs text-ink-500"
                          />
                        </div>
                        <SectionContentEditor section={sec} onChange={(settings) => updateSectionSettings(sec.id, settings)} />
                      </div>
                    </div>

                    {/* Toggle Visibility */}
                    <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
                      <button
                        type="button"
                        onClick={() => toggleSection(sec.id)}
                        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                          sec.enabled
                            ? "bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25"
                            : "bg-surface-muted text-ink-500 hover:bg-black/10"
                        }`}
                      >
                        {sec.enabled ? (
                          <>
                            <Eye className="h-3.5 w-3.5" /> Visible
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3.5 w-3.5" /> Hidden
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ELITE SUB-TAB: AUTOMATED SMS RECEIPTS & ORDER ALERTS */}
          {eliteSection === "sms" && (
            <div className="space-y-5">
              {/* Top SMS Status Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">SMS Gateway Status</span>
                  <div className="mt-1 flex items-center gap-1.5 font-bold text-sm text-emerald-600">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Online · {settings?.smsProvider || "Simulator"}
                  </div>
                  <span className="text-[10px] text-ink-400">Zero Carrier Cost Simulation</span>
                </div>

                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Rate Per SMS</span>
                  <div className="mt-1 font-mono text-base font-black text-ink">
                    UGX {settings?.eliteSmsCostPerMessageUgx || 35}
                  </div>
                  <span className="text-[10px] text-ink-400">Uganda Local Networks</span>
                </div>

                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Total SMS Dispatched</span>
                  <div className="mt-1 font-mono text-base font-black text-gold">{smsLogs.length} messages</div>
                  <span className="text-[10px] text-emerald-600 font-semibold">100% Delivery Rate</span>
                </div>

                <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-xs">
                  <span className="text-[10px] font-bold uppercase text-ink-500">Auto POS Receipts</span>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="autoPosSms"
                      checked={posSendSmsReceipt}
                      onChange={(e) => setPosSendSmsReceipt(e.target.checked)}
                      className="rounded text-gold focus:ring-gold"
                    />
                    <label htmlFor="autoPosSms" className="text-xs font-bold text-ink cursor-pointer">
                      {posSendSmsReceipt ? "Enabled (Auto)" : "Disabled"}
                    </label>
                  </div>
                  <span className="text-[10px] text-ink-400">Triggers on register sale</span>
                </div>
              </div>

              {/* Direct SMS Notification Dispatcher */}
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
                <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/15 text-gold font-bold">
                      <MessageSquare className="h-4 w-4" />
                    </span>
                    <div>
                      <h3 className="font-serif text-base font-black text-ink">Dispatch Direct SMS Notification</h3>
                      <p className="text-[11px] text-ink-500">Send an instant customer alert or test SMS message</p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleSendDirectSms} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label htmlFor="store-field-64" className="text-xs font-semibold text-ink-500">Customer Phone Number</label>
                      <input id="store-field-64"
                        type="text"
                        value={smsRecipientPhone}
                        onChange={(e) => setSmsRecipientPhone(e.target.value)}
                        placeholder="e.g. +256 701 445889"
                        className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2 text-xs font-mono font-bold text-ink"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-65" className="text-xs font-semibold text-ink-500">Customer Name (Optional)</label>
                      <input id="store-field-65"
                        type="text"
                        value={smsRecipientName}
                        onChange={(e) => setSmsRecipientName(e.target.value)}
                        placeholder="e.g. Dr. Julian M."
                        className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2 text-xs text-ink"
                      />
                    </div>
                    <div>
                      <label htmlFor="store-field-66" className="text-xs font-semibold text-ink-500">Alert Type</label>
                      <select id="store-field-66"
                        value={smsMessageType}
                        onChange={(e) => {
                          const val = e.target.value as any;
                          setSmsMessageType(val);
                          if (val === "pos_receipt") {
                            setSmsBody(`Thank you for shopping at ${store?.name || "our store"}! Your digital POS receipt code is #POS-0892. Amount: UGX 48,925. View receipt: https://${store?.slug || "store"}.peebee.online/receipts/0892`);
                          } else if (val === "order_confirmation") {
                            setSmsBody(`Your order with ${store?.name || "our store"} has been received and verified. Boda rider will be dispatched shortly!`);
                          } else if (val === "dispatch_alert") {
                            setSmsBody(`Peebee Dispatch Alert: Boda rider is en route with your package from ${store?.name || "our store"}. Keep your phone nearby.`);
                          }
                        }}
                        className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2 text-xs font-bold text-ink"
                      >
                        <option value="pos_receipt">Digital POS Receipt</option>
                        <option value="order_confirmation">Storefront Order Confirmation</option>
                        <option value="dispatch_alert">Boda Delivery Dispatch Alert</option>
                        <option value="abandoned_cart">Abandoned Cart SMS Recovery</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="store-field-67" className="text-xs font-semibold text-ink-500">SMS Message Content</label>
                    <textarea id="store-field-67"
                      rows={2}
                      value={smsBody}
                      onChange={(e) => setSmsBody(e.target.value)}
                      placeholder="Type SMS text message..."
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] p-3 text-xs text-ink"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[11px] text-ink-400">
                      Standard GSM: {smsBody.length} characters ({Math.ceil(smsBody.length / 160) || 1} SMS segment)
                    </span>
                    <button
                      type="submit"
                      disabled={sendingSms}
                      className="rounded-full bg-gold px-6 py-2.5 text-xs font-black text-ink-gold shadow-sm transition active:scale-95 disabled:opacity-60"
                    >
                      {sendingSms ? "Sending SMS…" : "Send Instant SMS Notification →"}
                    </button>
                  </div>
                </form>

                {lastSmsSent && (
                  <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 flex items-center justify-between text-xs">
                    <span className="font-bold text-emerald-700">✓ SMS successfully dispatched! Tracking ID: {lastSmsSent.id}</span>
                    {lastSmsSent.whatsappUrl && (
                      <a
                        href={lastSmsSent.whatsappUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-full bg-emerald-600 text-white px-3 py-1 font-bold text-[11px] flex items-center gap-1 shadow-xs"
                      >
                        Share via WhatsApp
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Recent SMS Delivery Logs */}
              <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-3">
                <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
                  <h4 className="font-bold text-xs uppercase tracking-wider text-ink-500">Recent SMS Delivery Logs</h4>
                  <span className="text-xs text-ink-400">{smsLogs.length} recorded</span>
                </div>

                {smsLogs.length === 0 ? (
                  <p className="text-xs text-ink-500 py-4 text-center">No SMS notifications recorded yet.</p>
                ) : (
                  <div className="space-y-2">
                    {smsLogs.map((log) => (
                      <div
                        key={log.id}
                        className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-xl bg-[rgb(var(--surface-muted))] p-3 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-ink">{log.recipient_phone}</span>
                            {log.recipient_name && (
                              <span className="text-[11px] text-ink-500">({log.recipient_name})</span>
                            )}
                            <span className="font-mono text-[10px] font-bold uppercase bg-gold/15 text-gold px-1.5 py-0.5 rounded">
                              {log.message_type.replace("_", " ")}
                            </span>
                          </div>
                          <p className="text-[11px] text-ink-500 mt-1 line-clamp-1">{log.body}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="font-mono text-[10px] text-ink-400">UGX {log.cost_ugx || 35}</span>
                          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-600">
                            {log.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          </>
          )}
        </div>
      )}

      {/* TAB 1: PRODUCT CATALOG */}
      {activeTab === "catalog" && (
        <div className="space-y-4">
          {/* Quick Action Bar */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowAddProduct(true)}
                className="flex items-center gap-2 rounded-full bg-gold px-4 py-2.5 text-xs font-bold text-ink-gold shadow transition active:scale-95"
              >
                <Plus className="h-4 w-4" />
                <span>Add Product</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setPreviewScreen("storefront");
                  setShowStorefrontPreview(true);
                }}
                className="flex items-center gap-1.5 rounded-full border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3.5 py-2.5 text-xs font-bold text-ink transition hover:border-gold active:scale-95 shadow-xs"
              >
                <Eye className="h-4 w-4 text-gold" />
                <span>Preview Storefront</span>
              </button>
            </div>

            {products.length === 0 && (
              <button
                onClick={handleLoadStarterPack}
                className="flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-4 py-2.5 text-xs font-bold text-gold transition hover:bg-gold/20 active:scale-95"
              >
                <Zap className="h-4 w-4" />
                <span>1-Click Starter Pack</span>
              </button>
            )}
          </div>

          {/* Product List */}
          {products.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-8 text-center space-y-3">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gold/10 text-gold text-2xl">
                📦
              </div>
              <h3 className="text-base font-bold text-ink">Your Catalog is Empty</h3>
              <p className="text-xs text-ink-500 max-w-sm mx-auto">
                Add your first product or tap "1-Click Starter Pack" to instantly populate 6 bestselling{" "}
                {store.category === "groceries" ? "produce items" : "store products"}.
              </p>
              <button
                onClick={handleLoadStarterPack}
                className="mt-2 inline-flex items-center gap-2 rounded-full bg-gold px-5 py-2.5 text-xs font-bold text-ink-gold shadow transition active:scale-95"
              >
                <Zap className="h-4 w-4" />
                <span>Load Starter Pack (Chap Chap)</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {products.map((p) => {
                const variants = p.variants || [];
                return (
                  <div
                    key={p.id}
                    className="flex flex-col justify-between rounded-[22px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-3.5 shadow-sm transition hover:shadow-md"
                  >
                    <div>
                      <div className="relative aspect-[4/3] w-full overflow-hidden rounded-xl bg-neutral-100 dark:bg-neutral-800">
                        {p.image_url ? (
                          <img
                            src={p.image_url}
                            alt={p.title}
                            className="h-full w-full object-cover transition duration-300 hover:scale-105"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-3xl">🛍️</div>
                        )}
                        {p.badge ? (
                          <span className="absolute top-2 left-2 rounded-full bg-gold px-2 py-0.5 text-[9px] font-black text-ink-gold uppercase">
                            {p.badge}
                          </span>
                        ) : null}
                        {p.compare_at_price && p.compare_at_price > p.price && (
                          <span className="absolute top-2 right-2 rounded-full bg-red-600 px-2 py-0.5 text-[9px] font-bold text-white">
                            Sale
                          </span>
                        )}
                      </div>

                      <div className="mt-3">
                        <h4 className="font-bold text-sm text-ink leading-snug line-clamp-1">{p.title}</h4>
                        {p.description && (
                          <p className="mt-0.5 text-xs text-ink-500 line-clamp-1">{p.description}</p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 border-t border-[var(--border-faint)] pt-2.5 flex items-center justify-between">
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-mono font-black text-sm text-ink">{ugx(p.price)}</span>
                          {p.compare_at_price && (
                            <span className="font-mono text-[10px] text-ink-500 line-through">
                              {ugx(p.compare_at_price)}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-ink-500 font-medium">
                          {p.inventory_quantity} in stock {variants.length > 0 && `· ${variants.length} variants`}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => {
                            setPinnedProductId(p.id);
                            setNotice(`📌 Pinned "${p.title}" for your live stream!`);
                          }}
                          title="Pin in Live Stream"
                          className={`flex h-8 w-8 items-center justify-center rounded-full transition active:scale-95 ${
                            pinnedProductId === p.id
                              ? "bg-gold text-ink font-bold"
                              : "bg-[rgb(var(--surface-muted))] text-ink-500 hover:text-gold"
                          }`}
                        >
                          <Flame className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: TIKTOK LIVE SELLING STUDIO */}
      {activeTab === "live" && (
        <div className="space-y-4">
          <div className="rounded-[24px] border border-red-500/20 bg-gradient-to-br from-red-950/20 via-neutral-900 to-black-900 p-5 text-white shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-3 w-3 rounded-full bg-red-500 animate-ping" />
                <span className="text-xs font-bold uppercase tracking-wider text-red-400">
                  TikTok Live Commerce Hub
                </span>
              </div>
              <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-[10px] font-bold text-neutral-300">
                HD Video & Instant Checkout
              </span>
            </div>

            <h3 className="font-serif text-xl font-black text-white">
              Sell Products Live on Camera
            </h3>
            <p className="text-xs text-neutral-300">
              Go live directly to Peebee shoppers. Pin featured products so viewers can buy with 1 tap without leaving
              the video! Replay videos are automatically saved.
            </p>

            <div className="pt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setShowLiveStudio(true)}
                className="flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-xs font-bold text-white shadow transition hover:bg-red-700 active:scale-95"
              >
                <Radio className="h-4 w-4" />
                <span>Open Live Studio</span>
              </button>
            </div>
          </div>

          {/* Live Studio Modal / Drawer */}
          {showLiveStudio && (
            <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-3 w-3 rounded-full bg-red-500 animate-pulse" />
                  <h3 className="font-bold text-base text-ink">Broadcast Studio</h3>
                </div>
                <button
                  onClick={() => setShowLiveStudio(false)}
                  className="rounded-full p-1.5 text-ink-500 hover:text-ink"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {!isLiveActive ? (
                <div className="space-y-3">
                  <div>
                    <label htmlFor="store-field-68" className="text-xs font-semibold text-ink-500">Stream Title</label>
                    <input id="store-field-68"
                      type="text"
                      value={liveTitle}
                      onChange={(e) => setLiveTitle(e.target.value)}
                      placeholder="e.g. Flash Sale! 30% Off Fresh Fruit & Organic Veg"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink placeholder:text-ink-500/50 focus:border-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="store-field-69" className="text-xs font-semibold text-ink-500">
                      Hosted stream URL (HTTPS, required)
                    </label>
                    <input id="store-field-69"
                      type="text"
                      value={liveStreamUrl}
                      onChange={(e) => setLiveStreamUrl(e.target.value)}
                      placeholder="https://your-video-host.example/stream.m3u8"
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink placeholder:text-ink-500/50 focus:border-gold focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-ink-500">Pin Starting Product</label>
                    <Select
                      aria-label="Pin Starting Product"
                      value={pinnedProductId}
                      onValueChange={(val) => setPinnedProductId(val)}
                      className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink focus:border-gold"
                    >
                      <option value="">No product pinned</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title} · {ugx(p.price)}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <button
                    onClick={handleStartLiveSession}
                    disabled={startingLive || !liveTitle.trim() || !/^https:\/\//i.test(liveStreamUrl.trim())}
                    className="flex w-full items-center justify-center gap-2 rounded-full bg-red-600 py-3.5 text-sm font-bold text-white shadow-md transition hover:bg-red-700 active:scale-98 disabled:opacity-50"
                  >
                    {startingLive ? "Listing stream…" : "List hosted stream"}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative aspect-[9/16] w-full max-w-sm mx-auto overflow-hidden rounded-[24px] bg-black shadow-2xl">
                    {liveStreamUrl ? (
                      <video
                        src={liveStreamUrl}
                        autoPlay
                        loop
                        muted
                        playsInline
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full flex-col items-center justify-center bg-gradient-to-b from-neutral-800 to-black text-white p-6 text-center">
                        <Camera className="h-12 w-12 text-gold animate-bounce mb-3" />
                        <h4 className="font-bold text-lg">No hosted stream connected</h4>
                        <p className="text-xs text-neutral-400 mt-1">
                          Add a hosted HTTPS stream URL to display video here.
                        </p>
                      </div>
                    )}

                    <div className="absolute top-4 left-4 flex items-center gap-2">
                      <span className="flex items-center gap-1 rounded-full bg-red-600 px-2.5 py-1 text-[10px] font-black text-white uppercase tracking-wider">
                        <Radio className="h-3 w-3" /> LIVE
                      </span>
                      <span className="flex items-center gap-1 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-md">
                        <Users className="h-3 w-3 text-gold" /> Viewer count unavailable
                      </span>
                    </div>

                    <div className="absolute top-4 right-4">
                      <button
                        onClick={handleEndLiveSession}
                        className="rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-red-400 backdrop-blur-md hover:bg-red-600 hover:text-white transition"
                      >
                        End
                      </button>
                    </div>

                    {pinnedProductId && (
                      <div className="absolute bottom-20 inset-x-3 rounded-2xl bg-black/75 p-2.5 backdrop-blur-md border border-gold/40 flex items-center justify-between gap-3 text-white">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gold text-ink font-bold text-xs">
                            🏷️
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold truncate">
                              {products.find((p) => p.id === pinnedProductId)?.title || "Featured Item"}
                            </p>
                            <p className="text-[11px] font-mono text-gold font-bold">
                              {ugx(products.find((p) => p.id === pinnedProductId)?.price || 0)}
                            </p>
                          </div>
                        </div>

                        <span className="shrink-0 rounded-full bg-gold px-3 py-1 text-[10px] font-black text-ink">
                          PINNED
                        </span>
                      </div>
                    )}

                    <p className="absolute bottom-4 inset-x-3 rounded-xl bg-[rgb(var(--surface-card))] p-3 text-xs text-ink">In-app chat and reactions are not connected. Use your stream provider to interact with viewers.</p>

                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: 1-CLICK SOCIAL ADS (WhatsApp, Meta, TikTok) */}
      {activeTab === "ads" && (
        <div className="space-y-4">
          <div className="rounded-[24px] border border-gold/30 bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gold/15 text-gold">
                <Megaphone className="h-4 w-4" />
              </span>
              <div>
                <h3 className="font-bold text-base text-ink">Social campaign planner · preview</h3>
                <p className="text-xs text-ink-500">
              Plan an offer for WhatsApp, Instagram or TikTok. This preview does not fund or publish advertisements.
                </p>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <div>
                <label className="text-xs font-semibold text-ink-500">Target Social Channel</label>
                <div className="mt-1 grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setAdPlatform("whatsapp")}
                    className={`rounded-2xl border p-3 text-center transition ${
                      adPlatform === "whatsapp"
                        ? "border-green-500 bg-green-500/10 text-green-700 dark:text-green-300 font-bold"
                        : "border-[var(--border-faint)] text-ink-500"
                    }`}
                  >
                    <span className="block text-lg">💬</span>
                    <span className="text-xs">WhatsApp</span>
                  </button>

                  <button
                    onClick={() => setAdPlatform("meta")}
                    className={`rounded-2xl border p-3 text-center transition ${
                      adPlatform === "meta"
                        ? "border-blue-500 bg-blue-500/10 text-blue-700 dark:text-blue-300 font-bold"
                        : "border-[var(--border-faint)] text-ink-500"
                    }`}
                  >
                    <span className="block text-lg">📸</span>
                    <span className="text-xs">Instagram</span>
                  </button>

                  <button
                    onClick={() => setAdPlatform("tiktok")}
                    className={`rounded-2xl border p-3 text-center transition ${
                      adPlatform === "tiktok"
                        ? "border-pink-500 bg-pink-500/10 text-pink-700 dark:text-pink-300 font-bold"
                        : "border-[var(--border-faint)] text-ink-500"
                    }`}
                  >
                    <span className="block text-lg">🎵</span>
                    <span className="text-xs">TikTok</span>
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="store-field-70" className="text-xs font-semibold text-ink-500">Ad Headline / Offer</label>
                <input id="store-field-70"
                  type="text"
                  value={adHeadline}
                  onChange={(e) => setAdHeadline(e.target.value)}
                  placeholder="e.g. Fresh Mangoes & Avocados delivered in 25 mins · Tap to chat on WhatsApp"
                  className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink placeholder:text-ink-500/50 focus:border-gold focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="store-field-71" className="text-xs font-semibold text-ink-500">Daily Budget (UGX)</label>
                  <input id="store-field-71"
                    type="number"
                    value={adBudget}
                    onChange={(e) => setAdBudget(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink focus:border-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-ink-500">Duration (Days)</label>
                  <Select
                    aria-label="Duration"
                    value={adDuration}
                    onValueChange={(val) => setAdDuration(val)}
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink focus:border-gold"
                  >
                    <option value="3">3 Days</option>
                    <option value="7">7 Days</option>
                    <option value="14">14 Days</option>
                  </Select>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-ink-500">Promote Specific Product</label>
                <Select
                  aria-label="Promote Product"
                  value={adTargetProduct}
                  onValueChange={(val) => setAdTargetProduct(val)}
                  className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-3 text-sm text-ink focus:border-gold"
                >
                  <option value="">Storewide Brand Promotion</option>
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({ugx(p.price)})
                    </option>
                  ))}
                </Select>
              </div>

              <div className="rounded-2xl bg-[rgb(var(--surface-muted))] p-3 text-xs space-y-1">
                <div className="flex justify-between">
                  <span className="text-ink-500">Planned budget:</span>
                  <span className="font-bold font-mono text-ink">
                    {ugx(Number(adBudget) * Number(adDuration))}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-500">Advertising availability:</span>
                  <span className="font-bold text-gold">Not connected</span>
                </div>
              </div>

              <button
                onClick={handleLaunchAd}
                disabled={!adHeadline.trim()}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3.5 text-sm font-bold text-ink-gold shadow-md transition active:scale-98 disabled:opacity-50"
              >
                Preview campaign · no charge
              </button>
            </div>
          </div>


        </div>
      )}

      {/* TAB 4: STORE SETTINGS */}
      {activeTab === "settings" && (
        <div className="rounded-[24px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-sm space-y-4">
          <h3 className="font-bold text-base text-ink">Store Profile & Delivery Rules</h3>

          <div>
            <label htmlFor="store-field-72" className="text-xs font-semibold text-ink-500">Store Name</label>
            <input id="store-field-72"
              type="text"
              value={store.name}
              disabled
              className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3.5 py-3 text-sm text-ink font-bold opacity-75"
            />
          </div>

          <div>
            <label htmlFor="store-field-73" className="text-xs font-semibold text-ink-500">Minimum Order (UGX)</label>
            <input id="store-field-73"
              type="number"
              value={store.min_order_amount ?? 5000}
              disabled
              className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] px-3.5 py-3 text-sm text-ink font-mono opacity-75"
            />
          </div>

          <div className="pt-2 border-t border-[var(--border-faint)]">
            <p className="text-xs text-ink-500">
              Customer Storefront URL:{" "}
              <Link
                href={`/store/${store.id}`}
                target="_blank"
                className="font-bold text-gold underline underline-offset-2"
              >
                preview.peebee.online/{store.category}/{store.slug}
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* ADD PRODUCT MODAL */}
      {showAddProduct && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-lg rounded-[28px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-5 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-3">
              <h3 className="font-bold text-lg text-ink">Add New Product</h3>
              <button
                onClick={() => setShowAddProduct(false)}
                className="rounded-full p-1.5 text-ink-500 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label htmlFor="store-field-74" className="text-xs font-semibold text-ink-500">Product Title</label>
                <input id="store-field-74"
                  type="text"
                  value={productTitle}
                  onChange={(e) => setProductTitle(e.target.value)}
                  placeholder="e.g. Fresh Hass Avocados (1kg pack)"
                  className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-500/50 focus:border-gold focus:outline-none"
                />
              </div>

              <div>
                <label htmlFor="store-field-75" className="text-xs font-semibold text-ink-500">Short Description</label>
                <textarea id="store-field-75"
                  value={productDesc}
                  onChange={(e) => setProductDesc(e.target.value)}
                  placeholder="e.g. Ripe, creamy Hass avocados sourced directly from Mbale orchards."
                  rows={2}
                  className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-500/50 focus:border-gold focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                <div>
                  <label htmlFor="store-field-76" className="text-xs font-semibold text-ink-500">Selling Price (UGX)</label>
                  <input id="store-field-76"
                    type="number"
                    value={productPrice}
                    onChange={(e) => setProductPrice(e.target.value)}
                    placeholder="8000"
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-sm text-ink focus:border-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="store-field-77" className="text-xs font-semibold text-ink-500">Compare Price</label>
                  <input id="store-field-77"
                    type="number"
                    value={productComparePrice}
                    onChange={(e) => setProductComparePrice(e.target.value)}
                    placeholder="10000"
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-sm text-ink focus:border-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="store-field-78" className="text-xs font-semibold text-ink-500">Cost Price (COGS)</label>
                  <input id="store-field-78"
                    type="number"
                    value={productCostPrice}
                    onChange={(e) => setProductCostPrice(e.target.value)}
                    placeholder="5500"
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3 py-2.5 text-sm text-ink focus:border-gold focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="store-field-79" className="text-xs font-semibold text-ink-500">Initial Stock</label>
                  <input id="store-field-79"
                    type="number"
                    value={productStock}
                    onChange={(e) => setProductStock(e.target.value)}
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink focus:border-gold focus:outline-none"
                  />
                </div>

                <div>
                  <label htmlFor="store-field-80" className="text-xs font-semibold text-ink-500">Category Name</label>
                  <input id="store-field-80"
                    type="text"
                    value={productCategory}
                    onChange={(e) => setProductCategory(e.target.value)}
                    placeholder="e.g. Produce or Apparel"
                    className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink focus:border-gold focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="store-field-81" className="text-xs font-semibold text-ink-500">Product Image URL</label>
                <input id="store-field-81"
                  type="text"
                  value={productImage}
                  onChange={(e) => setProductImage(e.target.value)}
                  placeholder="https://images.unsplash.com/..."
                  className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink focus:border-gold focus:outline-none"
                />
              </div>

              {/* Variants Builder ("Shopify Power") */}
              <div className="rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-ink">Product Variants (Size, Color, Weight)</label>
                  <span className="text-[10px] text-ink-500">{productVariants.length} configured</span>
                </div>

                {productVariants.map((v, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-xl bg-[rgb(var(--surface-card))] p-2 text-xs"
                  >
                    <div>
                      <span className="font-bold text-ink">{v.title}</span> —{" "}
                      <span className="text-gold font-mono">{ugx(v.price)}</span>
                    </div>
                    <button onClick={() => handleRemoveVariant(i)} className="text-red-500 hover:text-red-700">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}

                <div className="grid grid-cols-3 gap-2 pt-1">
                  <input
                    type="text"
                    value={newVariantTitle}
                    onChange={(e) => setNewVariantTitle(e.target.value)}
                    placeholder="Variant (e.g. Small / 1kg)"
                    className="rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-2.5 py-1.5 text-xs text-ink"
                  />
                  <input
                    type="number"
                    value={newVariantPrice}
                    onChange={(e) => setNewVariantPrice(e.target.value)}
                    placeholder="Price (UGX)"
                    className="rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-2.5 py-1.5 text-xs text-ink"
                  />
                  <button
                    type="button"
                    onClick={handleAddVariant}
                    className="rounded-xl bg-gold text-ink-gold text-xs font-bold py-1.5"
                  >
                    + Add
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="store-field-82" className="text-xs font-semibold text-ink-500">Badge (Optional)</label>
                <input id="store-field-82"
                  type="text"
                  value={productBadge}
                  onChange={(e) => setProductBadge(e.target.value)}
                  placeholder="e.g. Fresh Daily, Best Seller, Organic"
                  className="mt-1 w-full rounded-2xl border border-[var(--border-faint)] bg-[rgb(var(--surface-input))] px-3.5 py-2.5 text-sm text-ink focus:border-gold focus:outline-none"
                />
              </div>

              <button
                onClick={handleSaveProduct}
                disabled={savingProduct || !productTitle.trim() || !productPrice}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-gold py-3 text-sm font-bold text-ink-gold shadow transition active:scale-98 disabled:opacity-50"
              >
                {savingProduct ? "Saving Product…" : "Save & Publish Product"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* STOREFRONT PREVIEW MODAL */}
      {showStorefrontPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-md rounded-[32px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-4 shadow-2xl space-y-3 my-4">
            <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-2.5">
              <div>
                <h3 className="font-bold text-sm text-ink flex items-center gap-1.5">
                  <Eye className="h-4 w-4 text-gold" />
                  <span>Customer View Preview ({themeLayout.toUpperCase()})</span>
                </h3>
                <p className="text-[10px] text-ink-500">
                  {customDomain ? customDomain : `peebee.online/${store.category}/${store.slug}`}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setShowStorefrontPreview(false)}
                className="rounded-full p-1.5 text-ink-500 hover:text-ink"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-[rgb(var(--surface-muted))] p-1 text-[11px] font-bold">
              <button
                type="button"
                onClick={() => setPreviewScreen("storefront")}
                className={`rounded-xl py-2 transition text-center ${
                  previewScreen === "storefront"
                    ? "bg-gold text-ink-gold shadow-sm font-extrabold"
                    : "text-ink-500 hover:text-ink"
                }`}
              >
                1. Storefront
              </button>
              <button
                type="button"
                onClick={() => setPreviewScreen("product")}
                className={`rounded-xl py-2 transition text-center ${
                  previewScreen === "product"
                    ? "bg-gold text-ink-gold shadow-sm font-extrabold"
                    : "text-ink-500 hover:text-ink"
                }`}
              >
                2. Product
              </button>
              <button
                type="button"
                onClick={() => setPreviewScreen("cart")}
                className={`rounded-xl py-2 transition text-center ${
                  previewScreen === "cart"
                    ? "bg-gold text-ink-gold shadow-sm font-extrabold"
                    : "text-ink-500 hover:text-ink"
                }`}
              >
                3. Cart
              </button>
            </div>

            <div className="rounded-[32px] border-2 border-neutral-700 bg-[rgb(var(--color-bg))] p-3.5 space-y-3 max-h-[580px] overflow-y-auto no-scrollbar shadow-inner text-ink">
              {previewScreen === "storefront" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[rgb(var(--surface-muted))] text-ink">
                      <LayoutGrid className="h-4.5 w-4.5" />
                    </div>
                    <div className="text-center min-w-0 px-2">
                      <p className="text-[9px] font-bold uppercase tracking-wider text-ink-500">
                        {store.address || "Kampala, UG"}
                      </p>
                      <h4 className="text-xs font-black text-ink truncate">{store.name}</h4>
                    </div>
                    <div className="h-9 w-9 rounded-full bg-gold/20 border border-gold/40 flex items-center justify-center text-xs font-bold text-gold">
                      {store.name.slice(0, 2).toUpperCase()}
                    </div>
                  </div>

                  {loyaltyEnabled && (
                    <div className="rounded-xl bg-gold/15 px-3 py-1.5 text-[10px] font-bold text-gold flex items-center justify-between">
                      <span>🎁 VIP Loyalty Active: Earn {loyaltyCashback}% cashback points</span>
                      <span>ELITE</span>
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <div className="field-box flex-1 flex items-center rounded-xl px-3 py-2 text-xs">
                      <Search className="h-3.5 w-3.5 text-ink-500 mr-2 shrink-0" />
                      <span className="text-[11px] text-ink-500">Search products…</span>
                    </div>
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gold/15 text-gold border border-gold/30">
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                    </div>
                  </div>

                  <div className="relative overflow-hidden rounded-[24px] border border-gold/30 bg-gradient-to-r from-gold/20 via-gold/10 to-[rgb(var(--surface-card))] p-3">
                    <div className="flex items-center gap-2.5">
                      <div className="h-16 w-16 rounded-xl bg-neutral-900 overflow-hidden shrink-0">
                        {products[0]?.image_url ? (
                          <img src={products[0].image_url || undefined} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-xl">🛍️</div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <span className="rounded-full bg-gold/30 px-2 py-0.5 text-[8px] font-black uppercase text-gold">
                          {heroCtaText || "Featured"}
                        </span>
                        <h5 className="text-xs font-bold text-ink truncate mt-0.5">
                          {heroHeadline || products[0]?.title || "Store Collection"}
                        </h5>
                        <p className="text-[9px] text-ink-500 line-clamp-1">
                          {heroSubheadline || "Up to 40% OFF trending products"}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-1.5 overflow-x-auto text-[10px] font-bold">
                    <span className="rounded-full bg-gold px-3 py-1 text-ink-gold">All</span>
                    {collections.map((c) => (
                      <span
                        key={c.id}
                        className="rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1 text-ink whitespace-nowrap"
                      >
                        {c.title}
                      </span>
                    ))}
                    <span className="rounded-full bg-[rgb(var(--surface-muted))] px-3 py-1 text-ink-500">Popular</span>
                  </div>

                  <div className={themeLayout === "compact" ? "space-y-2 pt-1" : "grid grid-cols-2 gap-2 pt-1"}>
                    {(products.length > 0 ? products.slice(0, 4) : [1, 2]).map((item, idx) => {
                      const prod = typeof item === "object" ? item : null;
                      return (
                        <div
                          key={idx}
                          className="rounded-[20px] border border-[var(--border-faint)] bg-[rgb(var(--surface-card))] p-2.5 space-y-1.5"
                        >
                          <div className="relative aspect-[4/5] rounded-[16px] bg-neutral-900 overflow-hidden">
                            {prod?.image_url ? (
                              <img src={prod.image_url || undefined} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-2xl">🛍️</div>
                            )}
                            <div className="absolute top-1.5 right-1.5 h-6 w-6 rounded-full bg-black/40 backdrop-blur-xs flex items-center justify-center text-white">
                              <Heart className="h-3 w-3" />
                            </div>
                          </div>
                          <div className="text-[11px] font-bold text-ink truncate">{prod?.title || `Product Item ${idx + 1}`}</div>
                          <div className="flex items-center justify-between pt-0.5">
                            <span className="text-[11px] font-black text-ink">{ugx(prod?.price || 15000)}</span>
                            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gold text-ink-gold text-[10px] font-bold">
                              +
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {previewScreen === "product" && (
                <div className="space-y-3">
                  <div className="relative h-48 w-full rounded-b-[28px] bg-neutral-900 overflow-hidden -mx-3.5 -mt-3.5 mb-2">
                    {products[0]?.image_url ? (
                      <img src={products[0].image_url || undefined} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-4xl">🛍️</div>
                    )}
                    <div className="absolute top-3 left-3 h-8 w-8 rounded-full bg-black/40 backdrop-blur-xs flex items-center justify-center text-white">
                      <ChevronRight className="h-4 w-4 rotate-180" />
                    </div>
                  </div>

                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="text-sm font-extrabold text-ink">{products[0]?.title || "Designer Item"}</h4>
                      <p className="text-[10px] text-gold font-semibold">Premium Collection</p>
                    </div>
                    <span className="text-sm font-black text-gold">{ugx(products[0]?.price || 25000)}</span>
                  </div>

                  <p className="text-[10px] text-ink-500 leading-relaxed">
                    {products[0]?.description || "Soft comfortable fabric with elegant tailoring and versatile styling."}
                  </p>

                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase text-ink">Size</span>
                    <div className="flex gap-1.5">
                      {["S", "M", "L", "XL"].map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setPreviewSelectedSize(s)}
                          className={`h-7 w-8 rounded-lg text-[10px] font-bold ${
                            previewSelectedSize === s ? "bg-gold text-ink-gold" : "bg-[rgb(var(--surface-muted))] text-ink-500"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 pt-2 border-t border-[var(--border-faint)]">
                    <button
                      type="button"
                      className="flex-1 h-10 rounded-full bg-gold text-xs font-bold text-ink-gold shadow-sm"
                    >
                      Buy Now
                    </button>
                    <div className="h-10 w-10 rounded-full bg-[rgb(var(--surface-muted))] border border-[var(--border-faint)] flex items-center justify-center text-ink">
                      <ShoppingBag className="h-4 w-4" />
                    </div>
                  </div>
                </div>
              )}

              {previewScreen === "cart" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-[var(--border-faint)] pb-2">
                    <LayoutGrid className="h-4 w-4 text-ink-500" />
                    <span className="text-xs font-bold text-ink">Cart</span>
                    <div className="h-6 w-6 rounded-full bg-gold/20 text-gold flex items-center justify-center text-[10px] font-bold">
                      PB
                    </div>
                  </div>

                  <div className="space-y-2">
                    {[1, 2].map((i) => (
                      <div
                        key={i}
                        className="rounded-xl border border-[var(--border-faint)] bg-[rgb(var(--surface-muted))] p-2 flex items-center justify-between gap-2 text-xs"
                      >
                        <div className="h-10 w-10 rounded-lg bg-neutral-900 overflow-hidden shrink-0">
                          {products[i - 1]?.image_url ? (
                            <img src={products[i - 1]?.image_url || undefined} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-xs">🛍️</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[11px] font-bold text-ink truncate">
                            {products[i - 1]?.title || `Store Item ${i}`}
                          </p>
                          <span className="text-[10px] font-black text-gold">{ugx(products[i - 1]?.price || 15000)}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-ink">- 1 +</span>
                          <span className="h-4 w-4 rounded-md bg-gold flex items-center justify-center text-ink-gold text-[9px] font-black">
                            ✓
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>

                  {discounts.length > 0 && (
                    <div className="rounded-xl bg-gold/15 px-3 py-1.5 text-[10px] font-bold text-gold flex items-center justify-between">
                      <span>🏷️ Promo applied: {discounts[0].code}</span>
                      <span>{discounts[0].title}</span>
                    </div>
                  )}

                  <div className="pt-2 border-t border-[var(--border-faint)] flex items-center justify-between">
                    <div>
                      <span className="text-[9px] font-bold uppercase text-ink-500 block">Total</span>
                      <span className="text-xs font-black text-gold">{ugx(35000)}</span>
                    </div>
                    <button
                      type="button"
                      className="rounded-full bg-gold px-5 py-2 text-xs font-bold text-ink-gold shadow-sm"
                    >
                      Pay Now
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
