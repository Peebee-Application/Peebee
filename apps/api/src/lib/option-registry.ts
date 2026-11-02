/**
 * The option registry: every design fork in the store, digital-product, LMS and services modules.
 *
 * Policy: build all the options, ship the recommended one as the default, and let admin switch to the others.
 * Each entry is the single source for four things — the stored default, the validation of an admin change, what the
 * admin page renders, and which options are actually selectable right now.
 *
 * - `recommended` marks the default choice (shown with a badge in admin).
 * - `built: false` means the code for that option is not shipped yet; admin sees it but cannot select it, and the
 *   running code falls back to the first built option, so a half-built path can never be switched on.
 * - `requires` lists the migration an option needs. Migrations are applied by hand, so an option whose table or column is
 *   missing is shown as "migration pending" and cannot be chosen until the migration lands.
 *
 * Pure data and helpers only (no database access) so it can be imported anywhere, including settings defaults.
 */

import { SUPPORT_APPS } from "@peebee/shared";

export type OptionModule = "storefront" | "portal" | "plans" | "digital" | "lms" | "services" | "platform" | "support";

export type OptionRequirement = {
  tables?: string[];
  columns?: Array<[table: string, column: string]>;
  /** The migration file to apply, shown to admin. */
  migration?: string;
  /** Needs a real SMS provider (not the simulator) with its credentials set. */
  sms?: boolean;
  /** Needs the private file storage (R2) to be connected. */
  r2?: boolean;
  /** Needs an email provider to be connected. */
  email?: boolean;
};

export type OptionChoice = {
  value: string;
  label: string;
  hint?: string;
  recommended?: boolean;
  /** False until the code for this option ships. */
  built: boolean;
  requires?: OptionRequirement;
};

type Base = { key: string; module: OptionModule; label: string; description: string };

export type EnumSetting = Base & { kind: "enum"; options: OptionChoice[]; default: string };
export type MultiSetting = Base & { kind: "multi"; options: OptionChoice[]; default: string[]; min?: number };
export type IntSetting = Base & { kind: "int"; default: number; min: number; max: number; unit?: string };
export type BoolSetting = Base & { kind: "bool"; default: boolean };
export type ListSetting = Base & { kind: "list"; default: string[]; maxItems: number; itemPattern: string; itemHint: string };
export type SettingDef = EnumSetting | MultiSetting | IntSetting | BoolSetting | ListSetting;

export type OptionValue = string | string[] | number | boolean;

const opt = (value: string, label: string, built: boolean, extra: Partial<OptionChoice> = {}): OptionChoice => ({ value, label, built, ...extra });

const ROLES: OptionChoice[] = [
  opt("owner", "Owner", true),
  opt("manager", "Manager", true),
  opt("finance", "Finance", true),
  opt("cashier", "Cashier", true),
];

export const OPTION_SETTINGS: SettingDef[] = [
  // ------------------------------------------------------------------ Storefront
  {
    key: "storefront_checkout_mode", module: "storefront", kind: "enum", label: "Web storefront checkout",
    description: "How a shopper on [store].peebee.online completes an order.",
    default: "handoff_to_app",
    options: [
      opt("handoff_to_app", "Continue in the Peebee app", true, { recommended: true, hint: "The web store builds the bag and hands over to the app, where payment and tracking live." }),
      opt("inline_web_checkout", "Pay on the web storefront", false, { hint: "Phone sign-in and mobile-money payment without leaving the web store." }),
      opt("whatsapp_order", "Send the order on WhatsApp", true, { hint: "The bag is sent to the merchant on WhatsApp; they confirm and invoice." }),
    ],
  },
  {
    key: "storefront_domain_mode", module: "storefront", kind: "enum", label: "Store web addresses",
    description: "Which addresses a store can be reached on.",
    default: "subdomain_only",
    options: [
      opt("subdomain_only", "Peebee subdomain only", true, { recommended: true, hint: "[store].peebee.online" }),
      opt("subdomain_plus_verified_custom_domains", "Subdomain and verified custom domains", true, {
        hint: "Merchants can connect their own domain after proving they own it (DNS check).",
        requires: { columns: [["stores", "domain_verified"]], migration: "0137_storefront_hardening.sql" },
      }),
    ],
  },
  {
    key: "storefront_reserved_subdomains", module: "storefront", kind: "list", label: "Reserved store names",
    description: "Names no store may take as its web address (lookalikes of platform pages).",
    default: ["www", "app", "customer", "rider", "merchant", "admin", "api", "food", "gas", "pharmacy", "partner", "sales", "work", "learn", "tv", "preview", "login", "signin", "secure", "pay", "payment", "payments", "wallet", "support", "help", "mail", "email", "status", "docs", "blog", "cdn", "static", "assets", "auth", "account", "billing", "staging", "dev", "test", "peebee", "stores", "portal"],
    maxItems: 200, itemPattern: "^[a-z0-9-]{1,40}$", itemHint: "lowercase letters, numbers and hyphens",
  },
  {
    key: "storefront_promo_visibility", module: "storefront", kind: "enum", label: "Promo codes shown on the web store",
    description: "Which discounts are listed publicly. Private codes always work when typed in.",
    default: "automatic_only_public",
    options: [
      opt("automatic_only_public", "Automatic offers only", true, { recommended: true }),
      opt("flagged_public", "Automatic offers and codes the merchant marks public", true, { requires: { columns: [["store_discounts", "is_public"]], migration: "0137_storefront_hardening.sql" } }),
      opt("none_public", "Nothing listed", true),
    ],
  },
  {
    key: "storefront_b2b_inquiry_protection", module: "storefront", kind: "enum", label: "Wholesale inquiry protection",
    description: "How the public wholesale form is protected from spam.",
    default: "phone_otp",
    options: [
      opt("rate_limit_only", "Rate limit", true),
      opt("phone_otp", "Rate limit and phone code", true, { recommended: true, requires: { sms: true } }),
      opt("captcha", "Rate limit and captcha", false, { hint: "Needs a captcha account (e.g. Cloudflare Turnstile) to be connected first." }),
    ],
  },
  {
    key: "storefront_render_mode", module: "storefront", kind: "enum", label: "Storefront rendering",
    description: "Server-rendered pages give search engines and link previews real content.",
    default: "server_rendered_seo",
    options: [
      opt("server_rendered_seo", "Server-rendered with SEO tags", true, { recommended: true }),
      opt("client_only", "Browser-rendered only", true),
    ],
  },
  {
    key: "storefront_stale_status_behavior", module: "storefront", kind: "enum", label: "Paused or suspended stores",
    description: "What visitors see at the address of a store that is not live.",
    default: "show_suspended_page",
    options: [
      opt("show_suspended_page", "A friendly 'store unavailable' page", true, { recommended: true }),
      opt("not_found", "Not found (404)", true),
    ],
  },
  {
    key: "loyalty_credit_trigger", module: "storefront", kind: "enum", label: "When loyalty cashback is credited",
    description: "Cashback is only credited once the chosen event happens, and reversed on a refund.",
    default: "on_delivery_or_paid",
    options: [
      opt("on_delivery_or_paid", "Once the order is delivered and settled", true, { recommended: true, requires: { tables: ["store_loyalty_events"], migration: "0137_storefront_hardening.sql" } }),
      opt("on_payment_confirmed", "Once payment is confirmed", true, { requires: { tables: ["store_loyalty_events"], migration: "0137_storefront_hardening.sql" } }),
      opt("on_order_placed", "As soon as the order is placed", true, { hint: "The previous behaviour. Not recommended: cancelled orders keep the points." }),
    ],
  },
  {
    key: "storefront_pixels_enabled", module: "storefront", kind: "bool", label: "Ad pixels on storefronts",
    description: "Allow merchants' Meta and TikTok pixel IDs to be loaded on their web store.", default: true,
  },

  // ------------------------------------------------------------------ Merchant portal
  {
    key: "merchant_portal_enabled", module: "portal", kind: "bool", label: "Merchant sign-up website",
    description: "The website at stores.peebee.online where businesses register as merchants. Off hides the sign-up pages; existing merchants are not affected.",
    default: true,
  },
  {
    key: "merchant_portal_features", module: "portal", kind: "multi", label: "What a new merchant can choose to switch on",
    description: "Every merchant gets a merchant account. These are the extras the sign-up website offers.",
    default: ["app_listing", "web_store"], min: 0,
    options: [
      opt("app_listing", "List products in the Peebee app", true, { recommended: true, requires: { columns: [["stores", "listed_in_app"]], migration: "0141_merchant_portal.sql" } }),
      opt("web_store", "A web store at [name].peebee.online", true, { recommended: true, requires: { columns: [["stores", "web_store_enabled"]], migration: "0141_merchant_portal.sql" } }),
    ],
  },
  {
    key: "merchant_portal_account_creation", module: "portal", kind: "enum", label: "Creating the account on the website",
    description: "Whether someone with no Peebee account can create one while signing up as a merchant.",
    default: "register_here",
    options: [
      opt("register_here", "Create the account on the website", true, { recommended: true }),
      opt("sign_in_only", "Only people who already have a Peebee account", true, { hint: "They sign in with the account from the app." }),
    ],
  },
  {
    key: "merchant_portal_phone_check", module: "portal", kind: "enum", label: "Checking the phone number at sign-up",
    description: "Proves the person owns the number they register with.",
    default: "phone_code",
    options: [
      opt("phone_code", "Text a code to the phone", true, { recommended: true, requires: { sms: true } }),
      opt("none", "No phone check", true),
    ],
  },
  {
    key: "merchant_portal_store_activation", module: "portal", kind: "enum", label: "When a new store goes live",
    description: "A store made on the website is created hidden and published when admin approves the merchant, or published straight away.",
    default: "after_admin_approval",
    options: [
      opt("after_admin_approval", "After admin approves the merchant", true, { recommended: true }),
      opt("immediately", "Straight away", true, { hint: "The store is public before any verification." }),
    ],
  },

  // ------------------------------------------------------------------ Merchant plans
  {
    key: "merchant_plan_legacy_access", module: "plans", kind: "enum", label: "Stores that existed before plans",
    description: "Stores registered before plans were enforced. Prices and the free launch period are set under Marketplace settings.",
    default: "keep_access",
    options: [
      opt("keep_access", "Keep their current access", true, { recommended: true, requires: { columns: [["stores", "plan_legacy"]], migration: "0143_merchant_plans.sql" }, hint: "Nobody loses features. New stores follow the plan they chose." }),
      opt("follow_plan", "Follow the plan they chose, like new stores", true, { requires: { columns: [["stores", "plan_legacy"]], migration: "0143_merchant_plans.sql" } }),
    ],
  },
  {
    key: "merchant_plan_payment", module: "plans", kind: "enum", label: "How a merchant pays for Pro or Elite",
    description: "Where the money for an upgrade comes from.",
    default: "wallet",
    options: [
      opt("wallet", "Their Peebee wallet", true, { recommended: true }),
      opt("mobile_money", "Mobile money prompt", false, { hint: "Needs the payment-in-progress flow for plans; not built yet." }),
    ],
  },
  { key: "merchant_pos_manual_prices", module: "plans", kind: "bool", label: "Allow manual POS prices", description: "Permit POS operators to override catalog unit prices. Stock ownership and availability checks always apply.", default: false },
  { key: "merchant_plan_free_max_products", module: "plans", kind: "int", label: "Products on the Merchant plan", description: "Upper limit for a store with no active Pro or Elite plan.", default: 20, min: 0, max: 5000 },
  { key: "merchant_plan_free_max_collections", module: "plans", kind: "int", label: "Collections on the Merchant plan", description: "Upper limit for a store with no active Pro or Elite plan.", default: 1, min: 0, max: 1000 },
  { key: "merchant_plan_free_max_discounts", module: "plans", kind: "int", label: "Offers on the Merchant plan", description: "Upper limit for a store with no active Pro or Elite plan.", default: 1, min: 0, max: 1000 },
  { key: "merchant_plan_warn_days", module: "plans", kind: "int", label: "Warn before a plan ends", description: "Days before expiry that the merchant app starts showing a renewal reminder.", default: 7, min: 0, max: 60, unit: "days" },

  // ------------------------------------------------------------------ Digital products
  {
    key: "digital_storage_backend", module: "digital", kind: "enum", label: "Where digital files are stored",
    description: "Files are only ever reached through a purchase token, never a public link.",
    default: "r2_private_signed",
    options: [
      opt("r2_private_signed", "Private storage with short-lived links", true, { recommended: true, requires: { r2: true, columns: [["store_digital_products", "file_key"]], migration: "0138_digital_fulfillment.sql" } }),
      opt("worker_stream_proxy", "Streamed through Peebee", true, { requires: { columns: [["store_digital_products", "file_key"]], migration: "0138_digital_fulfillment.sql" } }),
      opt("external_url_via_redirect", "Merchant-hosted file behind the token", true, { hint: "The previous behaviour: the token gates a redirect to the merchant's own URL." }),
    ],
  },
  {
    key: "digital_delivery_channels", module: "digital", kind: "multi", label: "How buyers receive digital goods",
    description: "Channels used after a successful purchase.",
    default: ["on_screen", "sms_link"], min: 1,
    options: [
      opt("on_screen", "On the confirmation screen", true, { recommended: true }),
      opt("sms_link", "SMS with a one-tap link", true, { recommended: true, requires: { sms: true } }),
      opt("whatsapp_link", "WhatsApp message", false),
      opt("email_link", "Email", false),
    ],
  },
  {
    key: "digital_proxy_trusted_hosts", module: "digital", kind: "list", label: "Trusted download hosts",
    description: "Exact hostnames Peebee may fetch files from. Only add providers you trust, including their DNS. Empty blocks external proxy downloads; private uploads still work. Redirect destinations must also be listed. No wildcards or IP addresses.",
    default: [], maxItems: 50,
    itemPattern: "^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$",
    itemHint: "an exact trusted hostname, such as files.example.com",
  },
  { key: "digital_default_max_downloads", module: "digital", kind: "int", label: "Default download limit", description: "Downloads per purchase when the merchant does not set one. 0 means unlimited.", default: 5, min: 0, max: 1000 },
  { key: "digital_default_expiry_days", module: "digital", kind: "int", label: "Default link lifetime", description: "Days a purchase link works. 0 means it never expires.", default: 30, min: 0, max: 3650, unit: "days" },
  {
    key: "digital_license_exhausted_action", module: "digital", kind: "enum", label: "When licence keys run out",
    description: "What happens to a sale when the key pool is empty.",
    default: "block_sale",
    options: [
      opt("block_sale", "Stop the sale", true, { recommended: true, requires: { tables: ["store_license_keys"], migration: "0138_digital_fulfillment.sql" } }),
      opt("allow_backorder_manual_fulfil", "Take the order and let the merchant fulfil it", true, { requires: { tables: ["store_license_keys"], migration: "0138_digital_fulfillment.sql" } }),
      opt("auto_hide_product", "Hide the product", true, { requires: { tables: ["store_license_keys"], migration: "0138_digital_fulfillment.sql" } }),
    ],
  },
  {
    key: "digital_license_reveal", module: "digital", kind: "enum", label: "Where a licence key is shown",
    description: "Keys are secrets; choose how they reach the buyer.",
    default: "after_phone_check",
    options: [
      opt("after_phone_check", "On the download page after the buyer confirms their phone", true, { recommended: true, requires: { sms: true } }),
      opt("on_token_page", "On the download page for anyone with the link", true),
      opt("sms_only", "By SMS only", true, { requires: { sms: true } }),
    ],
  },
  { key: "digital_commission_percent", module: "digital", kind: "int", label: "Platform share of digital sales", description: "Percent Peebee keeps from each digital sale; the rest goes to the merchant.", default: 5, min: 0, max: 60, unit: "%" },
  { key: "digital_max_file_mb", module: "digital", kind: "int", label: "Largest file a merchant can upload", description: "Per file.", default: 200, min: 1, max: 2000, unit: "MB" },
  { key: "digital_allow_executables", module: "digital", kind: "bool", label: "Allow program files", description: "Installers and scripts (.exe, .msi, .sh, …) are blocked unless this is on, because a store can sell them to anyone.", default: false },
  { key: "digital_refund_revokes_access", module: "digital", kind: "bool", label: "Refunds revoke access", description: "A refunded purchase stops working immediately.", default: true },
  { key: "digital_max_products", module: "digital", kind: "int", label: "Digital products per store", description: "Upper limit per store.", default: 200, min: 1, max: 5000 },
  {
    key: "digital_file_scan", module: "digital", kind: "enum", label: "Uploaded file checks",
    description: "What is checked when a merchant adds a file.",
    default: "size_and_mime_check",
    options: [
      opt("size_and_mime_check", "Size and file type", true, { recommended: true }),
      opt("size_mime_and_scan_hook", "Size, type and a malware scan", false, { hint: "Needs a malware-scanning service to be connected first." }),
      opt("off", "No checks", true),
    ],
  },

  // ------------------------------------------------------------------ LMS / Peebee Learn
  {
    key: "lms_learn_sync_mode", module: "lms", kind: "enum", label: "Peebee Learn listing",
    description: "How a store's courses appear in the Peebee Learn catalogue.",
    default: "two_way_auto",
    options: [
      opt("two_way_auto", "Automatic two-way sync", true, { recommended: true }),
      opt("publish_to_learn_manual", "Merchant publishes to Learn manually", true, { requires: { columns: [["edu_courses", "catalog_listed"]], migration: "0139_lms_hardening.sql" } }),
      opt("store_only", "Store only, not listed in Learn", true, { requires: { columns: [["edu_courses", "catalog_listed"]], migration: "0139_lms_hardening.sql" } }),
    ],
  },
  {
    key: "lms_enrollment_identity", module: "lms", kind: "enum", label: "Student accounts",
    description: "How a student gets an account when a merchant enrols them or they buy a course.",
    default: "phone_account_auto_create_sms_setup",
    options: [
      opt("phone_account_auto_create_sms_setup", "Create the account from their phone and send a setup link", true, { recommended: true, requires: { sms: true } }),
      opt("require_existing_account", "They must already have a Peebee account", true),
      opt("email_invite", "Invite them by email", true, { requires: { email: true } }),
    ],
  },
  {
    key: "lms_payment_path", module: "lms", kind: "enum", label: "How course sales are paid",
    description: "Which payment path course purchases use.",
    default: "learn_payments_commission",
    options: [
      opt("learn_payments_commission", "Peebee Learn payments (Learn commission)", true, { recommended: true }),
      opt("store_checkout_direct", "Store checkout (the digital-sales share)", true),
    ],
  },
  {
    key: "lms_content_protection", module: "lms", kind: "enum", label: "Lesson content protection",
    description: "How lesson videos and files are protected from sharing.",
    default: "signed_urls",
    options: [
      opt("signed_urls", "Approved video hosts and Peebee-hosted lessons (short-lived links)", true, { recommended: true }),
      opt("domain_allowlist_only", "Only approved video hosts", true),
      opt("none", "No protection (free courses)", true),
    ],
  },
  {
    key: "lms_certificates", module: "lms", kind: "enum", label: "Certificates",
    description: "When a certificate is issued.",
    default: "auto_on_completion",
    options: [
      opt("auto_on_completion", "Automatically on completion", true, { recommended: true }),
      opt("manual_issue", "Merchant issues them", true, { requires: { tables: ["edu_certificates"], migration: "0117_learn_pro_completion.sql" } }),
      opt("off", "Off", true),
    ],
  },
  {
    key: "lms_allowed_video_hosts", module: "lms", kind: "list", label: "Approved lesson video hosts",
    description: "Websites a lesson video or file may come from when content protection is on. (The quiz pass mark is set under Peebee Learn.)",
    default: ["youtube.com", "youtu.be", "vimeo.com", "peebee.online", "cloudflarestream.com"], maxItems: 50,
    itemPattern: "^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$", itemHint: "domain names like youtube.com",
  },
  {
    key: "lms_drip_default", module: "lms", kind: "enum", label: "Default lesson release",
    description: "When lessons unlock for a new course.",
    default: "all_at_once",
    options: [
      opt("all_at_once", "All at once", true, { recommended: true }),
      opt("weekly", "One module a week", true, { requires: { tables: ["edu_module_drip"], migration: "0117_learn_pro_completion.sql" } }),
      opt("custom", "Merchant sets a schedule", true, { requires: { tables: ["edu_module_drip"], migration: "0117_learn_pro_completion.sql" } }),
    ],
  },
  { key: "lms_max_courses", module: "lms", kind: "int", label: "Courses per store", description: "Upper limit per store.", default: 50, min: 1, max: 1000 },

  // ------------------------------------------------------------------ Services
  {
    key: "services_online_collection_mode", module: "services", kind: "enum", label: "How online service payments are collected",
    description: "Service money moves on mobile money, cash and bank rails only — never cards.",
    default: "momo_escrow",
    options: [
      opt("momo_escrow", "Mobile money held until the service is done", true, { recommended: true, requires: { tables: ["service_payments"], migration: "0140_services_hardening.sql" } }),
      opt("momo_direct", "Mobile money straight to the provider", true, { requires: { tables: ["service_payments"], migration: "0140_services_hardening.sql" } }),
      opt("deposit_online_balance_at_venue", "Deposit online, balance at the venue", true, { requires: { tables: ["service_payments"], migration: "0140_services_hardening.sql" } }),
      opt("pay_at_venue_only", "Pay at the venue only", true, { hint: "No online collection. Bookings are never marked paid by the customer." }),
    ],
  },
  {
    key: "services_enabled_rails", module: "services", kind: "multi", label: "Payment methods for services",
    description: "Platform-wide methods a business may offer. Cards are not available for services.",
    default: ["momo_mtn", "momo_airtel", "cash_at_venue"], min: 1,
    options: [
      opt("momo_mtn", "MTN Mobile Money", true, { recommended: true }),
      opt("momo_airtel", "Airtel Money", true, { recommended: true }),
      opt("cash_at_venue", "Cash at the venue", true, { recommended: true }),
      opt("bank_wire", "Bank transfer", true),
    ],
  },
  {
    key: "services_booking_confirmation", module: "services", kind: "enum", label: "Confirming bookings",
    description: "Who confirms a customer's booking request.",
    default: "provider_confirms",
    options: [
      opt("provider_confirms", "The provider confirms each booking", true, { recommended: true }),
      opt("auto_confirm", "Confirm automatically", true),
      opt("auto_confirm_when_paid", "Confirm automatically once paid", true, { requires: { tables: ["service_payments"], migration: "0140_services_hardening.sql" } }),
    ],
  },
  {
    key: "services_cancellation_refund_mode", module: "services", kind: "enum", label: "Cancellations and refunds",
    description: "How refunds are decided when a customer cancels.",
    default: "policy_based",
    options: [
      opt("policy_based", "Follow the business's own free-cancellation window", true, { recommended: true, requires: { tables: ["service_payments"], migration: "0140_services_hardening.sql" } }),
      opt("full_refund_until_x_hours", "Full refund until the platform window below", true, { requires: { tables: ["service_payments"], migration: "0140_services_hardening.sql" } }),
      opt("no_refund", "No refunds", true, { requires: { tables: ["service_payments"], migration: "0140_services_hardening.sql" } }),
      opt("manual_review", "Provider decides each time", true, { requires: { tables: ["service_payments"], migration: "0140_services_hardening.sql" } }),
    ],
  },
  { key: "services_cancellation_window_hours", module: "services", kind: "int", label: "Free-cancellation window", description: "Hours before the appointment a customer may cancel for a full refund.", default: 24, min: 0, max: 720, unit: "hours" },
  {
    key: "services_business_approval", module: "services", kind: "enum", label: "Approving new service businesses",
    description: "Whether a new service business goes live straight away.",
    default: "admin_review",
    options: [
      opt("admin_review", "Admin reviews each new business", true, { recommended: true }),
      opt("auto_approve_verified_users", "Live at once for verified accounts", true),
      opt("auto_approve_all", "Live at once for everyone", true),
    ],
  },
  {
    key: "services_booking_verification", module: "services", kind: "enum", label: "Checking public bookings",
    description: "How a public booking request is checked before it is accepted.",
    default: "phone_otp",
    options: [
      opt("phone_otp", "Rate limit and phone code", true, { recommended: true, requires: { sms: true } }),
      opt("rate_limit_only", "Rate limit only", true),
      opt("none", "No checks", true),
    ],
  },
  {
    key: "services_availability_mode", module: "services", kind: "enum", label: "Choosing a time",
    description: "How customers pick when they want the service.",
    default: "free_text_request",
    options: [
      opt("weekly_schedule_with_slots", "Pick from the provider's open slots", true, { recommended: true, requires: { tables: ["service_hours", "service_blackouts"], migration: "0140_services_hardening.sql" } }),
      opt("free_text_request", "Request a date and time, the provider confirms", true),
    ],
  },


  // ------------------------------------------------------------------ Website support chat
  { key: "support_chat_enabled", module: "support", kind: "bool", label: "Website support chat", description: "The live chat on the website. Off keeps the built-in demo replies.", default: true },
  { key: "support_chat_apps", module: "support", kind: "multi", label: "Apps that show Help & support", description: "Where visitors and signed-in users can open the chat: the website and each app's Settings → Help & support.", default: SUPPORT_APPS.map((a) => a.id), options: SUPPORT_APPS.map((a) => opt(a.id, a.label, true)) },
  { key: "support_chat_ai_enabled", module: "support", kind: "bool", label: "AI assistant answers first", description: "Off sends every visitor straight to the queue for a person.", default: true },
  { key: "support_chat_human_enabled", module: "support", kind: "bool", label: "Talk to a person", description: "Lets a visitor ask for the support team. Off hides the button and the AI handles everything.", default: true },
  {
    key: "support_chat_ai_model", module: "support", kind: "enum", label: "AI model for the support assistant",
    description: "A stronger model answers better and handles harder questions, but is slower and has smaller free limits. Each model has its own Google quota.",
    default: "gemini-2.5-flash",
    options: [
      opt("gemini-2.5-flash", "Gemini 2.5 Flash: fast and capable", true, { recommended: true }),
      opt("gemini-2.5-flash-lite", "Gemini 2.5 Flash-Lite: fastest, simplest", true),
      opt("gemini-2.5-pro", "Gemini 2.5 Pro: smartest, slower", true, { hint: "Always reasons before answering, so replies take a few seconds longer." }),
    ],
  },
  { key: "support_chat_ai_reply_tokens", module: "support", kind: "int", label: "Longest AI reply", description: "The most the assistant may write in one reply (a token is about three quarters of a word). A reply that reaches it ends at a full sentence.", default: 800, min: 100, max: 4000, unit: "tokens" },
  { key: "support_chat_ai_thinking_budget", module: "support", kind: "int", label: "AI thinking before it answers", description: "0 answers straight away. More lets the assistant reason first, which helps it connect what someone says to the right Peebee service, but replies take a little longer. The Pro model always thinks at least a little.", default: 256, min: 0, max: 4096, unit: "tokens" },
  { key: "support_chat_ai_context_messages", module: "support", kind: "int", label: "Messages the AI reads", description: "How many of the latest messages the assistant sees when it answers.", default: 12, min: 2, max: 40 },
  { key: "support_chat_max_messages", module: "support", kind: "int", label: "Messages per chat", description: "A visitor cannot send more than this in one chat.", default: 200, min: 10, max: 2000 },
  { key: "support_chat_idle_close_minutes", module: "support", kind: "int", label: "Close idle person chats after", description: "Queued or person-handled chats with no message for this long are closed.", default: 120, min: 5, max: 1440, unit: "minutes" },
  { key: "rate_limit_support_chat_messages_per_minute", module: "support", kind: "int", label: "Chat messages per visitor per minute", description: "Per network address.", default: 20, min: 1, max: 600 },
  { key: "rate_limit_support_chat_starts_per_hour", module: "support", kind: "int", label: "New chats per visitor per hour", description: "Per network address.", default: 10, min: 1, max: 1000 },

  // ------------------------------------------------------------------ Cross-cutting
  { key: "rate_limit_public_booking_per_hour", module: "platform", kind: "int", label: "Public bookings per person per hour", description: "Per phone and per network address.", default: 10, min: 1, max: 1000 },
  { key: "rate_limit_public_inquiry_per_hour", module: "platform", kind: "int", label: "Wholesale inquiries per person per hour", description: "Per phone and per network address.", default: 5, min: 1, max: 1000 },
  { key: "rate_limit_token_download_per_minute", module: "platform", kind: "int", label: "Download link requests per minute", description: "Per link and per network address.", default: 20, min: 1, max: 1000 },
  { key: "member_roles_manage_catalog", module: "platform", kind: "multi", label: "Who can change products and prices", description: "Merchant team roles.", default: ["owner", "manager"], min: 1, options: ROLES },
  { key: "member_roles_manage_store_settings", module: "platform", kind: "multi", label: "Who can change store settings and domain", description: "Merchant team roles.", default: ["owner", "manager"], min: 1, options: ROLES },
  { key: "member_roles_manage_digital", module: "platform", kind: "multi", label: "Who can manage digital products and courses", description: "Merchant team roles.", default: ["owner", "manager"], min: 1, options: ROLES },
  { key: "member_roles_refund_revoke", module: "platform", kind: "multi", label: "Who can revoke access and refund", description: "Merchant team roles.", default: ["owner", "manager", "finance"], min: 1, options: ROLES },
  { key: "member_roles_manage_billing", module: "platform", kind: "multi", label: "Who can change the store plan", description: "Merchant team roles.", default: ["owner"], min: 1, options: ROLES },
  {
    key: "marketplace_demo_catalog", module: "platform", kind: "enum", label: "Demo stores and products",
    description: "Where the built-in demo catalogue may be ordered from. Practice mode never uses this; it runs in the app.",
    default: "sandbox_only",
    options: [
      opt("sandbox_only", "Only while the platform is in sandbox", true, { recommended: true }),
      opt("always", "Always", true),
    ],
  },
];

const BY_KEY = new Map(OPTION_SETTINGS.map((def) => [def.key, def]));

export function getSettingDef(key: string): SettingDef | undefined {
  return BY_KEY.get(key);
}

/** Stored (string) form of a value. */
export function encodeValue(def: SettingDef, value: OptionValue): string {
  if (def.kind === "bool") return value ? "1" : "0";
  if (def.kind === "int") return String(Math.round(Number(value)));
  if (def.kind === "multi" || def.kind === "list") return JSON.stringify(value);
  return String(value);
}

/** Defaults in stored form, merged into the platform settings defaults. */
export const OPTION_DEFAULTS: Record<string, string> = Object.fromEntries(
  OPTION_SETTINGS.map((def) => [def.key, encodeValue(def, def.default)]),
);

/** Read a stored string back into a typed value; anything malformed falls back to the default. */
export function decodeValue(def: SettingDef, raw: string | undefined | null): OptionValue {
  if (raw == null || raw === "") return def.default;
  try {
    switch (def.kind) {
      case "bool":
        return raw !== "0";
      case "int": {
        const n = Number(raw);
        return Number.isFinite(n) ? Math.min(def.max, Math.max(def.min, Math.round(n))) : def.default;
      }
      case "multi":
      case "list": {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) && parsed.every((v) => typeof v === "string") ? parsed : def.default;
      }
      default:
        return raw;
    }
  } catch {
    return def.default;
  }
}

export type Availability = { available: boolean; reason?: "not_built" | "migration_pending" | "sms_provider_pending" | "storage_pending" | "email_pending" };
/** Which database objects exist right now; supplied by the caller (see option-settings.ts). */
export type SchemaProbe = { hasTable(name: string): boolean; hasColumn(table: string, column: string): boolean; smsReady?(): boolean; r2Ready?(): boolean; emailReady?(): boolean };

export function choiceAvailability(choice: OptionChoice, schema: SchemaProbe): Availability {
  if (!choice.built) return { available: false, reason: "not_built" };
  const need = choice.requires;
  if (need?.tables?.some((t) => !schema.hasTable(t))) return { available: false, reason: "migration_pending" };
  if (need?.columns?.some(([t, c]) => !schema.hasColumn(t, c))) return { available: false, reason: "migration_pending" };
  if (need?.sms && !schema.smsReady?.()) return { available: false, reason: "sms_provider_pending" };
  if (need?.r2 && !schema.r2Ready?.()) return { available: false, reason: "storage_pending" };
  if (need?.email && !schema.emailReady?.()) return { available: false, reason: "email_pending" };
  return { available: true };
}

/**
 * The value the running code should act on. A stored choice that is not selectable (never built, or its migration is
 * missing) is replaced by the first selectable option, so the platform keeps working while an option is unavailable.
 */
export function resolveEffective(def: SettingDef, stored: OptionValue, schema: SchemaProbe): OptionValue {
  if (def.kind === "enum") {
    const chosen = def.options.find((o) => o.value === stored);
    if (chosen && choiceAvailability(chosen, schema).available) return chosen.value;
    return def.options.find((o) => choiceAvailability(o, schema).available)?.value ?? def.default;
  }
  if (def.kind === "multi") {
    const list = (Array.isArray(stored) ? stored : []).filter((v) => {
      const choice = def.options.find((o) => o.value === v);
      return choice && choiceAvailability(choice, schema).available;
    });
    if (list.length >= (def.min ?? 0) && list.length > 0) return list;
    const fallback = def.options.filter((o) => choiceAvailability(o, schema).available && (def.default as string[]).includes(o.value)).map((o) => o.value);
    return fallback.length ? fallback : def.options.filter((o) => choiceAvailability(o, schema).available).slice(0, 1).map((o) => o.value);
  }
  return stored;
}

export type ValidationResult = { ok: true; value: OptionValue } | { ok: false; message: string };

/** Validate an admin-supplied value for a setting. Unavailable options are refused, not silently stored. */
export function validateValue(def: SettingDef, input: unknown, schema: SchemaProbe): ValidationResult {
  switch (def.kind) {
    case "bool":
      return typeof input === "boolean" ? { ok: true, value: input } : { ok: false, message: `${def.label}: expected on or off.` };
    case "int":
      if (typeof input !== "number" || !Number.isFinite(input) || !Number.isInteger(input)) return { ok: false, message: `${def.label}: expected a whole number.` };
      if (input < def.min || input > def.max) return { ok: false, message: `${def.label}: must be between ${def.min} and ${def.max}.` };
      return { ok: true, value: input };
    case "enum": {
      const choice = def.options.find((o) => o.value === input);
      if (!choice) return { ok: false, message: `${def.label}: unknown option.` };
      const a = choiceAvailability(choice, schema);
      if (!a.available) return { ok: false, message: `${def.label}: "${choice.label}" is ${a.reason === "not_built" ? "not available yet" : a.reason === "sms_provider_pending" ? "waiting for a real SMS provider (Admin → Marketplace → SMS provider, with its credentials set)" : a.reason === "storage_pending" ? "waiting for the private file storage to be connected" : a.reason === "email_pending" ? "waiting for an email provider to be connected" : `waiting for migration ${choice.requires?.migration ?? ""}`}.` };
      return { ok: true, value: choice.value };
    }
    case "multi": {
      if (!Array.isArray(input) || input.some((v) => typeof v !== "string")) return { ok: false, message: `${def.label}: expected a list.` };
      const unique = [...new Set(input as string[])];
      if (unique.length < (def.min ?? 0)) return { ok: false, message: `${def.label}: choose at least ${def.min}.` };
      for (const value of unique) {
        const choice = def.options.find((o) => o.value === value);
        if (!choice) return { ok: false, message: `${def.label}: unknown option "${value}".` };
        const a = choiceAvailability(choice, schema);
        if (!a.available) return { ok: false, message: `${def.label}: "${choice.label}" is not available yet.` };
      }
      return { ok: true, value: unique };
    }
    case "list": {
      if (!Array.isArray(input) || input.some((v) => typeof v !== "string")) return { ok: false, message: `${def.label}: expected a list.` };
      const pattern = new RegExp(def.itemPattern);
      const cleaned = [...new Set((input as string[]).map((v) => v.trim().toLowerCase()).filter(Boolean))];
      if (cleaned.length > def.maxItems) return { ok: false, message: `${def.label}: at most ${def.maxItems} entries.` };
      const bad = cleaned.find((v) => !pattern.test(v));
      if (bad) return { ok: false, message: `${def.label}: "${bad}" is not valid — use ${def.itemHint}.` };
      return { ok: true, value: cleaned };
    }
  }
}
