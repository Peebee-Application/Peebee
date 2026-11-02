import { primeDemoAccounts, ridersForThisWorld } from "../practice/people.js";
import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { db, executeBatch, requireChangedRow, type DbStatement } from "../db/client.js";
import { postLedgerTransaction } from "../ledger/service.js";
import { creditWallet, debitWallet } from "../wallet/service.js";
import { newId } from "../lib/ids.js";
import { getDeliverySettings, getMarketplaceSettings, getMatchingSettings, getPlatformEnvironment } from "../lib/settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { haversineKm } from "../lib/geo.js";
import { round1, roadLegsKm, shortestPickupOrder } from "../lib/road-distance.js";
import { roundFare, type MatchingMode } from "@peebee/shared";
import { snapshotTimeFees } from "../orders/time-fees.js";
import { notifyUser } from "../lib/webpush.js";
import { insertRelayLegs, planRelay, relayChargeFor, resolveLastMile, type RelayLastMile, type RelayMeet, type RelayPlan } from "../relay/service.js";
import { getRelaySettings } from "../relay/settings.js";

import { digitalLmsRoutes } from "./digital-lms.js";
import { priceCheckoutItems } from "./pricing.js";
import { demoCatalogAllowed, findPublicStore, isStoreUnavailable, toPublicProduct, toPublicStore } from "./public.js";
import { checkDomain, normalizeHostname, verifyRecordName, verifyRecordValue } from "../lib/domains.js";
import { getOption } from "../lib/option-settings.js";
import { merchantRoleGuard, publicRateLimit } from "../lib/guards.js";
import { getOptions } from "../lib/option-settings.js";
import { recordLoyaltyForOrder, settleLoyalty } from "./loyalty.js";
import { sendStoreSms } from "./sms.js";
import { createStoreForMerchant } from "./store-create.js";
import { eliteOnly, planLimits, storePlan } from "./plans.js";
import { cleanSections, parseSections } from "./sections.js";
import { soldOutLicenseProducts } from "./digital-sales.js";
import { proofIsValid } from "../lib/phone-proof.js";

export const marketplaceRoutes = new Hono();
// Team roles are checked before any merchant route (including the digital and learning ones mounted below) runs.
marketplaceRoutes.use("/merchants/me/*", merchantRoleGuard);
marketplaceRoutes.route("/", digitalLmsRoutes);

type Row = Record<string, unknown>;

// Demo stores for sandbox and immediate testing
export const DEMO_MARKETPLACE_STORES = [
  {
    id: "store_demo_fresh_mart",
    name: "FreshMart Supermarket",
    slug: "freshmart-kampala",
    category: "groceries",
    sub_category: "supermarket",
    description: "Kampala's premier organic produce, pantry staples, bakery & dairy delivered in minutes.",
    announcement: "Free delivery on grocery orders over UGX 40,000! 🥕",
    logo_url: "/stores/freshmart-logo.jpg",
    banner_url: "https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 700 123 456",
    whatsapp_number: "+256 700 123 456",
    address: "Acacia Mall Ground Floor, Kololo",
    lat: 0.3353,
    lng: 32.5857,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 5000,
    pro_tier: "pro_live",
    is_live: 1,
    live_channel_title: "Fresh Morning Harvest! 🥑 Unpacking avocado crates & dairy offers",
    live_stream_url: "https://app.peebee.online/demo-video/market.mp4",
    live_stream_poster_url: "https://app.peebee.online/demo-video/market.jpg",
    live_viewer_count: 142,
    status: "active",
  },
  {
    id: "store_demo_urban_vogue",
    name: "Urban Vogue Boutique",
    slug: "urban-vogue-ug",
    category: "stores",
    sub_category: "fashion-boutique",
    description: "Contemporary street style, tailored linen shirts, denim essentials and designer sneakers.",
    announcement: "Flash Live Sale: 20% off all jackets tonight only! ✨",
    logo_url: "/stores/urbanvogue-logo.jpg",
    banner_url: "https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 772 987 654",
    whatsapp_number: "+256 772 987 654",
    address: "Garden City Mall Level 2, Kampala",
    lat: 0.3186,
    lng: 32.5898,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 10000,
    pro_tier: "pro_live",
    is_live: 1,
    live_channel_title: "Fitting Room Live! 🧥 Trying on the new Autumn linen collection",
    live_stream_url: "https://app.peebee.online/demo-video/fashion.mp4",
    live_stream_poster_url: "https://app.peebee.online/demo-video/fashion.jpg",
    live_viewer_count: 289,
    status: "active",
  },
  {
    id: "store_demo_tech_pulse",
    name: "TechPulse Electronics",
    slug: "techpulse-electronics",
    category: "stores",
    sub_category: "electronics",
    description: "Original audio gear, phone accessories, power stations & fast chargers.",
    announcement: "1-year warranty on all accessories & fast doorstep dispatch ⚡",
    logo_url: "/stores/techpulse-logo.jpg",
    banner_url: "https://images.unsplash.com/photo-1526738549149-8e07eca6c147?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 750 333 444",
    whatsapp_number: "+256 750 333 444",
    address: "Pioneer Mall, Kampala CBD",
    lat: 0.3138,
    lng: 32.5815,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 15000,
    pro_tier: "pro_live",
    is_live: 1,
    live_channel_title: "Tech Unboxing Live 🎧 Testing Noise Cancelling Wireless Headphones & Powerbanks",
    live_stream_url: "https://app.peebee.online/demo-video/earbuds.mp4",
    live_stream_poster_url: "https://app.peebee.online/demo-video/earbuds.jpg",
    live_viewer_count: 215,
    status: "active",
  },
  {
    id: "store_demo_golden_crust",
    name: "Golden Crust Bakery",
    slug: "golden-crust-bakery",
    category: "groceries",
    sub_category: "bakery",
    description: "Sourdough loaves, flaky butter croissants, cinnamon rolls & artisanal pastries.",
    announcement: "Warm sourdough loaves out of the oven every morning at 7:30 AM! 🥐",
    logo_url: "/stores/goldencrust-logo.jpg",
    banner_url: "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 701 445 566",
    whatsapp_number: "+256 701 445 566",
    address: "Bukoto Street, Kamwokya",
    lat: 0.3421,
    lng: 32.5872,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 5000,
    pro_tier: "pro_live",
    is_live: 1,
    live_channel_title: "Live Baking 🥖 Shaping Sourdough & Glazing Cinnamon Rolls",
    live_stream_url: "https://app.peebee.online/demo-video/bakery.mp4",
    live_stream_poster_url: "https://app.peebee.online/demo-video/bakery.jpg",
    live_viewer_count: 98,
    status: "active",
  },
  {
    id: "store_demo_glow_beauty",
    name: "Glow Essence Beauty",
    slug: "glow-essence-beauty",
    category: "stores",
    sub_category: "beauty",
    description: "Clean skincare, organic Shea butter creams, vitamin serums & natural cosmetics.",
    announcement: "Free rosewater mist with every order over UGX 50,000 ✨",
    logo_url: "/stores/glowbeauty-logo.jpg",
    banner_url: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 788 223 344",
    whatsapp_number: "+256 788 223 344",
    address: "Village Mall Bugolobi, Level 1",
    lat: 0.3142,
    lng: 32.6185,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 10000,
    pro_tier: "pro_live",
    is_live: 1,
    live_channel_title: "Live Skincare Routine 🧴 Testing African Black Soap & Niacinamide",
    live_stream_url: "https://app.peebee.online/demo-video/skincare.mp4",
    live_stream_poster_url: "https://app.peebee.online/demo-video/skincare.jpg",
    live_viewer_count: 175,
    status: "active",
  },
  {
    id: "store_demo_sneaker_hub",
    name: "Kampala Sneaker Hub",
    slug: "kampala-sneaker-hub",
    category: "stores",
    sub_category: "footwear",
    description: "Curated retro sneakers, street court kicks, slides and premium shoe protection.",
    announcement: "Friday Drop: New court high-tops in stock with same-day dispatch 👟",
    logo_url: "/stores/sneakerhub-logo.jpg",
    banner_url: "https://images.unsplash.com/photo-1460353581641-37baddab0fa2?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 702 889 900",
    whatsapp_number: "+256 702 889 900",
    address: "Arena Mall, Nsambya",
    lat: 0.2985,
    lng: 32.5852,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 20000,
    pro_tier: "pro_live",
    is_live: 1,
    live_channel_title: "Sneaker Drop Live 👟 Exclusive Unboxing of Retro High-Tops & Sizing Advice",
    live_stream_url: "https://app.peebee.online/demo-video/sneakers.mp4",
    live_stream_poster_url: "https://app.peebee.online/demo-video/sneakers.jpg",
    live_viewer_count: 188,
    status: "active",
  },
  {
    id: "store_demo_vine_pharmacy",
    name: "Vine Pharmacy — Acacia Mall",
    slug: "vine-pharmacy-acacia",
    category: "pharmacy",
    sub_category: "retail-pharmacy",
    description: "Full service licensed pharmacy dispensing authentic prescription medicines, cold care, baby wellness and vitamins.",
    announcement: "Supervising Pharmacist on duty 7 days a week. Express 25-min delivery across Kampala! 💊",
    logo_url: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=200&q=80",
    banner_url: "https://images.unsplash.com/photo-1576602976047-174e57a47881?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 772 110 220",
    whatsapp_number: "+256 772 110 220",
    address: "Acacia Mall, Ground Floor, Kisementi, Kololo",
    lat: 0.3344,
    lng: 32.5891,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 5000,
    pro_tier: "pro_store",
    is_live: 0,
    live_channel_title: null,
    live_stream_url: null,
    live_viewer_count: 0,
    status: "active",
    nda_license_number: "NDA/PREM/KLA/2026/0418",
    supervising_pharmacist: "Dr. Sarah Namubiru, BPharm, MPS",
    is_nda_verified: true,
  },
  {
    id: "store_demo_first_pharmacy",
    name: "First Pharmacy — Wandegeya",
    slug: "first-pharmacy-wandegeya",
    category: "pharmacy",
    sub_category: "retail-pharmacy",
    description: "24/7 prescription dispensing, chronic care medication, allergy relief, first aid and diagnostics.",
    announcement: "Upload prescription online for rapid pharmacist verification and courier dispatch 🚑",
    logo_url: "https://images.unsplash.com/photo-1631549916768-4119b2e5f926?auto=format&fit=crop&w=200&q=80",
    banner_url: "https://images.unsplash.com/photo-1586015555751-63c26210f462?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 701 445 566",
    whatsapp_number: "+256 701 445 566",
    address: "Wandegeya Commercial Centre, Opposite Makerere Gate",
    lat: 0.3312,
    lng: 32.5714,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 5000,
    pro_tier: "pro_store",
    is_live: 0,
    live_channel_title: null,
    live_stream_url: null,
    live_viewer_count: 0,
    status: "active",
    nda_license_number: "NDA/PREM/KLA/2026/0122",
    supervising_pharmacist: "Pharm. Brian Kigozi, BPharm",
    is_nda_verified: true,
  },
  {
    id: "store_demo_ecopharm",
    name: "Ecopharm — Lugogo Mall",
    slug: "ecopharm-lugogo",
    category: "pharmacy",
    sub_category: "retail-pharmacy",
    description: "Trusted community healthcare partner. Orthopedic supports, baby wellness, dermatology and pain management.",
    announcement: "Authentic medicines guaranteed under strict cold chain storage standards ❄️",
    logo_url: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=200&q=80",
    banner_url: "https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?auto=format&fit=crop&w=1200&q=80",
    phone: "+256 782 990 011",
    whatsapp_number: "+256 782 990 011",
    address: "Lugogo Shopping Mall, Shop 14, Lugogo Bypass",
    lat: 0.3275,
    lng: 32.6092,
    is_open: 1,
    delivery_enabled: 1,
    pickup_enabled: 1,
    min_order_amount: 5000,
    pro_tier: "pro_store",
    is_live: 0,
    live_channel_title: null,
    live_stream_url: null,
    live_viewer_count: 0,
    status: "active",
    nda_license_number: "NDA/PREM/KLA/2026/0889",
    supervising_pharmacist: "Pharm. Agnes Tumusiime, MPS",
    is_nda_verified: true,
  },
];

export const DEMO_MARKETPLACE_PRODUCTS: Record<string, any[]> = {
  store_demo_fresh_mart: [
    {
      id: "prod_milk_1l",
      store_id: "store_demo_fresh_mart",
      title: "Fresh Whole Farm Milk (1 Litre)",
      slug: "fresh-whole-farm-milk-1l",
      description: "Pasteurised fresh dairy whole milk from local Western Uganda farms.",
      price: 3500,
      compare_at_price: 4000,
      inventory_quantity: 80,
      category_name: "Dairy & Eggs",
      badge: "Fresh Daily",
      image_url: "/products/farm-fresh-milk.jpg",
      has_variants: 1,
      variants: [
        { id: "var_milk_500ml", title: "500ml Pouch", price: 2000, inventory_quantity: 40 },
        { id: "var_milk_1l", title: "1 Litre Bottle", price: 3500, inventory_quantity: 50 },
        { id: "var_milk_2l", title: "2 Litre Family Jug", price: 6500, compare_at_price: 7000, inventory_quantity: 25 },
      ],
    },
    {
      id: "prod_eggs_tray",
      store_id: "store_demo_fresh_mart",
      title: "Farm Fresh Eggs",
      slug: "farm-fresh-eggs-crate",
      description: "Large golden yolk farm eggs, cleanly sorted and packaged.",
      price: 13500,
      compare_at_price: 15000,
      inventory_quantity: 45,
      category_name: "Dairy & Eggs",
      badge: "Best Seller",
      image_url: "/products/farm-fresh-eggs.jpg",
      has_variants: 1,
      variants: [
        { id: "var_eggs_6", title: "Pack of 6", price: 3200, inventory_quantity: 30 },
        { id: "var_eggs_12", title: "Pack of 12", price: 6000, inventory_quantity: 20 },
        { id: "var_eggs_30", title: "Full Tray (30)", price: 13500, compare_at_price: 15000, inventory_quantity: 45 },
      ],
    },
    {
      id: "prod_honey_glazed_chicken",
      store_id: "store_demo_fresh_mart",
      title: "Honey Glazed Chicken",
      slug: "honey-glazed-chicken",
      description: "Crispy chicken in a sweet & savory honey-soy glaze, served on jasmine rice with sesame seeds & scallions.",
      price: 24000,
      compare_at_price: 28000,
      inventory_quantity: 40,
      category_name: "Fresh Meals",
      badge: "Chef Choice",
      image_url: "/products/honey-glazed-chicken.jpg",
      has_variants: 1,
      variants: [
        { id: "var_chicken_reg", title: "Regular Portion", price: 24000, inventory_quantity: 25 },
        { id: "var_chicken_large", title: "Large Meal Box", price: 32000, compare_at_price: 36000, inventory_quantity: 15 },
      ],
    },
    {
      id: "prod_avocados_pack",
      store_id: "store_demo_fresh_mart",
      title: "Hass Avocados (Pack of 3)",
      slug: "hass-avocados-pack",
      description: "Creamy, perfectly ripe organic avocados hand-picked daily.",
      price: 5000,
      inventory_quantity: 60,
      category_name: "Fresh Produce",
      badge: "Organic",
      image_url: "/products/fresh-avocados.jpg",
      has_variants: 0,
      variants: [],
    },
    {
      id: "prod_rice_5kg",
      store_id: "store_demo_fresh_mart",
      title: "Super Aromatic Basmati Rice (5kg)",
      slug: "super-aromatic-basmati-rice-5kg",
      description: "Long grain aromatic rice, clean and stone-free.",
      price: 28000,
      compare_at_price: 32000,
      inventory_quantity: 30,
      category_name: "Pantry Staples",
      badge: "Special Offer",
      image_url: "/products/basmati-rice.jpg",
      has_variants: 0,
      variants: [],
    },
  ],
  store_demo_golden_crust: [
    {
      id: "prod_butter_croissant",
      store_id: "store_demo_golden_crust",
      title: "Flaky French Butter Croissant (Pack of 2)",
      slug: "flaky-french-butter-croissant",
      description: "Baked with real butter and layered 24 times for authentic airy honeycomb flakiness.",
      price: 7500,
      compare_at_price: 9000,
      inventory_quantity: 40,
      category_name: "Bakery",
      badge: "Warm & Fresh",
      image_url: "/products/croissant-bakery.jpg",
      has_variants: 1,
      variants: [
        { id: "var_croissant_2", title: "Pack of 2", price: 7500, inventory_quantity: 25 },
        { id: "var_croissant_4", title: "Box of 4", price: 14000, compare_at_price: 16000, inventory_quantity: 15 },
      ],
    },
    {
      id: "prod_sourdough_loaf",
      store_id: "store_demo_golden_crust",
      title: "Country Artisan Sourdough Loaf (800g)",
      slug: "country-artisan-sourdough-loaf",
      description: "Naturally fermented for 36 hours with wild yeast, crispy crust and soft chewy crumb.",
      price: 12000,
      inventory_quantity: 20,
      category_name: "Bakery",
      badge: "Handmade",
      image_url: "/products/sourdough-bread.jpg",
      has_variants: 0,
      variants: [],
    },
    {
      id: "prod_cinnamon_roll",
      store_id: "store_demo_golden_crust",
      title: "Glazed Cinnamon Swirl Rolls (Box of 3)",
      slug: "glazed-cinnamon-swirl-rolls",
      description: "Soft brioche dough packed with Ceylon cinnamon and cream cheese vanilla drizzle.",
      price: 15000,
      compare_at_price: 18000,
      inventory_quantity: 18,
      category_name: "Bakery",
      badge: "Best Seller",
      image_url: "/products/cinnamon-rolls.jpg",
      has_variants: 0,
      variants: [],
    },
  ],
  store_demo_urban_vogue: [
    {
      id: "prod_pink_blazer",
      store_id: "store_demo_urban_vogue",
      title: "Minimalist Oversized Pink Blazer",
      slug: "minimalist-oversized-pink-blazer",
      description: "Modern minimalist single-breasted tailored blazer in soft blossom pink. Features structured shoulders, notch lapels, and full silk lining. Versatile for both power dressing and elevated casual evening looks.",
      price: 145000,
      compare_at_price: 175000,
      inventory_quantity: 22,
      category_name: "Fashion & Boutique",
      badge: "Best Seller",
      image_url: "/products/pink-blazer.jpg",
      has_variants: 1,
      variants: [
        { id: "var_blazer_s_blossom", title: "Size S / Blossom Pink", price: 145000, inventory_quantity: 5 },
        { id: "var_blazer_m_blossom", title: "Size M / Blossom Pink", price: 145000, inventory_quantity: 8 },
        { id: "var_blazer_l_blossom", title: "Size L / Blossom Pink", price: 145000, inventory_quantity: 6 },
        { id: "var_blazer_xl_blossom", title: "Size XL / Blossom Pink", price: 145000, inventory_quantity: 3 },
      ],
    },
    {
      id: "prod_linen_shirt",
      store_id: "store_demo_urban_vogue",
      title: "Relaxed Fit Cuban Linen Shirt",
      slug: "relaxed-fit-cuban-linen-shirt",
      description: "Breathable 100% natural linen shirt with spread collar. Perfect for warm tropical days.",
      price: 65000,
      compare_at_price: 80000,
      inventory_quantity: 25,
      category_name: "Fashion & Boutique",
      badge: "Featured on Live",
      image_url: "/products/cuban-linen-shirt.jpg",
      has_variants: 1,
      variants: [
        { id: "var_shirt_m_white", title: "Medium / Crisp White", price: 65000, inventory_quantity: 8 },
        { id: "var_shirt_l_white", title: "Large / Crisp White", price: 65000, inventory_quantity: 10 },
        { id: "var_shirt_m_sand", title: "Medium / Desert Sand", price: 65000, inventory_quantity: 7 },
        { id: "var_shirt_l_sand", title: "Large / Desert Sand", price: 65000, inventory_quantity: 5 },
      ],
    },
    {
      id: "prod_denim_jacket",
      store_id: "store_demo_urban_vogue",
      title: "Oversized Vintage Wash Denim Jacket",
      slug: "oversized-vintage-wash-denim-jacket",
      description: "Durable vintage wash denim with brass hardware and side pockets.",
      price: 95000,
      compare_at_price: 120000,
      inventory_quantity: 15,
      category_name: "Fashion & Boutique",
      badge: "20% Off Tonight",
      image_url: "/products/denim-jacket.jpg",
      has_variants: 1,
      variants: [
        { id: "var_jacket_m", title: "Size M (Chest 40)", price: 95000, inventory_quantity: 6 },
        { id: "var_jacket_l", title: "Size L (Chest 42)", price: 95000, inventory_quantity: 6 },
        { id: "var_jacket_xl", title: "Size XL (Chest 44)", price: 95000, inventory_quantity: 3 },
      ],
    },
  ],
  store_demo_tech_pulse: [
    {
      id: "prod_anc_earbuds",
      store_id: "store_demo_tech_pulse",
      title: "PulsePro Wireless ANC Earbuds",
      slug: "pulsepro-wireless-anc-earbuds",
      description: "Active noise cancelling with 40-hour battery life, wireless charging case and deep bass profile.",
      price: 95000,
      compare_at_price: 120000,
      inventory_quantity: 35,
      category_name: "Gadgets",
      badge: "Trending",
      image_url: "/products/anc-earbuds.jpg",
      has_variants: 1,
      variants: [
        { id: "var_earbuds_black", title: "Midnight Black", price: 95000, inventory_quantity: 20 },
        { id: "var_earbuds_white", title: "Frost White", price: 95000, inventory_quantity: 15 },
      ],
    },
    {
      id: "prod_powerbank_65w",
      store_id: "store_demo_tech_pulse",
      title: "65W Fast Charge Laptop Power Station (20,000mAh)",
      slug: "65w-fast-charge-power-station",
      description: "Charges MacBooks, iPhones and Androids at full speed. Aviation-safe capacity.",
      price: 145000,
      compare_at_price: 165000,
      inventory_quantity: 20,
      category_name: "Gadgets",
      badge: "Power Gear",
      image_url: "/products/powerbank-65w.jpg",
      has_variants: 0,
      variants: [],
    },
  ],
  store_demo_glow_beauty: [
    {
      id: "prod_whipped_shea",
      store_id: "store_demo_glow_beauty",
      title: "Organic Whipped Nilotica Shea Butter (250g)",
      slug: "organic-whipped-shea-butter",
      description: "Soft, whipped raw Nilotica Shea butter from Northern Uganda, enriched with Baobab and Vitamin E.",
      price: 28000,
      inventory_quantity: 45,
      category_name: "Beauty",
      badge: "100% Pure",
      image_url: "/products/shea-butter.jpg",
      has_variants: 1,
      variants: [
        { id: "var_shea_vanilla", title: "Madagascar Vanilla Scent (250g)", price: 28000, inventory_quantity: 25 },
        { id: "var_shea_unscented", title: "Fragrance Free Pure (250g)", price: 28000, inventory_quantity: 20 },
      ],
    },
    {
      id: "prod_glow_serum",
      store_id: "store_demo_glow_beauty",
      title: "Vitamin C & Niacinamide Radiance Serum (30ml)",
      slug: "vitamin-c-niacinamide-radiance-serum",
      description: "Brightening active formula to clear blemishes, fade spots and even skin tone.",
      price: 45000,
      compare_at_price: 55000,
      inventory_quantity: 25,
      category_name: "Beauty",
      badge: "Best Seller",
      image_url: "/products/glow-serum.jpg",
      has_variants: 0,
      variants: [],
    },
  ],
  store_demo_sneaker_hub: [
    {
      id: "prod_retro_high_top",
      store_id: "store_demo_sneaker_hub",
      title: "Air Retro High-Top Court Edition",
      slug: "air-retro-high-top-court",
      description: "Classic high-top silhouette in contrast red, black and white leather with cushioned air sole.",
      price: 185000,
      compare_at_price: 220000,
      inventory_quantity: 18,
      category_name: "Footwear",
      badge: "Limited Drop",
      image_url: "/products/retro-sneakers.jpg",
      has_variants: 1,
      variants: [
        { id: "var_kicks_41", title: "EU 41 / UK 7", price: 185000, inventory_quantity: 4 },
        { id: "var_kicks_42", title: "EU 42 / UK 8", price: 185000, inventory_quantity: 6 },
        { id: "var_kicks_43", title: "EU 43 / UK 9", price: 185000, inventory_quantity: 5 },
        { id: "var_kicks_44", title: "EU 44 / UK 10", price: 185000, inventory_quantity: 3 },
      ],
    },
    {
      id: "prod_canvas_low",
      store_id: "store_demo_sneaker_hub",
      title: "Everyday Clean Canvas Low-Tops",
      slug: "everyday-clean-canvas-low-tops",
      description: "Minimalist off-white canvas with vulcanised gum rubber sole. Effortless daily wear.",
      price: 75000,
      compare_at_price: 90000,
      inventory_quantity: 22,
      category_name: "Footwear",
      badge: "Wardrobe Essential",
      image_url: "/products/canvas-sneakers.jpg",
      has_variants: 0,
      variants: [],
    },
  ],
  store_demo_vine_pharmacy: [
    {
      id: "prod_panadol_extra",
      store_id: "store_demo_vine_pharmacy",
      title: "Panadol Extra (Paracetamol 500mg + Caffeine 65mg)",
      slug: "panadol-extra-24s",
      description: "Fast relief for tough headaches, migraines, muscle aches, backaches and fever.",
      price: 6500,
      compare_at_price: 7500,
      inventory_quantity: 120,
      category_name: "Pain & Fever",
      badge: "Fast Acting",
      image_url: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Tablets",
      strength: "500mg / 65mg",
      pack_size: "Pack of 24",
      active_ingredient: "Paracetamol, Caffeine",
    },
    {
      id: "prod_piriton_4mg",
      store_id: "store_demo_vine_pharmacy",
      title: "Piriton Allergy Relief 4mg",
      slug: "piriton-4mg-30s",
      description: "Rapid relief from hayfever, skin allergies, runny nose, sneezing, and insect bites.",
      price: 5000,
      inventory_quantity: 85,
      category_name: "Cold & Allergy",
      badge: "Allergy Relief",
      image_url: "https://images.unsplash.com/photo-1471864190281-a93a3070b6de?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Tablets",
      strength: "4mg",
      pack_size: "Strip of 30",
      active_ingredient: "Chlorpheniramine Maleate",
    },
    {
      id: "prod_strepsils_honey",
      store_id: "store_demo_vine_pharmacy",
      title: "Strepsils Honey & Lemon Lozenges",
      slug: "strepsils-honey-lemon-16s",
      description: "Dual antibacterial soothing relief for sore throats and mouth infections.",
      price: 12500,
      compare_at_price: 14000,
      inventory_quantity: 60,
      category_name: "Cold & Allergy",
      badge: "Sore Throat",
      image_url: "https://images.unsplash.com/photo-1550572017-edd951aa8f72?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Lozenges",
      pack_size: "Pack of 16",
      active_ingredient: "Amylmetacresol, Dichlorobenzyl alcohol",
    },
    {
      id: "prod_redoxon_vit_c",
      store_id: "store_demo_vine_pharmacy",
      title: "Redoxon Double Action Vitamin C 1000mg + Zinc",
      slug: "redoxon-vit-c-zinc-15s",
      description: "Effervescent immune booster tablets with essential Vitamin C and Zinc antioxidant shield.",
      price: 28000,
      compare_at_price: 32000,
      inventory_quantity: 40,
      category_name: "Vitamins & Wellness",
      badge: "Immune Shield",
      image_url: "https://images.unsplash.com/photo-1577401239170-897942555fb3?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Effervescent Tablets",
      strength: "1000mg + 10mg",
      pack_size: "Tube of 15",
      active_ingredient: "Ascorbic Acid, Zinc",
    },
    {
      id: "prod_savlon_250ml",
      store_id: "store_demo_vine_pharmacy",
      title: "Savlon Antiseptic Disinfectant Liquid (250ml)",
      slug: "savlon-antiseptic-liquid-250ml",
      description: "Gentle hospital-grade antiseptic for cleaning cuts, grazes, bites, and wound cleansing.",
      price: 14000,
      inventory_quantity: 50,
      category_name: "First Aid",
      badge: "Hospital Grade",
      image_url: "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Liquid",
      pack_size: "250ml Bottle",
      active_ingredient: "Chlorhexidine Gluconate, Cetrimide",
    },
    {
      id: "prod_omeprazole_20mg",
      store_id: "store_demo_vine_pharmacy",
      title: "Omeprazole 20mg Gastro-Resistant Capsules",
      slug: "omeprazole-20mg-14s",
      description: "Relief of frequent heartburn, acid indigestion, and gastric reflux.",
      price: 10000,
      inventory_quantity: 75,
      category_name: "Digestion & Stomach",
      badge: "Acid Relief",
      image_url: "https://images.unsplash.com/photo-1585435557343-3b092031a831?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Capsules",
      strength: "20mg",
      pack_size: "Strip of 14",
      active_ingredient: "Omeprazole",
    },
    {
      id: "prod_woodwards_gripe_water",
      store_id: "store_demo_vine_pharmacy",
      title: "Woodward's Gripe Water for Infants (150ml)",
      slug: "woodwards-gripe-water-150ml",
      description: "Non-alcoholic gentle herbal formula for rapid relief of infant colic, wind, and tummy discomfort during teething.",
      price: 15000,
      inventory_quantity: 35,
      category_name: "Mother & Baby",
      badge: "Infant Care",
      image_url: "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Syrup",
      pack_size: "150ml Bottle",
      active_ingredient: "Dill Oil, Sodium Bicarbonate",
    },
  ],
  store_demo_first_pharmacy: [
    {
      id: "prod_hedex_extra",
      store_id: "store_demo_first_pharmacy",
      title: "Hedex Extra Fast Pain Relief Tablets",
      slug: "hedex-extra-16s",
      description: "Targeted fast headache and toothache relief formulation with paracetamol and caffeine.",
      price: 4500,
      inventory_quantity: 90,
      category_name: "Pain & Fever",
      badge: "Targeted Relief",
      image_url: "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Tablets",
      strength: "500mg / 65mg",
      pack_size: "Pack of 16",
      active_ingredient: "Paracetamol, Caffeine",
    },
    {
      id: "prod_ascoril_cough",
      store_id: "store_demo_first_pharmacy",
      title: "Ascoril Expectorant Cough Syrup (100ml)",
      slug: "ascoril-cough-syrup-100ml",
      description: "Bronchodilator and expectorant syrup for chesty cough, bronchitis, and respiratory congestion.",
      price: 16000,
      compare_at_price: 18500,
      inventory_quantity: 45,
      category_name: "Cold & Allergy",
      badge: "Chesty Cough",
      image_url: "https://images.unsplash.com/photo-1587854692152-cbe660dbde88?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Syrup",
      strength: "100ml",
      pack_size: "100ml Bottle",
      active_ingredient: "Terbutaline, Bromhexine, Guaiphenesin",
    },
    {
      id: "prod_sudocrem_60g",
      store_id: "store_demo_first_pharmacy",
      title: "Sudocrem Antiseptic Healing Cream (60g)",
      slug: "sudocrem-healing-cream-60g",
      description: "Clinically proven soothing protection for baby nappy rash, eczema, bedsores, and minor burns.",
      price: 24000,
      inventory_quantity: 30,
      category_name: "Mother & Baby",
      badge: "Dermatologist Approved",
      image_url: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Topical Cream",
      pack_size: "60g Tub",
      active_ingredient: "Zinc Oxide, Benzyl Benzoate",
    },
    {
      id: "prod_digital_thermometer",
      store_id: "store_demo_first_pharmacy",
      title: "Accu-Scan Infrared Forehead & Ear Thermometer",
      slug: "accu-scan-digital-thermometer",
      description: "Instant 1-second non-contact clinical body temperature measurement with fever alarm.",
      price: 45000,
      compare_at_price: 52000,
      inventory_quantity: 20,
      category_name: "First Aid",
      badge: "Clinical Precision",
      image_url: "https://images.unsplash.com/photo-1584017911766-d451b3d0e843?auto=format&fit=crop&w=400&q=80",
      has_variants: 0,
      variants: [],
      rx_required: false,
      dosage_form: "Diagnostic Device",
      pack_size: "1 Unit",
    },
  ],
};

export const DEMO_MARKETPLACE_SPOTLIGHT = [
  {
    id: "spot_live_fresh_harvest",
    store_id: "store_demo_fresh_mart",
    store_name: "FreshMart Supermarket",
    store_slug: "freshmart-kampala",
    store_logo: "https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=200&q=80",
    store_category: "groceries",
    type: "live" as const,
    media_url: "https://app.peebee.online/demo-video/market.mp4",
    poster_url: "https://app.peebee.online/demo-video/market.jpg",
    title: "Fresh Morning Harvest! 🥑 Unpacking avocado crates & dairy offers",
    description: "Watch live as we unpack fresh farm organic avocados and cold milk pouches directly from Mbale orchards.",
    product: {
      id: "prod_avocados_pack",
      title: "Hass Avocados (Pack of 3)",
      price: 5000,
      image_url: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=400&q=80",
      badge: "Organic",
    },
    viewer_count: 142,
    likes_count: 1240,
    comments_count: 88,
  },
  {
    id: "spot_video_linen_shirt",
    store_id: "store_demo_urban_vogue",
    store_name: "Urban Vogue Boutique",
    store_slug: "urban-vogue-ug",
    store_logo: "https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=200&q=80",
    store_category: "stores",
    type: "video" as const,
    media_url: "https://app.peebee.online/demo-video/fashion.mp4",
    poster_url: "https://app.peebee.online/demo-video/fashion.jpg",
    title: "Summer Linen Collection ☀️ Styling relaxed fit Cuban shirts for weekend vibes",
    description: "Breathable 100% natural linen shirt with spread collar. Watch our fitting room walkthrough.",
    product: {
      id: "prod_linen_shirt",
      title: "Relaxed Fit Cuban Linen Shirt",
      price: 65000,
      compare_at_price: 80000,
      image_url: "https://images.unsplash.com/photo-1596755094514-f87e34085b2c?auto=format&fit=crop&w=400&q=80",
      badge: "20% Off",
    },
    likes_count: 2890,
    comments_count: 142,
  },
  {
    id: "spot_live_croissant_bake",
    store_id: "store_demo_golden_crust",
    store_name: "Golden Crust Bakery",
    store_slug: "golden-crust-bakery",
    store_logo: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=200&q=80",
    store_category: "groceries",
    type: "live" as const,
    media_url: "https://app.peebee.online/demo-video/bakery.mp4",
    poster_url: "https://app.peebee.online/demo-video/bakery.jpg",
    title: "Live Baking 🥐 Glazing Cinnamon Swirls & Butter Croissants Fresh from Oven",
    description: "Watch the master baker glaze golden pastry layers live. Order now for 20-min express delivery in Kampala.",
    product: {
      id: "prod_butter_croissant",
      title: "Flaky French Butter Croissant (Pack of 2)",
      price: 7500,
      compare_at_price: 9000,
      image_url: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=400&q=80",
      badge: "Warm & Fresh",
    },
    viewer_count: 98,
    likes_count: 940,
    comments_count: 56,
  },
  {
    id: "spot_carousel_retro_sneakers",
    store_id: "store_demo_sneaker_hub",
    store_name: "Kampala Sneaker Hub",
    store_slug: "kampala-sneaker-hub",
    store_logo: "https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=200&q=80",
    store_category: "stores",
    type: "carousel" as const,
    media_url: "https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=800&q=80",
    carousel_images: [
      "https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1595950653106-6c9ebd614d3a?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1584735935682-2f2b69dff9d2?auto=format&fit=crop&w=800&q=80",
    ],
    title: "Friday Kicks Drop! 🔥 Retro High-Tops & Minimalist Streetwear Court Sneakers",
    description: "Swipe to view all angles of the Court Edition Air Retros. Original leather, verified authentic box.",
    product: {
      id: "prod_retro_high_top",
      title: "Air Retro High-Top Court Edition",
      price: 185000,
      compare_at_price: 220000,
      image_url: "https://images.unsplash.com/photo-1552346154-21d32810aba3?auto=format&fit=crop&w=400&q=80",
      badge: "Limited Drop",
    },
    likes_count: 3410,
    comments_count: 215,
  },
  {
    id: "spot_video_anc_earbuds",
    store_id: "store_demo_tech_pulse",
    store_name: "TechPulse Electronics",
    store_slug: "techpulse-electronics",
    store_logo: "https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=200&q=80",
    store_category: "stores",
    type: "video" as const,
    media_url: "https://app.peebee.online/demo-video/earbuds.mp4",
    poster_url: "https://app.peebee.online/demo-video/earbuds.jpg",
    title: "Active Noise Cancelling Test 🎧 40hr Battery & Crystal Clear Bass Unboxing",
    description: "Testing Bluetooth 5.3 instant pairing and wireless fast charge. Works with both iOS and Android.",
    product: {
      id: "prod_anc_earbuds",
      title: "PulsePro Wireless ANC Earbuds",
      price: 95000,
      compare_at_price: 120000,
      image_url: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=400&q=80",
      badge: "Trending",
    },
    likes_count: 1720,
    comments_count: 94,
  },
  {
    id: "spot_image_organic_shea",
    store_id: "store_demo_glow_beauty",
    store_name: "Glow Essence Beauty",
    store_slug: "glow-essence-beauty",
    store_logo: "https://images.unsplash.com/photo-1522335789203-aabd1fc54bc9?auto=format&fit=crop&w=200&q=80",
    store_category: "stores",
    type: "image" as const,
    media_url: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=800&q=80",
    title: "Whipped Shea Butter Body Silk 🍯 Infused with Madagascar Vanilla & Baobab Oil",
    description: "Pure organic moisture for dry skin. Melts instantly on contact with hands. Made in Uganda.",
    product: {
      id: "prod_whipped_shea",
      title: "Organic Whipped Nilotica Shea Butter (250g)",
      price: 28000,
      image_url: "https://images.unsplash.com/photo-1556228720-195a672e8a03?auto=format&fit=crop&w=400&q=80",
      badge: "100% Pure",
    },
    likes_count: 890,
    comments_count: 42,
  },
];

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-");
}

// ---------------------------------------------------------------------------
// Merchant Pro Store Endpoints
// ---------------------------------------------------------------------------

async function getMerchantStore(merchantId: string): Promise<Row | null> {
  const res = await db.execute({
    sql: "SELECT * FROM stores WHERE merchant_id = ? LIMIT 1",
    args: [merchantId],
  });
  const row = (res.rows[0] as Row | undefined) ?? null;
  if (!row) return null;
  if (Number(row.elite_tier || 0) === 1) {
    return { ...row, pro_tier: "elite" };
  }
  return row;
}

// The Elite operating-system endpoints need an active Elite plan, checked here and not just hidden in the app.
for (const path of [
  "/merchants/me/outlet-inventory", "/merchants/me/draft-orders", "/merchants/me/elite-analytics", "/merchants/me/pos-sales",
  "/merchants/me/stock-transfers", "/merchants/me/crm-customers", "/merchants/me/suppliers", "/merchants/me/purchase-orders",
  "/merchants/me/purchase-orders/*", "/merchants/me/bundles", "/merchants/me/bundles/*", "/merchants/me/winback-campaigns",
]) {
  marketplaceRoutes.use(path, requireAuth, eliteOnly);
}

// 1. Get Merchant's Store Profile & Status
marketplaceRoutes.get("/merchants/me/store", requireAuth, async (c) => {
  const user = c.get("user");
  // Find merchant linked to this user
  const memberRes = await db.execute({
    sql: "SELECT merchant_id, role FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const member = memberRes.rows[0] as Row | undefined;
  if (!member) return c.json({ error: "no_merchant_membership" }, 403);

  const merchantId = String(member.merchant_id);
  const store = await getMerchantStore(merchantId);
  const settings = await getMarketplaceSettings();

  if (!store) {
    return c.json({
      store: null,
      canCreate: true,
      trialDays: settings.proTrialDays,
      pricing: {
        proPricingMode: settings.proPricingMode,
        proStoreUgx: settings.proStorePriceUgx,
        proLiveUgx: settings.proLivePriceUgx,
        eliteUgx: settings.elitePriceUgx,
        eliteEnabled: settings.eliteEnabled,
        isProFree: settings.proPricingMode === "free",
      },
      settings,
    });
  }

  // Count active products
  const countRes = await db.execute({
    sql: "SELECT COUNT(*) as count FROM store_products WHERE store_id = ? AND status != 'archived'",
    args: [String(store.id)],
  });
  const productCount = Number((countRes.rows[0] as Row)?.count || 0);

  const isProFree = settings.proPricingMode === "free";
  const planInfo = await storePlan(store, settings);
  const warnDays = Number((await getOptions(["merchant_plan_warn_days"])).merchant_plan_warn_days);
  const roleOptions = await getOptions(["member_roles_manage_digital", "member_roles_manage_catalog", "member_roles_manage_billing", "member_roles_manage_store_settings", "member_roles_refund_revoke"]);
  const permissions = Object.fromEntries(Object.entries(roleOptions).map(([key, roles]) => [key.replace("member_roles_", ""), (roles as string[]).includes(String(member.role))]));

  return c.json({
    store: {
      ...store,
      pro_tier: planInfo.isElite ? "elite" : planInfo.plan === "merchant" ? "free" : planInfo.plan,
      elite_tier: planInfo.isElite ? 1 : 0,
      is_pro_free: isProFree,
      productCount,
      permissions,
      plan: { ...planInfo, warn: planInfo.daysLeft !== null && planInfo.daysLeft <= warnDays },
    },
    settings,
  });
});

// 2. Create Store (Assisted Quick Setup)
const createStoreSchema = z.object({
  name: z.string().min(2).max(60),
  category: z.enum(["groceries", "stores"]),
  sub_category: z.string().optional(),
  description: z.string().max(500).optional(),
  announcement: z.string().max(160).optional(),
  phone: z.string().optional(),
  whatsapp_number: z.string().optional(),
  address: z.string().optional(),
  min_order_amount: z.number().int().nonnegative().optional(),
});

marketplaceRoutes.post("/merchants/me/store", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id, role FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const member = memberRes.rows[0] as Row | undefined;
  if (!member) return c.json({ error: "no_merchant_membership" }, 403);
  const merchantId = String(member.merchant_id);

  const existing = await getMerchantStore(merchantId);
  if (existing) return c.json({ error: "store_already_exists", storeId: existing.id }, 400);

  const body = await c.req.json().catch(() => ({}));
  const parsed = createStoreSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const made = await createStoreForMerchant(merchantId, parsed.data);
  if (!made.ok) return c.json({ error: made.error, message: made.message }, 400);

  const created = await getMerchantStore(merchantId);
  return c.json({ store: created, trialActive: true });
});

// 3. Update Store Settings & Elite Theme / Custom Domain / Loyalty / B2B Settings
marketplaceRoutes.put("/merchants/me/store", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const updateSchema = z.object({
    name: z.string().min(2).max(60).optional(),
    description: z.string().max(500).optional(),
    announcement: z.string().max(160).optional(),
    logo_url: z.string().url().or(z.string().length(0)).optional(),
    banner_url: z.string().url().or(z.string().length(0)).optional(),
    phone: z.string().optional(),
    whatsapp_number: z.string().optional(),
    address: z.string().optional(),
    is_open: z.boolean().optional(),
    delivery_enabled: z.boolean().optional(),
    pickup_enabled: z.boolean().optional(),
    min_order_amount: z.number().int().nonnegative().optional(),
    // Elite Storefront 2.0 & Commerce OS fields
    custom_domain: z.string().max(120).optional(),
    theme_layout: z.enum(["grid", "editorial", "compact"]).optional(),
    theme_accent: z.enum(["gold", "ink", "cream"]).optional(),
    hero_headline: z.string().max(120).optional(),
    hero_subheadline: z.string().max(240).optional(),
    hero_cta_text: z.string().max(40).optional(),
    seo_title: z.string().max(120).optional(),
    seo_description: z.string().max(240).optional(),
    // Pixel ids are put into a script on the public store, so only the exact shape of a real id is accepted.
    meta_pixel_id: z.string().trim().regex(/^(\d{5,20})?$/, "A Meta pixel id is digits only").optional(),
    tiktok_pixel_id: z.string().trim().toUpperCase().regex(/^([A-Z0-9]{8,32})?$/, "A TikTok pixel id is letters and numbers only").optional(),
    loyalty_enabled: z.boolean().optional(),
    loyalty_cashback_percent: z.number().min(0).max(50).optional(),
    b2b_wholesale_enabled: z.boolean().optional(),
    b2b_min_order_amount: z.number().int().nonnegative().optional(),
  });

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const settings = await getMarketplaceSettings();

  // Custom themes, the hero banner, a custom domain, loyalty cashback and wholesale are Merchant Elite. Saving a form that
  // leaves them as they are is fine on any plan; changing one needs an active Elite plan.
  {
    const same = (a: unknown, b: unknown) => String(a ?? "").trim() === String(b ?? "").trim();
    const elite: Array<[string, unknown, unknown]> = [
      ["custom_domain", parsed.data.custom_domain, store.custom_domain],
      ["theme_layout", parsed.data.theme_layout, store.theme_layout],
      ["theme_accent", parsed.data.theme_accent, store.theme_accent],
      ["hero_headline", parsed.data.hero_headline, store.hero_headline],
      ["hero_subheadline", parsed.data.hero_subheadline, store.hero_subheadline],
      ["hero_cta_text", parsed.data.hero_cta_text, store.hero_cta_text],
      ["loyalty_enabled", parsed.data.loyalty_enabled === undefined ? undefined : Number(parsed.data.loyalty_enabled), store.loyalty_enabled],
      ["loyalty_cashback_percent", parsed.data.loyalty_cashback_percent, store.loyalty_cashback_percent],
      ["b2b_wholesale_enabled", parsed.data.b2b_wholesale_enabled === undefined ? undefined : Number(parsed.data.b2b_wholesale_enabled), store.b2b_wholesale_enabled],
      ["b2b_min_order_amount", parsed.data.b2b_min_order_amount, store.b2b_min_order_amount],
    ];
    const changed = elite.filter(([, incoming, current]) => incoming !== undefined && !same(incoming, current)).map(([field]) => field);
    if (changed.length > 0 && !(await storePlan(store, settings)).isElite) {
      return c.json({ error: "plan_required", requiredPlan: "elite", fields: changed, message: "Themes, the hero banner, a custom domain, loyalty cashback and wholesale are part of Merchant Elite. Upgrade your plan in the Store tab to change them." }, 403);
    }
  }

  if (parsed.data.loyalty_cashback_percent != null && parsed.data.loyalty_cashback_percent > settings.eliteMaxLoyaltyCashbackPercent) {
    return c.json({
      error: "loyalty_cashback_exceeds_max",
      message: `Loyalty cashback cannot exceed the platform maximum of ${settings.eliteMaxLoyaltyCashbackPercent}%.`,
    }, 400);
  }

  const updates: string[] = [];
  const args: (string | number)[] = [];

  if (parsed.data.name != null) { updates.push("name = ?"); args.push(parsed.data.name); }
  if (parsed.data.description != null) { updates.push("description = ?"); args.push(parsed.data.description); }
  if (parsed.data.announcement != null) { updates.push("announcement = ?"); args.push(parsed.data.announcement); }
  if (parsed.data.logo_url != null) { updates.push("logo_url = ?"); args.push(parsed.data.logo_url); }
  if (parsed.data.banner_url != null) { updates.push("banner_url = ?"); args.push(parsed.data.banner_url); }
  if (parsed.data.phone != null) { updates.push("phone = ?"); args.push(parsed.data.phone); }
  if (parsed.data.whatsapp_number != null) { updates.push("whatsapp_number = ?"); args.push(parsed.data.whatsapp_number); }
  if (parsed.data.address != null) { updates.push("address = ?"); args.push(parsed.data.address); }
  if (parsed.data.is_open != null) { updates.push("is_open = ?"); args.push(parsed.data.is_open ? 1 : 0); }
  if (parsed.data.delivery_enabled != null) { updates.push("delivery_enabled = ?"); args.push(parsed.data.delivery_enabled ? 1 : 0); }
  if (parsed.data.pickup_enabled != null) { updates.push("pickup_enabled = ?"); args.push(parsed.data.pickup_enabled ? 1 : 0); }
  if (parsed.data.min_order_amount != null) { updates.push("min_order_amount = ?"); args.push(parsed.data.min_order_amount); }

  if (await hasColumn("stores", "custom_domain")) {
    if (parsed.data.custom_domain != null) {
      const raw = parsed.data.custom_domain.trim();
      const hasVerifyCols = await hasColumn("stores", "domain_verified");
      if (raw === "") {
        updates.push("custom_domain = NULL");
        if (hasVerifyCols) updates.push("domain_verified = 0", "domain_verify_token = NULL");
      } else if (raw.toLowerCase() !== String(store.custom_domain ?? "")) {
        const domainMode = await getOption<string>("storefront_domain_mode");
        if (domainMode !== "subdomain_plus_verified_custom_domains") {
          return c.json({ error: "custom_domains_disabled", message: "Custom domains are not switched on for the platform yet. Your store is available at its Peebee address." }, 409);
        }
        const host = normalizeHostname(raw);
        if (!host) return c.json({ error: "invalid_domain", message: "Enter a domain like shop.example.com (no http://, no path)." }, 400);
        const taken = await db.execute({ sql: "SELECT id FROM stores WHERE custom_domain = ? AND id != ? LIMIT 1", args: [host, String(store.id)] });
        if (taken.rows[0]) return c.json({ error: "domain_taken", message: "That domain is already connected to another store." }, 409);
        if (String(store.custom_domain ?? "") !== host) {
          updates.push("custom_domain = ?", "domain_verified = 0", "domain_verify_token = ?");
          args.push(host, crypto.randomUUID().replace(/-/g, "").slice(0, 24));
        }
      }
    }
    if (parsed.data.theme_layout != null) { updates.push("theme_layout = ?"); args.push(parsed.data.theme_layout); }
    if (parsed.data.theme_accent != null) { updates.push("theme_accent = ?"); args.push(parsed.data.theme_accent); }
    if (parsed.data.hero_headline != null) { updates.push("hero_headline = ?"); args.push(parsed.data.hero_headline); }
    if (parsed.data.hero_subheadline != null) { updates.push("hero_subheadline = ?"); args.push(parsed.data.hero_subheadline); }
    if (parsed.data.hero_cta_text != null) { updates.push("hero_cta_text = ?"); args.push(parsed.data.hero_cta_text); }
    if (parsed.data.seo_title != null) { updates.push("seo_title = ?"); args.push(parsed.data.seo_title); }
    if (parsed.data.seo_description != null) { updates.push("seo_description = ?"); args.push(parsed.data.seo_description); }
    if (parsed.data.meta_pixel_id != null) { updates.push("meta_pixel_id = ?"); args.push(parsed.data.meta_pixel_id); }
    if (parsed.data.tiktok_pixel_id != null) { updates.push("tiktok_pixel_id = ?"); args.push(parsed.data.tiktok_pixel_id); }
    if (parsed.data.loyalty_enabled != null) { updates.push("loyalty_enabled = ?"); args.push(parsed.data.loyalty_enabled ? 1 : 0); }
    if (parsed.data.loyalty_cashback_percent != null) { updates.push("loyalty_cashback_percent = ?"); args.push(parsed.data.loyalty_cashback_percent); }
    if (parsed.data.b2b_wholesale_enabled != null) { updates.push("b2b_wholesale_enabled = ?"); args.push(parsed.data.b2b_wholesale_enabled ? 1 : 0); }
    if (parsed.data.b2b_min_order_amount != null) { updates.push("b2b_min_order_amount = ?"); args.push(parsed.data.b2b_min_order_amount); }
  }

  if (updates.length > 0) {
    updates.push("updated_at = datetime('now')");
    args.push(String(store.id));
    await db.execute({
      sql: `UPDATE stores SET ${updates.join(", ")} WHERE id = ?`,
      args,
    });
  }

  const updated = await getMerchantStore(merchantId);
  return c.json({ store: updated });
});

// 3a. Prove control of a custom domain: the merchant publishes a TXT record and we look for it.
marketplaceRoutes.post("/merchants/me/store/domain/verify", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);
  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasColumn("stores", "domain_verified"))) {
    return c.json({ error: "migration_pending", message: "Custom domains are being set up (0137_storefront_hardening.sql is not applied yet)." }, 503);
  }
  const domain = String(store.custom_domain ?? "");
  const token = String(store.domain_verify_token ?? "");
  if (!domain || !token) return c.json({ error: "no_domain", message: "Add a custom domain first." }, 400);
  const limited = await publicRateLimit(c, "domain-verify", String(store.id), "rate_limit_public_inquiry_per_hour", 3600);
  if (limited) return limited;

  const verified = await checkDomain(domain, token);
  if (verified) await db.execute({ sql: "UPDATE stores SET domain_verified = 1, updated_at = datetime('now') WHERE id = ?", args: [String(store.id)] });
  return c.json({
    verified,
    domain,
    record: { type: "TXT", name: verifyRecordName(domain), value: verifyRecordValue(token) },
    message: verified ? "Domain verified. Your store now answers on it." : "We could not find the TXT record yet. DNS changes can take a few minutes — try again shortly.",
  });
});

// 3b. Buy or renew a plan (Pro Store / Pro Live / Elite)
const upgradeTierSchema = z.object({
  tier: z.enum(["pro_store", "pro_live", "elite"]),
  billingCycle: z.enum(["monthly", "yearly"]).default("monthly"),
});

const PLAN_RANK: Record<string, number> = { merchant: 0, pro_store: 1, pro_live: 2, elite: 3 };
const PLAN_LABEL: Record<string, string> = { pro_store: "Merchant Pro (Store)", pro_live: "Merchant Pro (Live)", elite: "Merchant Elite" };

marketplaceRoutes.post("/merchants/me/store/tier", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id, role FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const member = memberRes.rows[0] as Row | undefined;
  if (!member) return c.json({ error: "no_merchant_membership" }, 403);
  // The owner's wallet pays, so only the owner decides.
  if (String(member.role) !== "owner") return c.json({ error: "insufficient_role", message: "Only the business owner can change the plan." }, 403);
  const merchantId = String(member.merchant_id);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store", message: "Open your store first, then choose a plan." }, 404);

  const parsed = upgradeTierSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const { tier, billingCycle } = parsed.data;

  const settings = await getMarketplaceSettings();
  if (tier === "elite" && !settings.eliteEnabled) {
    return c.json({ error: "elite_tier_disabled", message: "Merchant Elite tier is currently paused by platform admin." }, 403);
  }

  const current = await storePlan(store, settings);
  if (!current.legacy && PLAN_RANK[tier] < PLAN_RANK[current.plan]) {
    return c.json({ error: "already_on_higher_plan", message: `You're on ${PLAN_LABEL[current.plan] ?? "a higher plan"}. It stays until it ends; you can switch after that.` }, 409);
  }

  const days = billingCycle === "yearly" ? 365 : 30;
  const basePrice = tier === "elite" ? settings.elitePriceUgx : tier === "pro_live" ? settings.proLivePriceUgx : settings.proStorePriceUgx;
  const amount = settings.proPricingMode === "free" ? 0 : billingCycle === "yearly" ? basePrice * 10 : basePrice;

  // Renewing the plan you have adds to its end; anything else starts today.
  const startFrom = current.plan === tier && current.expiresAt && Date.parse(current.expiresAt) > Date.now() ? Date.parse(current.expiresAt) : Date.now();
  const expiresAt = new Date(startFrom + days * 86400000).toISOString();

  const environment = await getPlatformEnvironment();
  const hasEliteCol = await hasColumn("stores", "elite_tier");
  const subId = newId("sub");
  const label = PLAN_LABEL[tier];

  if (amount > 0) {
    const balance = await debitWallet(user.sub, amount, { type: "order_payment", environment, note: `Peebee plan: ${label} (${billingCycle})` });
    if (balance === null) {
      return c.json({ error: "insufficient_wallet", neededUgx: amount, message: `Add UGX ${amount.toLocaleString("en-UG")} to your Peebee wallet to switch to ${label}.` }, 402);
    }
  }

  const statements: DbStatement[] = [];
  if (tier === "elite") {
    statements.push(hasEliteCol
      ? { sql: "UPDATE stores SET pro_tier = 'pro_live', pro_expires_at = ?, elite_tier = 1, elite_expires_at = ?, updated_at = datetime('now') WHERE id = ?", args: [expiresAt, expiresAt, String(store.id)] }
      : { sql: "UPDATE stores SET pro_tier = 'pro_live', pro_expires_at = ?, updated_at = datetime('now') WHERE id = ?", args: [expiresAt, String(store.id)] });
  } else {
    statements.push(hasEliteCol
      ? { sql: "UPDATE stores SET pro_tier = ?, pro_expires_at = ?, elite_tier = 0, updated_at = datetime('now') WHERE id = ?", args: [tier, expiresAt, String(store.id)] }
      : { sql: "UPDATE stores SET pro_tier = ?, pro_expires_at = ?, updated_at = datetime('now') WHERE id = ?", args: [tier, expiresAt, String(store.id)] });
  }
  // store_subscriptions.tier can only hold the two Pro tiers, so Elite is filed under pro_live and named in `plan`.
  const subTier = tier === "elite" ? "pro_live" : tier;
  statements.push((await hasColumn("store_subscriptions", "plan"))
    ? { sql: `INSERT INTO store_subscriptions (id, store_id, merchant_id, tier, plan, amount_paid, billing_cycle, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`, args: [subId, String(store.id), merchantId, subTier, tier, amount, billingCycle, expiresAt] }
    : { sql: `INSERT INTO store_subscriptions (id, store_id, merchant_id, tier, amount_paid, billing_cycle, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`, args: [subId, String(store.id), merchantId, subTier, amount, billingCycle, expiresAt] });

  try {
    if (amount > 0) {
      // The money, the ledger entry, the new plan and the receipt are written together or not at all.
      await postLedgerTransaction({
        kind: "merchant_plan", idempotencyKey: `merchant-plan:${subId}`, environment,
        referenceType: "store_subscription", referenceId: subId, description: `Peebee plan: ${label}`, actorId: user.sub,
        postings: [
          { ownerType: "customer", ownerId: user.sub, purpose: "wallet_payable", environment, amount: -amount },
          { ownerType: "platform", ownerId: "peebee", purpose: "merchant_plan_revenue", environment, amount },
        ],
        additionalStatements: statements,
      });
    } else {
      await executeBatch(statements);
    }
  } catch (err) {
    if (amount > 0) await creditWallet(user.sub, amount, { type: "refund", environment, note: `Refund: ${label}` }).catch(() => undefined);
    console.error("plan purchase failed", err);
    return c.json({ error: "plan_change_failed", message: "We couldn't switch your plan, and you were not charged. Please try again." }, 503);
  }

  const updated = (await getMerchantStore(merchantId))!;
  const planInfo = await storePlan(updated, settings);
  return c.json({
    ok: true, tier, expiresAt, amountPaid: amount,
    store: { ...updated, pro_tier: planInfo.isElite ? "elite" : planInfo.plan === "merchant" ? "free" : planInfo.plan, elite_tier: planInfo.isElite ? 1 : 0, plan: planInfo },
  });
});

// 4. Products Management
marketplaceRoutes.get("/merchants/me/products", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ products: [] });

  const productsRes = await db.execute({
    sql: "SELECT * FROM store_products WHERE store_id = ? AND status != 'archived' ORDER BY sort_order, created_at DESC",
    args: [String(store.id)],
  });

  const variantsRes = await db.execute({
    sql: `SELECT v.* FROM store_product_variants v
          JOIN store_products p ON p.id = v.product_id
          WHERE p.store_id = ? ORDER BY v.created_at`,
    args: [String(store.id)],
  });

  const variantsByProduct: Record<string, any[]> = {};
  for (const v of variantsRes.rows as Row[]) {
    const pid = String(v.product_id);
    variantsByProduct[pid] = variantsByProduct[pid] || [];
    variantsByProduct[pid].push(v);
  }

  const products = productsRes.rows.map((p) => ({
    ...p,
    variants: variantsByProduct[String(p.id)] || [],
  }));

  return c.json({ products });
});

const productSchema = z.object({
  title: z.string().min(2).max(120),
  description: z.string().max(1000).optional(),
  price: z.number().int().positive(),
  compare_at_price: z.number().int().positive().optional(),
  cost_price: z.number().int().nonnegative().optional(),
  sku: z.string().max(40).optional(),
  barcode: z.string().max(40).optional(),
  track_inventory: z.boolean().default(true),
  inventory_quantity: z.number().int().nonnegative().default(100),
  category_name: z.string().max(60).optional(),
  badge: z.string().max(30).optional(),
  image_url: z.string().url().or(z.string().length(0)).optional(),
  video_url: z.string().url().or(z.string().length(0)).optional(),
  has_variants: z.boolean().default(false),
  variants: z
    .array(
      z.object({
        title: z.string().min(1),
        price: z.number().int().positive(),
        compare_at_price: z.number().int().positive().optional(),
        sku: z.string().optional(),
        inventory_quantity: z.number().int().nonnegative().default(100),
      })
    )
    .optional(),
});

marketplaceRoutes.post("/merchants/me/products", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = productSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  // Enforce admin-configured product limit per tier
  const settings = await getMarketplaceSettings();
  const maxProducts = (await planLimits(await storePlan(store, settings), settings)).products;
  const countRes = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM store_products WHERE store_id = ? AND status != 'archived'",
    args: [String(store.id)],
  });
  if (Number((countRes.rows[0] as Row)?.n || 0) >= maxProducts) {
    return c.json({
      error: "product_limit_reached",
      message: `Your current plan allows up to ${maxProducts} products. Upgrade to Merchant Elite for up to ${settings.eliteMaxProducts} products.`,
    }, 409);
  }

  const productId = newId("prod");
  const slug = slugify(parsed.data.title);

  await db.execute({
    sql: `INSERT INTO store_products (
      id, store_id, title, slug, description, price, compare_at_price,
      cost_price, sku, barcode, track_inventory, inventory_quantity,
      category_name, badge, image_url, video_url, has_variants, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    args: [
      productId,
      String(store.id),
      parsed.data.title,
      slug,
      parsed.data.description || "",
      parsed.data.price,
      parsed.data.compare_at_price || null,
      parsed.data.cost_price || null,
      parsed.data.sku || "",
      parsed.data.barcode || "",
      parsed.data.track_inventory ? 1 : 0,
      parsed.data.inventory_quantity,
      parsed.data.category_name || "General",
      parsed.data.badge || "",
      parsed.data.image_url || "",
      parsed.data.video_url || "",
      parsed.data.has_variants ? 1 : 0,
    ],
  });

  if (parsed.data.has_variants && parsed.data.variants && parsed.data.variants.length > 0) {
    for (const v of parsed.data.variants) {
      await db.execute({
        sql: `INSERT INTO store_product_variants (
          id, product_id, title, price, compare_at_price, sku, inventory_quantity
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          newId("var"),
          productId,
          v.title,
          v.price,
          v.compare_at_price || null,
          v.sku || "",
          v.inventory_quantity,
        ],
      });
    }
  }

  return c.json({ ok: true, productId });
});

// 5. 1-Click Catalog Starter Pack (Snake-game chap-chap speed)
marketplaceRoutes.post("/merchants/me/products/starter-pack", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);

  const category = String(store.category);
  const starterItems =
    category === "groceries"
      ? [
          {
            title: "Fresh Whole Milk (1L)",
            category: "Dairy & Eggs",
            price: 3500,
            compare_at_price: 4000,
            cost_price: 2600,
            badge: "Fresh Daily",
            image_url: "https://images.unsplash.com/photo-1550583724-b2692b85b150?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Farm Fresh Eggs",
            category: "Dairy & Eggs",
            price: 13500,
            compare_at_price: 15000,
            cost_price: 10500,
            badge: "Popular",
            image_url: "https://images.unsplash.com/photo-1582722872445-44dc5f7e3c8f?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Super White Sliced Bread (400g)",
            category: "Bakery",
            price: 4500,
            cost_price: 3400,
            badge: "Baked Today",
            image_url: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Pure White Sugar (1kg)",
            category: "Pantry Staples",
            price: 5000,
            cost_price: 4000,
            image_url: "https://images.unsplash.com/photo-1581441363689-1f3c3c414635?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Pure Vegetable Cooking Oil (2 Litres)",
            category: "Pantry Staples",
            price: 16500,
            compare_at_price: 18000,
            cost_price: 13200,
            badge: "Special Offer",
            image_url: "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Sweet Cavendish Bananas (Bunch)",
            category: "Fresh Produce",
            price: 4000,
            cost_price: 2500,
            badge: "Organic",
            image_url: "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?auto=format&fit=crop&w=600&q=80",
          },
        ]
      : [
          {
            title: "Premium Heavyweight Cotton T-Shirt",
            category: "Apparel",
            price: 45000,
            compare_at_price: 55000,
            cost_price: 25000,
            badge: "Best Seller",
            image_url: "https://images.unsplash.com/photo-1521572267360-ee0c2909d518?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Slim Stretch Denim Jeans",
            category: "Apparel",
            price: 75000,
            compare_at_price: 90000,
            cost_price: 45000,
            badge: "Top Rated",
            image_url: "https://images.unsplash.com/photo-1542272604-780c96856592?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Classic Low-Top Canvas Sneakers",
            category: "Footwear",
            price: 85000,
            compare_at_price: 110000,
            cost_price: 52000,
            badge: "Sale",
            image_url: "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Minimalist Leather Bifold Wallet",
            category: "Accessories",
            price: 35000,
            cost_price: 18000,
            image_url: "https://images.unsplash.com/photo-1627123424574-724758594e93?auto=format&fit=crop&w=600&q=80",
          },
          {
            title: "Wireless Bluetooth Earbuds with ANC",
            category: "Gadgets",
            price: 95000,
            compare_at_price: 120000,
            cost_price: 58000,
            badge: "Trending",
            image_url: "https://images.unsplash.com/photo-1590658268037-6bf12165a8df?auto=format&fit=crop&w=600&q=80",
          },
        ];

  let addedCount = 0;
  for (const item of starterItems) {
    const pid = newId("prod");
    await db.execute({
      sql: `INSERT INTO store_products (
        id, store_id, title, slug, description, price, compare_at_price, cost_price,
        track_inventory, inventory_quantity, category_name, badge, image_url, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 50, ?, ?, ?, 'active')`,
      args: [
        pid,
        String(store.id),
        item.title,
        slugify(item.title),
        `Authentic quality ${item.title}. Carefully selected and inspected.`,
        item.price,
        item.compare_at_price || null,
        item.cost_price || null,
        item.category,
        item.badge || "",
        item.image_url,
      ],
    });
    addedCount++;
  }

  return c.json({ ok: true, addedCount });
});

// 6. TikTok Live Studio Endpoints
marketplaceRoutes.post("/merchants/me/store/live/start", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);

  const liveSettings = await getMarketplaceSettings();
  if (!liveSettings.liveEnabled) return c.json({ error: "live_disabled", message: "Live selling is disabled by the platform." }, 403);
  const livePlan = await storePlan(store, liveSettings);
  if (livePlan.plan !== "pro_live" && !livePlan.isElite) return c.json({ error: "plan_required", requiredPlan: "pro_live", message: "Live selling requires Merchant Pro or Elite." }, 403);
  const body = await c.req.json().catch(() => ({}));
  const sessionId = newId("live");
  const title = body.title || `${store.name} Live Showcase! ✨`;
  const streamUrl = typeof body.streamUrl === "string" ? body.streamUrl.trim() : "";
  if (!streamUrl || !/^https:\/\//i.test(streamUrl)) return c.json({ error: "stream_required", message: "Connect an HTTPS stream URL before starting live selling." }, 400);
  const isRestream = body.isRestream ? 1 : 0;

  await db.execute({
    sql: `INSERT INTO store_live_sessions (
      id, store_id, title, status, stream_url, is_restream, started_at
    ) VALUES (?, ?, ?, 'live', ?, ?, datetime('now'))`,
    args: [sessionId, store.id, title, streamUrl, isRestream],
  });

  await db.execute({
    sql: `UPDATE stores SET
      is_live = 1,
      live_channel_title = ?,
      live_stream_url = ?,
      live_started_at = datetime('now'),
      live_viewer_count = 1
      WHERE id = ?`,
    args: [title, streamUrl, store.id],
  });

  return c.json({ ok: true, sessionId });
});

marketplaceRoutes.post("/merchants/me/store/live/end", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);

  await db.execute({
    sql: `UPDATE store_live_sessions SET status = 'ended', ended_at = datetime('now')
          WHERE store_id = ? AND status = 'live'`,
    args: [String(store.id)],
  });

  await db.execute({
    sql: `UPDATE stores SET is_live = 0, live_viewer_count = 0 WHERE id = ?`,
    args: [String(store.id)],
  });

  return c.json({ ok: true });
});

// ---------------------------------------------------------------------------
// 7. Merchant Elite (Shopify / Shopify Plus) — Collections, Discounts,
//    Multi-Outlet Inventory Matrix, B2B Draft Orders & Profit Analytics
// ---------------------------------------------------------------------------

// 7a. Smart & Manual Collections
marketplaceRoutes.get("/merchants/me/collections", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_collections"))) return c.json({ collections: [] });

  const [colRes, prodRes] = await Promise.all([
    db.execute({
      sql: "SELECT * FROM store_collections WHERE store_id = ? AND status != 'archived' ORDER BY pinned DESC, sort_order, created_at DESC",
      args: [String(store.id)],
    }),
    db.execute({
      sql: "SELECT id, category_name, price, badge, inventory_quantity FROM store_products WHERE store_id = ? AND status = 'active'",
      args: [String(store.id)],
    }),
  ]);

  const products = prodRes.rows as Row[];
  const collections = (colRes.rows as Row[]).map((col) => {
    let matchingCount = products.length;
    if (col.kind === "smart" && col.rule_field) {
      const val = String(col.rule_value || "").toLowerCase();
      matchingCount = products.filter((p) => {
        if (col.rule_field === "category") return String(p.category_name || "").toLowerCase().includes(val);
        if (col.rule_field === "badge") return String(p.badge || "").toLowerCase().includes(val);
        if (col.rule_field === "price_lte") return Number(p.price || 0) <= (Number(col.rule_value) || 0);
        if (col.rule_field === "price_gte") return Number(p.price || 0) >= (Number(col.rule_value) || 0);
        if (col.rule_field === "in_stock") return Number(p.inventory_quantity || 0) > 0;
        return true;
      }).length;
    }
    return { ...col, matching_products_count: matchingCount };
  });

  return c.json({ collections });
});

const collectionSchema = z.object({
  title: z.string().min(2).max(80),
  description: z.string().max(300).optional(),
  kind: z.enum(["manual", "smart"]).default("smart"),
  rule_field: z.enum(["category", "price_lte", "price_gte", "badge", "in_stock"]).nullable().optional(),
  rule_value: z.string().max(80).nullable().optional(),
  pinned: z.boolean().default(true),
});

marketplaceRoutes.post("/merchants/me/collections", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasTable("store_collections"))) {
    return c.json({ error: "migration_pending", message: "Collections table migration is pending." }, 503);
  }

  const parsed = collectionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const settings = await getMarketplaceSettings();
  const maxCols = (await planLimits(await storePlan(store, settings), settings)).collections;
  const countRes = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM store_collections WHERE store_id = ? AND status != 'archived'",
    args: [String(store.id)],
  });
  if (Number((countRes.rows[0] as Row)?.n || 0) >= maxCols) {
    return c.json({
      error: "collection_limit_reached",
      message: `Your current plan allows up to ${maxCols} collections. Upgrade to Merchant Elite for up to ${settings.eliteMaxCollections} collections.`,
    }, 409);
  }

  const id = newId("col");
  const slug = slugify(parsed.data.title);
  await db.execute({
    sql: `INSERT INTO store_collections (id, store_id, title, slug, description, kind, rule_field, rule_value, pinned, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
    args: [
      id,
      String(store.id),
      parsed.data.title,
      slug,
      parsed.data.description || "",
      parsed.data.kind,
      parsed.data.rule_field ?? null,
      parsed.data.rule_value ?? null,
      parsed.data.pinned ? 1 : 0,
    ],
  });

  return c.json({ ok: true, id }, 201);
});

marketplaceRoutes.delete("/merchants/me/collections/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);
  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_collections"))) return c.json({ ok: true });

  await db.execute({
    sql: "DELETE FROM store_collections WHERE id = ? AND store_id = ?",
    args: [String(c.req.param("id")), String(store.id)],
  });
  return c.json({ ok: true });
});

// 7b. Promo Codes & Automatic Discounts Engine
marketplaceRoutes.get("/merchants/me/discounts", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_discounts"))) return c.json({ discounts: [] });

  const res = await db.execute({
    sql: "SELECT * FROM store_discounts WHERE store_id = ? ORDER BY created_at DESC",
    args: [String(store.id)],
  });
  return c.json({ discounts: res.rows });
});

const discountSchema = z.object({
  code: z.string().min(2).max(32),
  title: z.string().min(2).max(100),
  kind: z.enum(["percent", "fixed", "free_delivery", "bogo"]),
  value: z.number().int().nonnegative().default(0),
  min_order_amount: z.number().int().nonnegative().default(0),
  max_uses: z.number().int().positive().nullable().optional(),
  is_automatic: z.boolean().default(false),
  /** List this code on the public web store (needs the admin option "flagged_public"). */
  is_public: z.boolean().default(false),
  /** When the offer ends: a date (2030-12-31) or a full ISO time. */
  expires_at: z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), "Not a valid date").nullable().optional(),
});

marketplaceRoutes.post("/merchants/me/discounts", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasTable("store_discounts"))) {
    return c.json({ error: "migration_pending", message: "Discounts table migration is pending." }, 503);
  }

  const parsed = discountSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  if (parsed.data.kind === "percent" && (parsed.data.value < 1 || parsed.data.value > 95)) {
    return c.json({ error: "invalid_discount_percent", message: "Percentage discount must be between 1% and 95%." }, 400);
  }

  const settings = await getMarketplaceSettings();
  const maxDiscounts = (await planLimits(await storePlan(store, settings), settings)).discounts;
  const countRes = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM store_discounts WHERE store_id = ? AND status = 'active'",
    args: [String(store.id)],
  });
  if (Number((countRes.rows[0] as Row)?.n || 0) >= maxDiscounts) {
    return c.json({
      error: "discount_limit_reached",
      message: `Your current plan allows up to ${maxDiscounts} active promotions. Upgrade to Merchant Elite for up to ${settings.eliteMaxDiscounts} promotions.`,
    }, 409);
  }

  const id = newId("dsc");
  const hasPublicCol = await hasColumn("store_discounts", "is_public");
  await db.execute({
    sql: `INSERT INTO store_discounts (id, store_id, code, title, kind, value, min_order_amount, max_uses, is_automatic, expires_at${hasPublicCol ? ", is_public" : ""}, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?${hasPublicCol ? ", ?" : ""}, 'active')`,
    args: [
      id,
      String(store.id),
      parsed.data.code.trim().toUpperCase(),
      parsed.data.title.trim(),
      parsed.data.kind,
      parsed.data.value,
      parsed.data.min_order_amount,
      parsed.data.max_uses ?? null,
      parsed.data.is_automatic ? 1 : 0,
      parsed.data.expires_at ? new Date(parsed.data.expires_at).toISOString() : null,
      ...(hasPublicCol ? [parsed.data.is_public ? 1 : 0] : []),
    ],
  });

  return c.json({ ok: true, id }, 201);
});

marketplaceRoutes.delete("/merchants/me/discounts/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);
  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_discounts"))) return c.json({ ok: true });

  await db.execute({
    sql: "DELETE FROM store_discounts WHERE id = ? AND store_id = ?",
    args: [String(c.req.param("id")), String(store.id)],
  });
  return c.json({ ok: true });
});

// 7c. Multi-Outlet Inventory Matrix
marketplaceRoutes.get("/merchants/me/outlet-inventory", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ outlets: [], inventory: [] });

  const outletsRes = await db.execute({
    sql: "SELECT id, name, code, address, status FROM merchant_outlets WHERE merchant_id = ? ORDER BY created_at",
    args: [merchantId],
  });

  if (!(await hasTable("store_outlet_inventory"))) {
    return c.json({ outlets: outletsRes.rows, inventory: [] });
  }

  const invRes = await db.execute({
    sql: `SELECT i.*, p.title AS product_title, o.name AS outlet_name
          FROM store_outlet_inventory i
          JOIN store_products p ON p.id = i.product_id
          JOIN merchant_outlets o ON o.id = i.outlet_id
          WHERE i.store_id = ?`,
    args: [String(store.id)],
  });

  return c.json({ outlets: outletsRes.rows, inventory: invRes.rows });
});

const outletInventorySchema = z.object({
  productId: z.string().min(1),
  outletId: z.string().min(1),
  quantity: z.number().int().nonnegative(),
  lowStockThreshold: z.number().int().nonnegative().default(5),
});

marketplaceRoutes.put("/merchants/me/outlet-inventory", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasTable("store_outlet_inventory"))) {
    return c.json({ error: "migration_pending", message: "Multi-outlet inventory migration is pending." }, 503);
  }

  const parsed = outletInventorySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  if (!(await ownsStockResources(String(store.id), merchantId, parsed.data.productId, [parsed.data.outletId]))) {
    return c.json({ error: "not_found", message: "Product or outlet not found in this business." }, 404);
  }
  await executeBatch([{
    sql: `INSERT INTO store_outlet_inventory (id, store_id, product_id, outlet_id, quantity, low_stock_threshold, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
          ON CONFLICT(product_id, outlet_id) DO UPDATE SET
            quantity = excluded.quantity,
            low_stock_threshold = excluded.low_stock_threshold,
            updated_at = datetime('now') WHERE store_outlet_inventory.store_id = excluded.store_id`,
    args: [
      newId("inv"),
      String(store.id),
      parsed.data.productId,
      parsed.data.outletId,
      parsed.data.quantity,
      parsed.data.lowStockThreshold,
    ],
  }, {
    sql: "UPDATE store_products SET inventory_quantity = (SELECT COALESCE(SUM(quantity), 0) FROM store_outlet_inventory WHERE store_id = ? AND product_id = ?), updated_at = datetime('now') WHERE id = ? AND store_id = ?",
    args: [String(store.id), parsed.data.productId, parsed.data.productId, String(store.id)],
  }]);
  const sumRes = await db.execute({sql: "SELECT inventory_quantity AS total FROM store_products WHERE id = ? AND store_id = ?", args: [parsed.data.productId, String(store.id)]});
  const totalQty = Number(sumRes.rows[0]?.total ?? 0);

  return c.json({ ok: true, totalQuantity: totalQty });
});

async function ownsStockResources(storeId: string, merchantId: string, productId: string, outletIds: string[]): Promise<boolean> {
  const product = await db.execute({ sql: "SELECT 1 FROM store_products WHERE id = ? AND store_id = ?", args: [productId, storeId] });
  if (!product.rows.length) return false;
  for (const outletId of outletIds) {
    const outlet = await db.execute({ sql: "SELECT 1 FROM merchant_outlets WHERE id = ? AND merchant_id = ? AND status = 'active'", args: [outletId, merchantId] });
    if (!outlet.rows.length) return false;
  }
  return true;
}

// 7d. B2B Wholesale & Draft Orders / 1-Tap Payment Links
marketplaceRoutes.get("/merchants/me/draft-orders", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_draft_orders"))) return c.json({ draftOrders: [] });

  const res = await db.execute({
    sql: "SELECT * FROM store_draft_orders WHERE store_id = ? ORDER BY created_at DESC LIMIT 100",
    args: [String(store.id)],
  });

  const draftOrders = (res.rows as Row[]).map((r) => {
    let items: any[] = [];
    try {
      items = JSON.parse(String(r.items_json || "[]"));
    } catch {
      items = [];
    }
    return { ...r, items };
  });

  return c.json({ draftOrders });
});

const draftOrderSchema = z.object({
  customer_name: z.string().min(2).max(120),
  customer_phone: z.string().max(30).optional(),
  customer_company: z.string().max(120).optional(),
  items: z.array(
    z.object({
      productId: z.string(),
      title: z.string(),
      unitPrice: z.number().int().nonnegative(),
      quantity: z.number().int().positive(),
    })
  ).min(1),
  discount_amount: z.number().int().nonnegative().default(0),
  payment_terms: z.enum(["immediate", "net_7", "net_14", "net_30"]).default("immediate"),
  notes: z.string().max(500).optional(),
});

marketplaceRoutes.post("/merchants/me/draft-orders", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasTable("store_draft_orders"))) {
    return c.json({ error: "migration_pending", message: "Draft orders migration is pending." }, 503);
  }

  const settings = await getMarketplaceSettings();
  if (!settings.eliteB2bEnabled) {
    return c.json({ error: "b2b_disabled", message: "B2B Wholesale & Draft Orders are currently disabled by platform admin." }, 403);
  }

  const parsed = draftOrderSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const subtotal = parsed.data.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  const discount = Math.min(subtotal, parsed.data.discount_amount);
  const total = Math.max(0, subtotal - discount);

  const id = newId("drf");
  await db.execute({
    sql: `INSERT INTO store_draft_orders (
            id, store_id, customer_name, customer_phone, customer_company,
            items_json, subtotal_amount, discount_amount, total_amount,
            payment_terms, notes, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sent')`,
    args: [
      id,
      String(store.id),
      parsed.data.customer_name.trim(),
      parsed.data.customer_phone?.trim() || null,
      parsed.data.customer_company?.trim() || null,
      JSON.stringify(parsed.data.items),
      subtotal,
      discount,
      total,
      parsed.data.payment_terms,
      parsed.data.notes?.trim() || null,
    ],
  });

  return c.json({ ok: true, id, total }, 201);
});

// 7e. Executive P&L, Margin & Inventory Analytics
marketplaceRoutes.get("/merchants/me/elite-analytics", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);

  const settings = await getMarketplaceSettings();
  const commissionRate = (await planLimits(await storePlan(store, settings), settings)).commissionPercent;

  const prodRes = await db.execute({
    sql: "SELECT price, cost_price, inventory_quantity FROM store_products WHERE store_id = ? AND status != 'archived'",
    args: [String(store.id)],
  });
  const products = prodRes.rows as Row[];
  const totalProducts = products.length;
  const totalStockUnits = products.reduce((sum, p) => sum + Number(p.inventory_quantity || 0), 0);
  const lowStockCount = products.filter((p) => Number(p.inventory_quantity || 0) <= 5).length;

  // A deliberately scoped report: recorded POS sales only. Current catalog costs are estimates,
  // never invented historical COGS. Missing costs make contribution unavailable, not an assumed profit.
  const posRows = await hasTable("store_pos_sales")
    ? (await db.execute({sql: "SELECT total_amount, items_json FROM store_pos_sales WHERE store_id = ?", args: [String(store.id)]})).rows : [];
  const costRows = await db.execute({sql: "SELECT id, cost_price FROM store_products WHERE store_id = ?", args: [String(store.id)]});
  const costs = new Map(costRows.rows.map(p => [String(p.id), p.cost_price == null ? null : Number(p.cost_price)]));
  let costSum = 0;
  let completeCosts = true;
  for (const sale of posRows) {
    try {
      const items = JSON.parse(String(sale.items_json));
      if (!Array.isArray(items) || !items.length) { completeCosts = false; continue; }
      for (const item of items) {
        const cost = costs.get(String(item.productId));
        const quantity = Number(item.quantity);
        if (cost == null || !Number.isFinite(cost) || !Number.isFinite(quantity) || quantity <= 0) completeCosts = false;
        else costSum += cost * quantity;
      }
    } catch { completeCosts = false; }
  }
  const grossRevenueUgx = posRows.reduce((sum, row) => sum + Number(row.total_amount || 0), 0);
  const estimatedCogsUgx = completeCosts ? Math.round(costSum) : null;
  const platformCommissionUgx = Math.round(grossRevenueUgx * commissionRate / 100);
  const netMarginUgx = estimatedCogsUgx == null ? null : grossRevenueUgx - estimatedCogsUgx - platformCommissionUgx;
  const netMarginPercent = netMarginUgx == null || grossRevenueUgx === 0 ? null : Math.round(netMarginUgx / grossRevenueUgx * 1000) / 10;

  let activeCollectionsCount = 0;
  if (await hasTable("store_collections")) {
    const colRes = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM store_collections WHERE store_id = ? AND status = 'active'",
      args: [String(store.id)],
    });
    activeCollectionsCount = Number((colRes.rows[0] as Row)?.n || 0);
  }

  let activeDiscountsCount = 0;
  if (await hasTable("store_discounts")) {
    const dscRes = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM store_discounts WHERE store_id = ? AND status = 'active'",
      args: [String(store.id)],
    });
    activeDiscountsCount = Number((dscRes.rows[0] as Row)?.n || 0);
  }

  let openDraftOrdersCount = 0;
  let b2bPipelineUgx = 0;
  if (await hasTable("store_draft_orders")) {
    const drfRes = await db.execute({
      sql: "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS total FROM store_draft_orders WHERE store_id = ? AND status IN ('open', 'sent')",
      args: [String(store.id)],
    });
    openDraftOrdersCount = Number((drfRes.rows[0] as Row)?.n || 0);
    b2bPipelineUgx = Number((drfRes.rows[0] as Row)?.total || 0);
  }

  let posSalesCount = 0;
  let posRevenueUgx = 0;
  if (await hasTable("store_pos_sales")) {
    const posRes = await db.execute({
      sql: "SELECT COUNT(*) AS n, COALESCE(SUM(total_amount), 0) AS total FROM store_pos_sales WHERE store_id = ?",
      args: [String(store.id)],
    });
    posSalesCount = Number((posRes.rows[0] as Row)?.n || 0);
    posRevenueUgx = Number((posRes.rows[0] as Row)?.total || 0);
  }

  let vipCustomersCount = 0;
  let loyaltyBalanceLiabilityUgx = 0;
  if (await hasTable("store_customer_loyalty")) {
    const crmRes = await db.execute({
      sql: "SELECT COALESCE(SUM(CASE WHEN tier IN ('vip', 'b2b') THEN 1 ELSE 0 END), 0) AS vips, COALESCE(SUM(points_balance_ugx), 0) AS liability FROM store_customer_loyalty WHERE store_id = ?",
      args: [String(store.id)],
    });
    vipCustomersCount = Number((crmRes.rows[0] as Row)?.vips || 0);
    loyaltyBalanceLiabilityUgx = Number((crmRes.rows[0] as Row)?.liability || 0);
  }

  let stockTransfersCount = 0;
  if (await hasTable("store_stock_transfers")) {
    const trfRes = await db.execute({
      sql: "SELECT COUNT(*) AS n FROM store_stock_transfers WHERE store_id = ? AND status = 'completed'",
      args: [String(store.id)],
    });
    stockTransfersCount = Number((trfRes.rows[0] as Row)?.n || 0);
  }

  return c.json({
    analytics: {
      grossRevenueUgx,
      scope: "all_time_recorded_pos",
      costsComplete: completeCosts,
      estimatedCogsUgx,
      platformCommissionUgx,
      netMarginUgx,
      netMarginPercent,
      totalProducts,
      totalStockUnits,
      lowStockCount,
      activeCollectionsCount,
      activeDiscountsCount,
      openDraftOrdersCount,
      b2bPipelineUgx,
      posSalesCount,
      posRevenueUgx,
      vipCustomersCount,
      loyaltyBalanceLiabilityUgx,
      stockTransfersCount,
    },
  });
});

// ---------------------------------------------------------------------------
// 7f. Omnichannel In-Store POS Register (Walk-in Cashier Checkout + Inventory Sync)
// ---------------------------------------------------------------------------
marketplaceRoutes.get("/merchants/me/pos-sales", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_pos_sales"))) return c.json({ sales: [] });

  const res = await db.execute({
    sql: `SELECT s.*, o.name AS outlet_name
          FROM store_pos_sales s
          LEFT JOIN merchant_outlets o ON o.id = s.outlet_id
          WHERE s.store_id = ?
          ORDER BY s.created_at DESC LIMIT 100`,
    args: [String(store.id)],
  });

  const sales = (res.rows as Row[]).map((r) => {
    let items: any[] = [];
    try {
      items = JSON.parse(String(r.items_json || "[]"));
    } catch {
      items = [];
    }
    return { ...r, items };
  });

  return c.json({ sales });
});

const posSaleSchema = z.object({
  requestId: z.string().uuid().optional(),
  outlet_id: z.string().nullable().optional(),
  customer_phone: z.string().max(30).optional(),
  customer_name: z.string().max(120).optional(),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        title: z.string().min(1),
        unitPrice: z.number().int().nonnegative(),
        quantity: z.number().int().positive(),
      }),
    )
    .min(1),
  discount_amount: z.number().int().nonnegative().default(0),
  redeem_loyalty_ugx: z.number().int().nonnegative().default(0),
  payment_method: z.enum(["peebee_code", "momo", "cash"]).default("peebee_code"),
});

marketplaceRoutes.post("/merchants/me/pos-sales", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasTable("store_pos_sales"))) {
    return c.json({ error: "migration_pending", message: "POS sales table migration is pending." }, 503);
  }

  const settings = await getMarketplaceSettings();
  if (!settings.elitePosEnabled) {
    return c.json({ error: "pos_disabled", message: "Omnichannel POS Register is currently disabled by platform admin." }, 403);
  }

  const parsed = posSaleSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const saleId = parsed.data.requestId ? `pos_${String(store.id)}_${parsed.data.requestId}` : newId("pos");
  const replay = async () => {
    const row = (await db.execute({sql: "SELECT * FROM store_pos_sales WHERE id = ? AND store_id = ?", args: [saleId, String(store.id)]})).rows[0];
    if (!row) return null;
    if (String(row.items_json) !== JSON.stringify(parsed.data!.items) || String(row.payment_method) !== parsed.data!.payment_method || Number(row.discount_amount) !== parsed.data!.discount_amount || String(row.outlet_id ?? "") !== String(parsed.data!.outlet_id ?? "")) return c.json({error: "request_id_reused", message: "This request ID already belongs to a different sale."}, 409);
    const loyalty = row.customer_phone && await hasTable("store_customer_loyalty") ? (await db.execute({sql: "SELECT points_balance_ugx FROM store_customer_loyalty WHERE store_id = ? AND customer_phone = ?", args: [String(store.id), String(row.customer_phone)]})).rows[0] : null;
    return c.json({ok: true, saleId, receiptCode: String(row.receipt_code), total: Number(row.total_amount), loyaltyRedeemedUgx: Number(row.loyalty_redeemed_ugx), loyaltyEarnedUgx: Number(row.loyalty_earned_ugx), loyaltyBalanceAfterUgx: Number(loyalty?.points_balance_ugx ?? 0)});
  };
  if (parsed.data.requestId) { const previous = await replay(); if (previous) return previous; }

  const allowManualPrices = Boolean(await getOption("merchant_pos_manual_prices"));
  if (!allowManualPrices) {
    for (const item of parsed.data.items) {
      const product = (await db.execute({sql: "SELECT price FROM store_products WHERE id = ? AND store_id = ?", args: [item.productId, String(store.id)]})).rows[0];
      if (!product) return c.json({error: "not_found", message: "Product not found in this business."}, 404);
      if (Number(product.price) !== item.unitPrice) return c.json({error: "price_changed", message: "Use the current catalog price. Manual POS prices are disabled by the platform."}, 409);
    }
  }
  const quantities = new Map<string, number>();
  for (const item of parsed.data.items) quantities.set(item.productId, (quantities.get(item.productId) ?? 0) + item.quantity);
  const hasOutletInv = await hasTable("store_outlet_inventory");
  const writes: DbStatement[] = [];
  for (const [productId, quantity] of quantities) {
    if (!(await ownsStockResources(String(store.id), merchantId, productId, parsed.data.outlet_id ? [parsed.data.outlet_id] : []))) return c.json({error: "not_found", message: "Product or outlet not found in this business."}, 404);
    if (!parsed.data.outlet_id && hasOutletInv && (await db.execute({sql: "SELECT 1 FROM store_outlet_inventory WHERE store_id = ? AND product_id = ? LIMIT 1", args: [String(store.id), productId]})).rows.length) {
      return c.json({error: "outlet_required", message: "Select the branch supplying this product so branch and total stock stay consistent."}, 409);
    }
    writes.push({sql: "UPDATE store_products SET inventory_quantity = inventory_quantity - ?, updated_at = datetime('now') WHERE id = ? AND store_id = ? AND inventory_quantity >= ?", args: [quantity, productId, String(store.id), quantity]}, requireChangedRow);
    if (parsed.data.outlet_id) {
      if (!hasOutletInv) return c.json({error: "migration_pending", message: "Outlet stock is being set up."}, 503);
      writes.push({sql: "UPDATE store_outlet_inventory SET quantity = quantity - ?, updated_at = datetime('now') WHERE store_id = ? AND product_id = ? AND outlet_id = ? AND quantity >= ?", args: [quantity, String(store.id), productId, parsed.data.outlet_id, quantity]}, requireChangedRow);
    }
  }
  const subtotal = parsed.data.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  const discount = Math.min(subtotal, parsed.data.discount_amount);
  const afterDiscount = Math.max(0, subtotal - discount);

  const cleanPhone = parsed.data.customer_phone?.trim() || "";
  const cleanName = parsed.data.customer_name?.trim() || null;

  let loyaltyRedeemedUgx = 0;
  let loyaltyEarnedUgx = 0;
  let loyaltyBalanceAfterUgx = 0;

  if (cleanPhone && (await hasTable("store_customer_loyalty"))) {
    const existingRes = await db.execute({
      sql: "SELECT * FROM store_customer_loyalty WHERE store_id = ? AND customer_phone = ? LIMIT 1",
      args: [String(store.id), cleanPhone],
    });
    const existing = existingRes.rows[0] as Row | undefined;
    const currentPoints = Number(existing?.points_balance_ugx || 0);

    if (parsed.data.redeem_loyalty_ugx > 0 && currentPoints > 0) {
      loyaltyRedeemedUgx = Math.min(parsed.data.redeem_loyalty_ugx, currentPoints, afterDiscount);
    }

    const finalTotal = Math.max(0, afterDiscount - loyaltyRedeemedUgx);
    if (settings.eliteLoyaltyEnabled && Number(store.loyalty_enabled || 0) === 1 && finalTotal > 0) {
      const pct = Math.min(Number(store.loyalty_cashback_percent || 0), settings.eliteMaxLoyaltyCashbackPercent);
      if (pct > 0) {
        loyaltyEarnedUgx = Math.round((finalTotal * pct) / 100);
      }
    }

    loyaltyBalanceAfterUgx = Math.max(0, currentPoints - loyaltyRedeemedUgx + loyaltyEarnedUgx);
    const nextOrdersCount = Number(existing?.orders_count || 0) + 1;
    const nextTotalSpent = Number(existing?.total_spent_ugx || 0) + finalTotal;
    const nextTier =
      existing?.tier === "b2b"
        ? "b2b"
        : nextTotalSpent >= 200_000 || nextOrdersCount >= 5
          ? "vip"
          : nextOrdersCount >= 2
            ? "repeat"
            : "standard";

    writes.push({
      sql: `INSERT INTO store_customer_loyalty (
              id, store_id, customer_phone, customer_name, points_balance_ugx,
              total_earned_ugx, total_redeemed_ugx, orders_count, total_spent_ugx,
              tier, last_order_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            ON CONFLICT(store_id, customer_phone) DO UPDATE SET
              customer_name = COALESCE(excluded.customer_name, store_customer_loyalty.customer_name),
              points_balance_ugx = ?,
              total_earned_ugx = store_customer_loyalty.total_earned_ugx + ?,
              total_redeemed_ugx = store_customer_loyalty.total_redeemed_ugx + ?,
              orders_count = ?,
              total_spent_ugx = ?,
              tier = ?,
              last_order_at = datetime('now') WHERE store_customer_loyalty.points_balance_ugx = ? AND store_customer_loyalty.orders_count = ?`,
      args: [
        newId("crm"),
        String(store.id),
        cleanPhone,
        cleanName,
        loyaltyBalanceAfterUgx,
        loyaltyEarnedUgx,
        loyaltyRedeemedUgx,
        nextOrdersCount,
        nextTotalSpent,
        nextTier,
        loyaltyBalanceAfterUgx,
        loyaltyEarnedUgx,
        loyaltyRedeemedUgx,
        nextOrdersCount,
        nextTotalSpent,
        nextTier,
        currentPoints,
        Number(existing?.orders_count || 0),
      ],
    }, requireChangedRow);
  }

  const totalAmount = Math.max(0, afterDiscount - loyaltyRedeemedUgx);
  const receiptCode = `POS-${saleId.slice(-6).toUpperCase()}`;

  writes.push({
    sql: `INSERT INTO store_pos_sales (
            id, store_id, outlet_id, cashier_user_id, customer_phone, customer_name,
            items_json, subtotal_amount, discount_amount, loyalty_redeemed_ugx,
            loyalty_earned_ugx, total_amount, payment_method, receipt_code
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      saleId,
      String(store.id),
      parsed.data.outlet_id || null,
      user.sub,
      cleanPhone || null,
      cleanName,
      JSON.stringify(parsed.data.items),
      subtotal,
      discount,
      loyaltyRedeemedUgx,
      loyaltyEarnedUgx,
      totalAmount,
      parsed.data.payment_method,
      receiptCode,
    ],
  });

  try { await executeBatch(writes); }
  catch (error) {
    if (parsed.data.requestId) { const previous = await replay(); if (previous) return previous; }
    if (/JSON path|bad path|malformed JSON/i.test(String(error))) return c.json({error: "stock_or_loyalty_changed", message: "Insufficient stock or loyalty balance changed. Refresh and try again."}, 409);
    throw error;
  }

  return c.json(
    {
      ok: true,
      saleId,
      receiptCode,
      total: totalAmount,
      loyaltyRedeemedUgx,
      loyaltyEarnedUgx,
      loyaltyBalanceAfterUgx,
    },
    201,
  );
});

// ---------------------------------------------------------------------------
// 7g. Branch-to-Branch Stock Transfers (Multi-Outlet Inventory Movement)
// ---------------------------------------------------------------------------
marketplaceRoutes.get("/merchants/me/stock-transfers", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_stock_transfers"))) return c.json({ transfers: [] });

  const res = await db.execute({
    sql: `SELECT t.*, p.title AS product_title, fo.name AS from_outlet_name, to_o.name AS to_outlet_name
          FROM store_stock_transfers t
          LEFT JOIN store_products p ON p.id = t.product_id
          LEFT JOIN merchant_outlets fo ON fo.id = t.from_outlet_id
          LEFT JOIN merchant_outlets to_o ON to_o.id = t.to_outlet_id
          WHERE t.store_id = ?
          ORDER BY t.created_at DESC LIMIT 100`,
    args: [String(store.id)],
  });

  return c.json({ transfers: res.rows });
});

const stockTransferSchema = z.object({
  requestId: z.string().uuid().optional(),
  productId: z.string().min(1),
  fromOutletId: z.string().min(1),
  toOutletId: z.string().min(1),
  quantity: z.number().int().positive(),
  note: z.string().max(240).optional(),
});

marketplaceRoutes.post("/merchants/me/stock-transfers", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "no_store" }, 404);
  if (!(await hasTable("store_stock_transfers")) || !(await hasTable("store_outlet_inventory"))) {
    return c.json({ error: "migration_pending", message: "Stock transfers migration is pending." }, 503);
  }

  const settings = await getMarketplaceSettings();
  if (!settings.eliteStockTransfersEnabled) {
    return c.json({ error: "stock_transfers_disabled", message: "Branch-to-branch stock transfers are currently disabled by platform admin." }, 403);
  }

  const parsed = stockTransferSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const transferId = parsed.data.requestId ? `trf_${String(store.id)}_${parsed.data.requestId}` : newId("trf");
  const replay = async () => {
    const row = (await db.execute({sql: "SELECT * FROM store_stock_transfers WHERE id = ? AND store_id = ?", args: [transferId, String(store.id)]})).rows[0];
    if (!row) return null;
    if (String(row.product_id) !== parsed.data!.productId || String(row.from_outlet_id) !== parsed.data!.fromOutletId || String(row.to_outlet_id) !== parsed.data!.toOutletId || Number(row.quantity) !== parsed.data!.quantity) return c.json({error: "request_id_reused", message: "This request ID already belongs to a different transfer."}, 409);
    const stock = await db.execute({sql: "SELECT outlet_id, quantity FROM store_outlet_inventory WHERE store_id = ? AND product_id = ?", args: [String(store.id), parsed.data!.productId]});
    return c.json({ok: true, transferId, fromQuantityAfter: Number(stock.rows.find(r => r.outlet_id === parsed.data!.fromOutletId)?.quantity ?? 0), toQuantityAfter: Number(stock.rows.find(r => r.outlet_id === parsed.data!.toOutletId)?.quantity ?? 0)});
  };
  if (parsed.data.requestId) { const previous = await replay(); if (previous) return previous; }
  if (parsed.data.fromOutletId === parsed.data.toOutletId) {
    return c.json({ error: "same_outlet", message: "Source and destination outlets must be different." }, 400);
  }

  const fromRes = await db.execute({
    sql: "SELECT quantity FROM store_outlet_inventory WHERE store_id = ? AND product_id = ? AND outlet_id = ? LIMIT 1",
    args: [String(store.id), parsed.data.productId, parsed.data.fromOutletId],
  });
  const fromQty = Number((fromRes.rows[0] as Row | undefined)?.quantity ?? 0);
  if (fromQty < parsed.data.quantity) {
    return c.json({
      error: "insufficient_outlet_stock",
      message: `Source outlet only has ${fromQty} unit(s) available to transfer.`,
    }, 409);
  }

  if (!(await ownsStockResources(String(store.id), merchantId, parsed.data.productId, [parsed.data.fromOutletId, parsed.data.toOutletId]))) {
    return c.json({ error: "not_found", message: "Product or outlet not found in this business." }, 404);
  }
  try {
    await executeBatch([
      {sql: "UPDATE store_outlet_inventory SET quantity = quantity - ?, updated_at = datetime('now') WHERE store_id = ? AND product_id = ? AND outlet_id = ? AND quantity >= ?", args: [parsed.data.quantity, String(store.id), parsed.data.productId, parsed.data.fromOutletId, parsed.data.quantity]},
      requireChangedRow,
      {sql: `INSERT INTO store_outlet_inventory (id, store_id, product_id, outlet_id, quantity, low_stock_threshold, updated_at)
        VALUES (?, ?, ?, ?, ?, 5, datetime('now')) ON CONFLICT(product_id, outlet_id) DO UPDATE SET
        quantity = store_outlet_inventory.quantity + excluded.quantity, updated_at = datetime('now')
        WHERE store_outlet_inventory.store_id = excluded.store_id`, args: [newId("inv"), String(store.id), parsed.data.productId, parsed.data.toOutletId, parsed.data.quantity]},
      requireChangedRow,
      {sql: "INSERT INTO store_stock_transfers (id, store_id, product_id, from_outlet_id, to_outlet_id, quantity, note, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)", args: [transferId, String(store.id), parsed.data.productId, parsed.data.fromOutletId, parsed.data.toOutletId, parsed.data.quantity, parsed.data.note?.trim() || null, user.sub]},
    ]);
  } catch (error) {
    if (parsed.data.requestId) { const previous = await replay(); if (previous) return previous; }
    if (/JSON path|bad path|malformed JSON/i.test(String(error))) return c.json({error: "stock_changed", message: "Stock changed. Refresh availability and try again."}, 409);
    throw error;
  }
  const quantities = await db.execute({sql: "SELECT outlet_id, quantity FROM store_outlet_inventory WHERE store_id = ? AND product_id = ?", args: [String(store.id), parsed.data.productId]});
  return c.json({ok: true, transferId,
    fromQuantityAfter: Number(quantities.rows.find(r => r.outlet_id === parsed.data.fromOutletId)?.quantity ?? 0),
    toQuantityAfter: Number(quantities.rows.find(r => r.outlet_id === parsed.data.toOutletId)?.quantity ?? 0)}, 201);
});

// ---------------------------------------------------------------------------
// 7h. VIP Customer CRM & Loyalty Cashback Directory
// ---------------------------------------------------------------------------
marketplaceRoutes.get("/merchants/me/crm-customers", requireAuth, async (c) => {
  await settleLoyalty().catch(() => {});
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_customer_loyalty"))) {
    return c.json({
      customers: [],
      summary: { totalCustomers: 0, vipCount: 0, repeatCount: 0, b2bCount: 0, totalLoyaltyBalanceUgx: 0 },
    });
  }

  const res = await db.execute({
    sql: "SELECT * FROM store_customer_loyalty WHERE store_id = ? ORDER BY total_spent_ugx DESC, last_order_at DESC LIMIT 200",
    args: [String(store.id)],
  });
  const customers = res.rows as Row[];
  const vipCount = customers.filter((r) => r.tier === "vip").length;
  const repeatCount = customers.filter((r) => r.tier === "repeat").length;
  const b2bCount = customers.filter((r) => r.tier === "b2b").length;
  const totalLoyaltyBalanceUgx = customers.reduce((sum, r) => sum + Number(r.points_balance_ugx || 0), 0);

  return c.json({
    customers,
    summary: {
      totalCustomers: customers.length,
      vipCount,
      repeatCount,
      b2bCount,
      totalLoyaltyBalanceUgx,
    },
  });
});

// ---------------------------------------------------------------------------
// Merchant Elite Phase 4: Suppliers, Purchase Orders, Bundles & Win-Back
// ---------------------------------------------------------------------------

marketplaceRoutes.get("/merchants/me/suppliers", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_suppliers"))) {
    return c.json({ suppliers: [] });
  }

  const res = await db.execute({
    sql: "SELECT * FROM store_suppliers WHERE store_id = ? ORDER BY name ASC",
    args: [String(store.id)],
  });

  return c.json({ suppliers: res.rows });
});

marketplaceRoutes.post("/merchants/me/suppliers", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_suppliers"))) {
    return c.json({ error: "suppliers_table_not_available" }, 400);
  }

  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return c.json({ error: "name_required" }, 400);

  const id = "sup_" + crypto.randomUUID().slice(0, 12);
  await db.execute({
    sql: `INSERT INTO store_suppliers (id, store_id, name, contact_person, phone, email, address)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      String(store.id),
      name,
      body.contact_person ? String(body.contact_person).trim() : null,
      body.phone ? String(body.phone).trim() : null,
      body.email ? String(body.email).trim() : null,
      body.address ? String(body.address).trim() : null,
    ],
  });

  return c.json({ ok: true, id });
});

marketplaceRoutes.get("/merchants/me/purchase-orders", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_purchase_orders"))) {
    return c.json({ purchaseOrders: [] });
  }

  const res = await db.execute({
    sql: `SELECT po.*, s.name as supplier_name, o.name as outlet_name
          FROM store_purchase_orders po
          LEFT JOIN store_suppliers s ON po.supplier_id = s.id
          LEFT JOIN merchant_outlets o ON po.outlet_id = o.id
          WHERE po.store_id = ?
          ORDER BY po.created_at DESC
          LIMIT 100`,
    args: [String(store.id)],
  });

  const purchaseOrders = res.rows.map((row) => {
    let items = [];
    try {
      items = JSON.parse(String(row.items_json || "[]"));
    } catch {
      items = [];
    }
    return {
      ...row,
      items,
    };
  });

  return c.json({ purchaseOrders });
});

marketplaceRoutes.post("/merchants/me/purchase-orders", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_purchase_orders"))) {
    return c.json({ error: "purchase_orders_not_available" }, 400);
  }

  const settings = await getMarketplaceSettings();
  if (settings.elitePurchaseOrdersEnabled === false) {
    return c.json({ error: "purchase_orders_disabled_by_admin" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) return c.json({ error: "items_required" }, 400);

  const items = rawItems.map((it: any) => ({
    productId: String(it.productId || it.id || ""),
    title: String(it.title || it.name || "Item"),
    quantity: Math.max(1, parseInt(String(it.quantity || "1"), 10)),
    unitCost: Math.max(0, parseInt(String(it.unitCost || it.cost || "0"), 10)),
  }));

  const totalCost = items.reduce((sum: number, it: any) => sum + it.quantity * it.unitCost, 0);
  const id = "po_" + crypto.randomUUID().slice(0, 12);
  const poNumber = "PO-" + Math.floor(100000 + Math.random() * 900000);

  await db.execute({
    sql: `INSERT INTO store_purchase_orders
          (id, store_id, supplier_id, outlet_id, po_number, items_json, total_cost_ugx, status, notes, created_by)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`,
    args: [
      id,
      String(store.id),
      body.supplier_id ? String(body.supplier_id) : null,
      body.outlet_id ? String(body.outlet_id) : null,
      poNumber,
      JSON.stringify(items),
      totalCost,
      body.notes ? String(body.notes).trim() : null,
      user.sub,
    ],
  });

  return c.json({ ok: true, id, poNumber, totalCost });
});

marketplaceRoutes.post("/merchants/me/purchase-orders/:id/receive", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_purchase_orders"))) {
    return c.json({ error: "purchase_orders_not_available" }, 400);
  }

  const id = c.req.param("id")!;
  const poRes = await db.execute({
    sql: "SELECT * FROM store_purchase_orders WHERE id = ? AND store_id = ? LIMIT 1",
    args: [id, String(store.id)],
  });
  const po = poRes.rows[0] as Row | undefined;
  if (!po) return c.json({ error: "purchase_order_not_found" }, 404);

  if (po.status === "received") {
    return c.json({ ok: true, poId: id, status: "received", itemsReceivedCount: 0, message: "already_received" });
  }

  const body = await c.req.json().catch(() => ({}));
  const targetOutletId = (body.outlet_id as string | undefined) || (po.outlet_id as string | undefined) || null;

  let items = [];
  try {
    items = JSON.parse(String(po.items_json || "[]"));
  } catch {
    items = [];
  }

  // Stock receiving into outlet inventory and master product stock
  for (const item of items) {
    const qty = Math.max(1, parseInt(String(item.quantity || "1"), 10));
    if (targetOutletId && (await hasTable("store_outlet_inventory"))) {
      const existing = await db.execute({
        sql: "SELECT id, quantity FROM store_outlet_inventory WHERE store_id = ? AND outlet_id = ? AND product_id = ? LIMIT 1",
        args: [String(store.id), String(targetOutletId), String(item.productId)],
      });
      if (existing.rows.length > 0) {
        await db.execute({
          sql: "UPDATE store_outlet_inventory SET quantity = quantity + ? WHERE id = ?",
          args: [qty, String((existing.rows[0] as Row).id)],
        });
      } else {
        const invId = "inv_" + crypto.randomUUID().slice(0, 12);
        await db.execute({
          sql: "INSERT INTO store_outlet_inventory (id, store_id, outlet_id, product_id, quantity) VALUES (?, ?, ?, ?, ?)",
          args: [invId, String(store.id), String(targetOutletId || ''), String(item.productId), qty],
        });
      }
    }

    // Update master catalog product quantity
    if (item.productId) {
      await db.execute({
        sql: "UPDATE store_products SET inventory_quantity = inventory_quantity + ? WHERE id = ? AND store_id = ?",
        args: [qty, String(item.productId), String(store.id)],
      });
    }
  }

  await db.execute({
    sql: "UPDATE store_purchase_orders SET status = 'received', received_at = datetime('now') WHERE id = ?",
    args: [id],
  });

  return c.json({ ok: true, poId: id, status: "received", itemsReceivedCount: items.length });
});

marketplaceRoutes.get("/merchants/me/bundles", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_bundles"))) {
    return c.json({ bundles: [] });
  }

  const res = await db.execute({
    sql: "SELECT * FROM store_bundles WHERE store_id = ? ORDER BY created_at DESC",
    args: [String(store.id)],
  });

  const bundles = res.rows.map((row) => {
    let items = [];
    try {
      items = JSON.parse(String(row.items_json || "[]"));
    } catch {
      items = [];
    }
    return {
      ...row,
      items,
    };
  });

  return c.json({ bundles });
});

marketplaceRoutes.post("/merchants/me/bundles", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_bundles"))) {
    return c.json({ error: "bundles_not_available" }, 400);
  }

  const settings = await getMarketplaceSettings();
  if (settings.eliteBundlesEnabled === false) {
    return c.json({ error: "bundles_disabled_by_admin" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const title = String(body.title || "").trim();
  if (!title) return c.json({ error: "title_required" }, 400);

  const price = Math.max(0, parseInt(String(body.price || "0"), 10));
  const compareAtPrice = body.compare_at_price ? Math.max(0, parseInt(String(body.compare_at_price), 10)) : null;
  const rawItems = Array.isArray(body.items) ? body.items : [];

  const items = rawItems.map((it: any) => ({
    productId: String(it.productId || it.id || ""),
    title: String(it.title || it.name || "Item"),
    quantity: Math.max(1, parseInt(String(it.quantity || "1"), 10)),
  }));

  const id = "bnd_" + crypto.randomUUID().slice(0, 12);
  await db.execute({
    sql: `INSERT INTO store_bundles (id, store_id, title, description, price, compare_at_price, items_json, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`,
    args: [
      id,
      String(store.id),
      title,
      body.description ? String(body.description).trim() : null,
      price,
      compareAtPrice,
      JSON.stringify(items),
    ],
  });

  return c.json({ ok: true, id });
});

marketplaceRoutes.delete("/merchants/me/bundles/:id", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_bundles"))) {
    return c.json({ error: "bundles_not_available" }, 400);
  }

  const id = c.req.param("id")!;
  await db.execute({
    sql: "DELETE FROM store_bundles WHERE id = ? AND store_id = ?",
    args: [id, String(store.id)],
  });

  return c.json({ ok: true });
});

marketplaceRoutes.get("/merchants/me/winback-campaigns", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_winback_campaigns"))) {
    return c.json({ campaigns: [], inactiveCustomers: [] });
  }

  const campaignsRes = await db.execute({
    sql: "SELECT * FROM store_winback_campaigns WHERE store_id = ? ORDER BY sent_at DESC LIMIT 50",
    args: [String(store.id)],
  });

  let inactiveCustomers: Row[] = [];
  if (await hasTable("store_customer_loyalty")) {
    const custRes = await db.execute({
      sql: `SELECT * FROM store_customer_loyalty
            WHERE store_id = ? AND (last_order_at < datetime('now', '-7 days') OR orders_count >= 1)
            ORDER BY total_spent_ugx DESC
            LIMIT 50`,
      args: [String(store.id)],
    });
    inactiveCustomers = custRes.rows as Row[];
  }

  return c.json({ campaigns: campaignsRes.rows, inactiveCustomers });
});

marketplaceRoutes.post("/merchants/me/winback-campaigns", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_winback_campaigns"))) {
    return c.json({ error: "winback_not_available" }, 400);
  }

  const settings = await getMarketplaceSettings();
  if (settings.eliteWinbackEnabled === false) {
    return c.json({ error: "winback_disabled_by_admin" }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const phone = String(body.customer_phone || "").replace(/[^0-9]/g, "");
  if (!phone) return c.json({ error: "phone_required" }, 400);

  const message = String(body.message || "").trim();
  if (!message) return c.json({ error: "message_required" }, 400);

  const id = "wb_" + crypto.randomUUID().slice(0, 12);
  const cleanPhone = phone.startsWith("0") ? "256" + phone.slice(1) : phone;
  const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

  await db.execute({
    sql: `INSERT INTO store_winback_campaigns (id, store_id, customer_phone, customer_name, discount_code, channel, message, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
    args: [
      id,
      String(store.id),
      phone,
      body.customer_name ? String(body.customer_name).trim() : null,
      body.discount_code ? String(body.discount_code).trim() : null,
      "whatsapp",
      message,
    ],
  });

  return c.json({ ok: true, campaignId: id, whatsappUrl, status: "draft" });
});

export const DEFAULT_STOREFRONT_SECTIONS = [
  { id: "sec_announcement", type: "announcement", title: "Announcement Bar", subtitle: "Top flash deals & delivery updates", enabled: true, order: 1, settings: { showTicker: true } },
  { id: "sec_hero", type: "hero", title: "Hero Showcase & Story", subtitle: "Primary storefront banner & call to action", enabled: true, order: 2, settings: { showCta: true } },
  { id: "sec_bundles", type: "bundles", title: "Bundles & Gift Hampers", subtitle: "Curated multi-product kits with package savings", enabled: true, order: 3, settings: { maxItems: 6 } },
  { id: "sec_collections", type: "featured_collection", title: "Featured Collections", subtitle: "Automated smart categories & featured shelves", enabled: true, order: 4, settings: { layout: "grid" } },
  { id: "sec_video", type: "video_spotlight", title: "Live Selling & Video Reel", subtitle: "Live video stream or farm harvest demo", enabled: true, order: 5, settings: { autoPlayMuted: false } },
  { id: "sec_reviews", type: "testimonials", title: "What customers say", subtitle: "Reviews the store chooses to share", enabled: true, order: 6, settings: { showRatings: true, items: [] } },
  { id: "sec_badges", type: "trust_badges", title: "Store promises", subtitle: "What the store stands behind", enabled: true, order: 7, settings: { columns: 4, items: [] } },
  { id: "sec_faq", type: "faq", title: "Frequently asked questions", subtitle: "Delivery, payment and ordering", enabled: true, order: 8, settings: { items: [] } },
];

marketplaceRoutes.get("/merchants/me/storefront-sections", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "store_not_found" }, 404);

  let sections = DEFAULT_STOREFRONT_SECTIONS;
  if (await hasColumn("stores", "theme_sections")) {
    try {
      if (store.theme_sections) {
        const parsed = JSON.parse(String(store.theme_sections));
        if (Array.isArray(parsed) && parsed.length > 0) sections = parsed;
      }
    } catch {}
  }

  return c.json({ sections });
});

marketplaceRoutes.put("/merchants/me/storefront-sections", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "store_not_found" }, 404);

  const settings = await getMarketplaceSettings();
  if (settings.eliteStorefrontSectionsEnabled === false) {
    return c.json({ error: "sections_disabled_by_admin", message: "Storefront section customization is disabled." }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const checked = parseSections(body.sections);
  if (!checked.ok) return c.json({ error: "invalid_sections", message: checked.message }, 400);
  const sections = checked.sections;

  if (await hasColumn("stores", "theme_sections")) {
    await db.execute({
      sql: "UPDATE stores SET theme_sections = ? WHERE id = ?",
      args: [JSON.stringify(sections), String(store.id)],
    });
  }

  return c.json({ ok: true, sections });
});

marketplaceRoutes.get("/merchants/me/sms-logs", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store || !(await hasTable("store_sms_logs"))) {
    return c.json({ logs: [] });
  }

  const logsRes = await db.execute({
    sql: "SELECT * FROM store_sms_logs WHERE store_id = ? ORDER BY created_at DESC LIMIT 50",
    args: [String(store.id)],
  });

  return c.json({ logs: logsRes.rows });
});

marketplaceRoutes.post("/merchants/me/send-sms", requireAuth, async (c) => {
  const user = c.get("user");
  const memberRes = await db.execute({
    sql: "SELECT merchant_id FROM merchant_members WHERE user_id = ? AND status = 'active' AND (? IS NULL OR merchant_id = ?) ORDER BY CASE role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'finance' THEN 2 ELSE 3 END LIMIT 1",
    args: [user.sub, c.req.header("X-Merchant-Id") ?? null, c.req.header("X-Merchant-Id") ?? null],
  });
  const merchantId = (memberRes.rows[0] as Row | undefined)?.merchant_id as string | undefined;
  if (!merchantId) return c.json({ error: "no_merchant_membership" }, 403);

  const store = await getMerchantStore(merchantId);
  if (!store) return c.json({ error: "store_not_found" }, 404);

  const settings = await getMarketplaceSettings();
  if (settings.eliteSmsAlertsEnabled === false) {
    return c.json({ error: "sms_disabled_by_admin", message: "Automated SMS alerts are currently disabled by administrator." }, 403);
  }

  const body = await c.req.json().catch(() => ({}));
  const rawPhone = String(body.recipient_phone || "").replace(/[^0-9]/g, "");
  if (!rawPhone || rawPhone.length < 9) {
    return c.json({ error: "invalid_phone", message: "Valid phone number is required." }, 400);
  }

  const bodyText = String(body.body || "").trim();
  if (!bodyText) {
    return c.json({ error: "body_required", message: "SMS message text cannot be empty." }, 400);
  }

  const cleanPhone = rawPhone.startsWith("0") ? "256" + rawPhone.slice(1) : rawPhone.startsWith("256") ? rawPhone : "256" + rawPhone;
  const messageType = ["pos_receipt", "order_confirmation", "dispatch_alert", "abandoned_cart"].includes(body.message_type)
    ? body.message_type
    : "pos_receipt";

  const outcome = await sendStoreSms({
    storeId: String(store.id),
    phone: "+" + cleanPhone,
    name: body.recipient_name ? String(body.recipient_name).trim() : null,
    type: messageType,
    body: bodyText,
  });

  const whatsappShareUrl = "https://wa.me/" + cleanPhone + "?text=" + encodeURIComponent(bodyText);

  return c.json({
    ok: outcome.status !== "failed",
    logId: outcome.logId,
    status: outcome.status,
    costUgx: outcome.costUgx,
    externalMessageId: outcome.externalMessageId,
    ...(outcome.error ? { error: outcome.error } : {}),
    whatsappShareUrl,
  });
});

// ---------------------------------------------------------------------------
// Customer Public Marketplace Endpoints
// ---------------------------------------------------------------------------

marketplaceRoutes.get("/marketplace/stores", async (c) => {
  const category = c.req.query("category"); // 'groceries' | 'stores'
  const latParam = c.req.query("lat");
  const lngParam = c.req.query("lng");
  const userLat = latParam != null && latParam !== "" ? parseFloat(latParam) : null;
  const userLng = lngParam != null && lngParam !== "" ? parseFloat(lngParam) : null;
  const hasUserCoords = userLat != null && !isNaN(userLat) && userLng != null && !isNaN(userLng);
  const environment = await getPlatformEnvironment();

  let query = "SELECT * FROM stores WHERE status = 'active' AND environment = ?";
  // A store that chose not to be listed in the app is only reachable by its own web address.
  if (await hasColumn("stores", "listed_in_app")) query += " AND listed_in_app = 1";
  const args: (string | number)[] = [environment];

  if (category && (category === "groceries" || category === "stores" || category === "pharmacy")) {
    query += " AND category = ?";
    args.push(category);
  }

  query += " ORDER BY is_live DESC, is_open DESC, name";
  const res = await db.execute({ sql: query, args });

  let stores = res.rows as Row[];
  if (stores.length === 0 && (await demoCatalogAllowed())) {
    // Sandbox only: demo stores so browsing and testing works immediately.
    stores = DEMO_MARKETPLACE_STORES.filter((s) => !category || s.category === category);
  }

  if (hasUserCoords) {
    stores = stores.map((s) => {
      const sLat = typeof s.lat === "number" ? s.lat : typeof s.lat === "string" ? parseFloat(s.lat) : null;
      const sLng = typeof s.lng === "number" ? s.lng : typeof s.lng === "string" ? parseFloat(s.lng) : null;
      const distanceKm = sLat != null && sLng != null && !isNaN(sLat) && !isNaN(sLng)
        ? Math.round(haversineKm(userLat, userLng, sLat, sLng) * 10) / 10
        : null;
      return {
        ...s,
        distance_km: distanceKm,
      };
    });

    stores.sort((a, b) => {
      const distA = typeof a.distance_km === "number" ? a.distance_km : 999999;
      const distB = typeof b.distance_km === "number" ? b.distance_km : 999999;
      return distA - distB;
    });
  }

  return c.json({ stores });
});

marketplaceRoutes.get("/marketplace/stores/:id", async (c) => {
  const id = c.req.param("id")!;
  const latParam = c.req.query("lat");
  const lngParam = c.req.query("lng");
  const userLat = latParam != null && latParam !== "" ? parseFloat(latParam) : null;
  const userLng = lngParam != null && lngParam !== "" ? parseFloat(lngParam) : null;

  let store = await findPublicStore(id);
  if (!store && (await demoCatalogAllowed())) {
    store = DEMO_MARKETPLACE_STORES.find((s) => s.id === id || s.slug === id) || null;
  }

  if (!store) {
    // A store that exists but is paused or suspended can say so (admin option) instead of looking like a bad link.
    if ((await getOption<string>("storefront_stale_status_behavior")) === "show_suspended_page" && (await isStoreUnavailable(id))) {
      return c.json({ error: "store_unavailable", message: "This store isn't open right now. Please check back soon." }, 410);
    }
    return c.json({ error: "store_not_found" }, 404);
  }

  {
    const sp = await storePlan(store);
    store = { ...store, pro_tier: sp.isElite ? "elite" : sp.plan === "merchant" ? "free" : sp.plan };
  }

  const slug = String(store.slug || store.id);
  const customDomainLive = Boolean(store.custom_domain) && Number(store.domain_verified || 0) === 1
    && (await getOption<string>("storefront_domain_mode")) === "subdomain_plus_verified_custom_domains";
  store = {
    ...store,
    // An unverified domain is the merchant's claim, not an address of ours.
    custom_domain: customDomainLive ? store.custom_domain : null,
    subdomain_url: `https://${slug}.peebee.online`,
    marketplace_url: `https://app.peebee.online/store/${slug}`,
  };

  if (userLat != null && !isNaN(userLat) && userLng != null && !isNaN(userLng)) {
    const sLat = typeof store.lat === "number" ? store.lat : typeof store.lat === "string" ? parseFloat(store.lat) : null;
    const sLng = typeof store.lng === "number" ? store.lng : typeof store.lng === "string" ? parseFloat(store.lng) : null;
    const distanceKm = sLat != null && sLng != null && !isNaN(sLat) && !isNaN(sLng)
      ? Math.round(haversineKm(userLat, userLng, sLat, sLng) * 10) / 10
      : null;
    store = { ...store, distance_km: distanceKm };
  }

  const storeId = String(store.id);
  let collections: Row[] = [];
  if (await hasTable("store_collections")) {
    const colRes = await db.execute({
      sql: "SELECT * FROM store_collections WHERE store_id = ? AND status = 'active' ORDER BY pinned DESC, sort_order, created_at DESC",
      args: [storeId],
    });
    collections = colRes.rows as Row[];
  }

  let discounts: Row[] = [];
  const { storefront_promo_visibility: promoVisibility } = await getOptions(["storefront_promo_visibility"]);
  if (promoVisibility !== "none_public" && (await hasTable("store_discounts"))) {
    const discRes = await db.execute({
      sql: `SELECT id, code, title, kind, value, min_order_amount, is_automatic FROM store_discounts WHERE store_id = ? AND status = 'active' AND (starts_at IS NULL OR starts_at <= datetime('now')) AND (expires_at IS NULL OR expires_at > datetime('now')) AND ${promoVisibility === "flagged_public" ? "(is_automatic = 1 OR is_public = 1)" : "is_automatic = 1"} ORDER BY created_at DESC`,
      args: [storeId],
    });
    discounts = discRes.rows as Row[];
  }

  let bundles: any[] = [];
  if (await hasTable("store_bundles")) {
    const bunRes = await db.execute({
      sql: "SELECT id, title, description, price, compare_at_price, items_json FROM store_bundles WHERE store_id = ? AND status = 'active' ORDER BY created_at DESC",
      args: [storeId],
    });
    bundles = bunRes.rows.map((r) => {
      let items = [];
      try { items = JSON.parse(String(r.items_json || "[]")); } catch {}
      return { ...r, items };
    });
  }

  let sections: any[] = DEFAULT_STOREFRONT_SECTIONS;
  if (await hasColumn("stores", "theme_sections")) {
    try {
      if (store.theme_sections) {
        const parsedSec = cleanSections(JSON.parse(String(store.theme_sections)));
        if (parsedSec.length > 0) sections = parsedSec;
      }
    } catch {}
  }
  sections = cleanSections(sections);

  let outlets: Row[] = [];
  if (store.merchant_id && (await hasTable("merchant_outlets"))) {
    const outRes = await db.execute({
      sql: "SELECT id, name, code, address, lat, lng, status FROM merchant_outlets WHERE merchant_id = ? AND status = 'active' ORDER BY created_at",
      args: [String(store.merchant_id)],
    });
    outlets = outRes.rows as Row[];
  }

  let digitalProducts: Row[] = [];
  if (await hasTable("store_digital_products")) {
    const digRes = await db.execute({
      sql: "SELECT id, store_id, title, kind, description, price_ugx, compare_at_price_ugx, file_name, file_size_bytes, mime_type, cover_image_url, linked_course_id, downloads_count FROM store_digital_products WHERE store_id = ? AND status = 'published' ORDER BY created_at DESC",
      args: [storeId],
    });
    const soldOut = await soldOutLicenseProducts(storeId);
    digitalProducts = (digRes.rows as Row[]).map((r) => ({ ...r, sold_out: soldOut.has(String(r.id)) }));
  }

  let courses: Row[] = [];
  if ((await hasTable("edu_courses")) && (await hasColumn("edu_courses", "store_id"))) {
    const crsRes = await db.execute({
      sql: "SELECT id, school_id, title, summary, stream, price_ugx, status, created_at FROM edu_courses WHERE store_id = ? AND status = 'published' ORDER BY created_at DESC",
      args: [storeId],
    });
    courses = crsRes.rows as Row[];
  }

  return c.json({
    store: toPublicStore(store),
    collections,
    discounts,
    bundles,
    sections,
    outlets,
    digitalProducts,
    courses,
    channels: {
      customerAppUrl: `https://app.peebee.online/store/${slug}`,
      dedicatedStorefrontUrl: `https://${slug}.peebee.online`,
      customDomainUrl: store.custom_domain ? `https://${String(store.custom_domain)}` : null,
    },
    // What the web store should do, as set by admin.
    storefront: await storefrontOptions(store),
  });
});

// The web store asks the server what a code is worth; private codes are never listed, only checked.
const promoCheckSchema = z.object({
  code: z.string().min(1).max(40),
  items: z.array(z.object({ productId: z.string(), variantId: z.string().optional(), quantity: z.number().int().positive().max(50) })).min(1).max(50),
});

marketplaceRoutes.post("/marketplace/stores/:id/promo-check", async (c) => {
  const store = await findPublicStore(c.req.param("id")!);
  if (!store) return c.json({ error: "store_not_found" }, 404);
  const parsed = promoCheckSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const limited = await publicRateLimit(c, "promo-check", null, "rate_limit_public_inquiry_per_hour", 3600);
  if (limited) return limited;

  const priced = await priceCheckoutItems(
    parsed.data.items.map((it) => ({ ...it, storeId: String(store.id), title: "", price: 0 })),
    (await demoCatalogAllowed()) ? DEMO_MARKETPLACE_PRODUCTS : {},
  );
  if (!priced.ok) return c.json({ error: priced.error, message: priced.message }, priced.status);
  const subtotal = priced.items.reduce((sum, it) => sum + it.price * it.quantity, 0);
  const stop: DeliveryStop = { storeId: String(store.id), storeName: String(store.name), storeAddress: null, lat: null, lng: null, items: priced.items, itemsTotal: subtotal, distanceKm: null, deliveryFee: 0 };
  const result = await evaluateBagPromosAndLoyalty([stop], parsed.data.code);
  const applied = result.appliedDiscount;
  if (!applied || applied.code.toUpperCase() !== parsed.data.code.trim().toUpperCase()) {
    return c.json({ valid: false, subtotal, message: "That code isn't valid for this bag." });
  }
  return c.json({ valid: true, subtotal, code: applied.code, title: applied.title, kind: applied.kind, amount: applied.discountAmount, freeDelivery: applied.freeDelivery });
});

// Public B2B Wholesale Inquiry from Dedicated Storefront ([store-name].peebee.online)
const publicB2bInquirySchema = z.object({
  customer_name: z.string().min(2).max(120),
  customer_phone: z.string().min(6).max(30),
  customer_company: z.string().max(120).optional(),
  payment_terms: z.enum(["immediate", "net_7", "net_14", "net_30"]).default("net_14"),
  notes: z.string().max(500).optional(),
  items: z.array(
    z.object({
      productId: z.string(),
      title: z.string(),
      unitPrice: z.number().int().nonnegative(),
      quantity: z.number().int().positive(),
    })
  ).min(1),
});

marketplaceRoutes.post("/marketplace/stores/:id/b2b-inquiry", async (c) => {
  const id = c.req.param("id")!;
  if (!(await hasTable("store_draft_orders"))) {
    return c.json({ error: "migration_pending", message: "B2B draft orders migration is pending." }, 503);
  }
  const settings = await getMarketplaceSettings();
  if (!settings.eliteB2bEnabled) {
    return c.json({ error: "b2b_disabled", message: "B2B Wholesale is currently disabled." }, 403);
  }

  const store = await findPublicStore(id);
  if (!store) return c.json({ error: "store_not_found" }, 404);

  const parsed = publicB2bInquirySchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);

  const limited = await publicRateLimit(c, "b2b", parsed.data.customer_phone, "rate_limit_public_inquiry_per_hour", 3600);
  if (limited) return limited;
  if ((await getOption<string>("storefront_b2b_inquiry_protection")) === "phone_otp") {
    const proof = c.req.header("x-phone-proof");
    if (!(await proofIsValid(proof, parsed.data.customer_phone, "b2b_inquiry"))) {
      return c.json({ error: "phone_proof_required", message: "Confirm your phone number with the code we text you, then send the inquiry again." }, 403);
    }
  }

  // The merchant sees catalogue prices, whatever the form sent.
  const priced = await priceCheckoutItems(
    parsed.data.items.map((it) => ({ productId: it.productId, storeId: String(store.id), title: it.title, price: it.unitPrice, quantity: it.quantity })),
    (await demoCatalogAllowed()) ? DEMO_MARKETPLACE_PRODUCTS : {},
  );
  if (!priced.ok) return c.json({ error: priced.error, message: priced.message, productId: priced.productId }, priced.status);
  parsed.data.items = priced.items.map((it) => ({ productId: it.productId, title: it.title, unitPrice: it.price, quantity: it.quantity }));

  const subtotal = parsed.data.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
  const minB2b = Number(store.b2b_min_order_amount || 0);
  if (minB2b > 0 && subtotal < minB2b) {
    return c.json({
      error: "below_b2b_minimum",
      message: `Minimum wholesale order for ${String(store.name)} is UGX ${minB2b.toLocaleString()}.`,
    }, 400);
  }

  const draftId = newId("drf");
  await db.execute({
    sql: `INSERT INTO store_draft_orders (
            id, store_id, customer_name, customer_phone, customer_company,
            items_json, subtotal_amount, discount_amount, total_amount,
            payment_terms, notes, status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'open')`,
    args: [
      draftId,
      String(store.id),
      parsed.data.customer_name.trim(),
      parsed.data.customer_phone.trim(),
      parsed.data.customer_company?.trim() || null,
      JSON.stringify(parsed.data.items),
      subtotal,
      subtotal,
      parsed.data.payment_terms,
      parsed.data.notes?.trim() || "Submitted via Dedicated Storefront B2B Portal",
    ],
  });

  return c.json({ ok: true, id: draftId, total: subtotal }, 201);
});

marketplaceRoutes.get("/marketplace/stores/:id/products", async (c) => {
  const id = c.req.param("id")!;
  const publicStore = await findPublicStore(id);
  const demoOk = await demoCatalogAllowed();
  const realStoreId = publicStore ? String(publicStore.id) : demoOk && DEMO_MARKETPLACE_PRODUCTS[id] ? id : null;
  if (!realStoreId) return c.json({ products: [] });

  const productsRes = await db.execute({
    sql: "SELECT * FROM store_products WHERE store_id = ? AND status = 'active' ORDER BY sort_order, created_at DESC",
    args: [realStoreId],
  });

  let products = productsRes.rows as Row[];
  if (products.length === 0 && demoOk && DEMO_MARKETPLACE_PRODUCTS[realStoreId]) {
    products = DEMO_MARKETPLACE_PRODUCTS[realStoreId];
  }

  const variantsRes = await db.execute({
    sql: `SELECT v.* FROM store_product_variants v
          JOIN store_products p ON p.id = v.product_id
          WHERE p.store_id = ? ORDER BY v.created_at`,
    args: [realStoreId],
  });

  const variantsByProduct: Record<string, any[]> = {};
  for (const v of variantsRes.rows as Row[]) {
    const pid = String(v.product_id);
    variantsByProduct[pid] = variantsByProduct[pid] || [];
    variantsByProduct[pid].push(v);
  }

  const enriched = products.map((p) => toPublicProduct({
    ...p,
    variants: (p.variants as any[]) || variantsByProduct[String(p.id)] || [],
  }));

  return c.json({ products: enriched });
});

marketplaceRoutes.get("/marketplace/products/:id", async (c) => {
  const id = c.req.param("id")!;

  // 1. Try database lookup
  const prodRes = await db.execute({
    sql: `SELECT p.* FROM store_products p JOIN stores s ON s.id = p.store_id
          WHERE (p.id = ? OR p.slug = ?) AND p.status = 'active' AND s.status = 'active' AND s.environment = ?
          ORDER BY CASE WHEN p.id = ? THEN 0 ELSE 1 END LIMIT 1`,
    args: [id, id, await getPlatformEnvironment(), id],
  });

  let product = (prodRes.rows[0] as Row | undefined) || null;
  let store: Row | null = null;

  if (product) {
    const variantsRes = await db.execute({
      sql: "SELECT * FROM store_product_variants WHERE product_id = ? ORDER BY created_at",
      args: [String(product.id)],
    });
    product.variants = variantsRes.rows;

    const storeRes = await db.execute({
      sql: "SELECT id, name, slug, logo_url, banner_url, address, is_open, is_live, delivery_enabled, category FROM stores WHERE id = ?",
      args: [String(product.store_id)],
    });
    store = (storeRes.rows[0] as Row | undefined) || null;
  } else if (await demoCatalogAllowed()) {
    // 2. Sandbox only: fall back to demo products
    for (const [storeId, prods] of Object.entries(DEMO_MARKETPLACE_PRODUCTS)) {
      const match = prods.find((p: any) => p.id === id || p.slug === id);
      if (match) {
        product = { ...match } as unknown as Row;
        const demoStore = DEMO_MARKETPLACE_STORES.find((s) => s.id === storeId);
        if (demoStore) {
          store = { ...demoStore } as unknown as Row;
        }
        break;
      }
    }
  }

  if (!product) {
    return c.json({ error: "product_not_found" }, 404);
  }

  return c.json({ product: toPublicProduct(product), store });
});

// Live Channels Feed (for top "LIVE NOW" rail)
marketplaceRoutes.get("/marketplace/live", async (c) => {
  const res = await db.execute({
    sql: `SELECT s.id, s.name, s.slug, s.logo_url, s.banner_url, s.category,
                 s.live_channel_title, s.live_stream_url, s.live_viewer_count,
                 s.live_started_at
          FROM stores s
          WHERE s.is_live = 1 AND s.status = 'active'`,
    args: [],
  });

  let liveChannels = res.rows as Row[];
  if (liveChannels.length === 0 && (await demoCatalogAllowed())) {
    liveChannels = DEMO_MARKETPLACE_STORES.filter((s) => s.is_live === 1);
  }

  return c.json({ liveChannels });
});

// Spotlight Endless Feed (TikTok / Reels / Shorts style)
marketplaceRoutes.get("/marketplace/spotlight", async (c) => {
  const category = c.req.query("category"); // 'all' | 'groceries' | 'stores' | 'live'
  // The spotlight feed is built from the demo catalogue, so a live platform shows none of it.
  let items = (await demoCatalogAllowed()) ? DEMO_MARKETPLACE_SPOTLIGHT : [];

  if (category && category !== "all") {
    if (category === "live") {
      items = items.filter((item) => item.type === "live");
    } else {
      items = items.filter((item) => item.store_category === category);
    }
  }

  return c.json({ spotlight: items });
});

/** The admin-chosen behaviour the web storefront follows, plus the store's ad pixel IDs when admin allows them. */
async function storefrontOptions(store: Row) {
  const o = await getOptions(["storefront_checkout_mode", "storefront_pixels_enabled", "storefront_render_mode"]);
  const pixels = o.storefront_pixels_enabled === true;
  const meta = String(store.meta_pixel_id ?? "");
  const tiktok = String(store.tiktok_pixel_id ?? "");
  return {
    checkoutMode: o.storefront_checkout_mode as string,
    renderMode: o.storefront_render_mode as string,
    metaPixelId: pixels && /^\d{5,20}$/.test(meta) ? meta : null,
    tiktokPixelId: pixels && /^[A-Z0-9]{8,32}$/.test(tiktok) ? tiktok : null,
  };
}

async function ensureDemoStoreInDb(demoStoreId: string, environment: string) {
  if (!(await hasTable("stores"))) return;
  const existing = await db.execute({ sql: "SELECT id FROM stores WHERE id = ?", args: [demoStoreId] });
  if (existing.rows.length > 0) return;

  const demo = DEMO_MARKETPLACE_STORES.find((s) => s.id === demoStoreId);
  if (!demo) return;

  const merchantId = `${demoStoreId}-merchant`;
  await db.execute({
    sql: `INSERT OR IGNORE INTO merchants (id, legal_name, display_name, status, trust_tier, environment)
          VALUES (?, ?, ?, 'active', 'standard', ?)`,
    args: [merchantId, demo.name, demo.name, environment],
  });

  await db.execute({
    sql: `INSERT OR IGNORE INTO stores (
      id, merchant_id, name, slug, category, sub_category, description,
      announcement, phone, whatsapp_number, address, lat, lng,
      min_order_amount, pro_tier, is_live, status, environment
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    args: [
      demo.id,
      merchantId,
      demo.name,
      demo.slug,
      demo.category,
      demo.sub_category || "general",
      demo.description,
      demo.announcement || "",
      demo.phone,
      demo.whatsapp_number,
      demo.address,
      demo.lat || null,
      demo.lng || null,
      demo.min_order_amount,
      demo.pro_tier,
      demo.is_live,
      environment,
    ],
  });
}

const checkoutItemSchema = z.object({
  productId: z.string(),
  storeId: z.string(),
  title: z.string(),
  price: z.number().int().nonnegative(),
  quantity: z.number().int().positive().max(50),
  variantId: z.string().optional(),
  variantTitle: z.string().optional(),
  imageUrl: z.string().optional(),
});

const marketplaceCheckoutSchema = z.object({
  items: z.array(checkoutItemSchema).min(1),
  paymentRail: z.enum(["escrow", "float"]).optional(),
  paymentMethod: z.enum(["momo", "airtel", "wallet", "cod"]).optional(),
  destinationAddress: z.string().optional(),
  destinationArea: z.string().optional(),
  destinationLat: z.number().optional(),
  destinationLng: z.number().optional(),
  /** A long delivery dropped at a petrol station: bring it to the door, or collect it there. */
  relayLastMile: z.enum(["door", "collect", "meet"]).optional(),
  relayMeetStageId: z.string().max(80).optional(),
  /** A long trip: by matatu relay (the default when one is offered) or one rider all the way. */
  deliveryMode: z.enum(["rider", "relay"]).optional(),
  /** Optional promo code synced from Merchant Elite OS to both Customer App and Dedicated Storefront. */
  promoCode: z.string().max(40).optional(),
  /** Channel origin: Peebee Customer App vs Dedicated Brand Storefront ([store-name].peebee.online). */
  salesChannel: z.enum(["customer_app", "dedicated_storefront"]).optional(),
});

/** An order placed on a store's own web storefront needs the merchant to have switched the web store on. */
async function webStoreRefusal(items: Array<{ storeId: string }>, salesChannel: string | undefined): Promise<{ error: string; message: string } | null> {
  if (salesChannel !== "dedicated_storefront" || !(await hasColumn("stores", "web_store_enabled"))) return null;
  for (const storeId of new Set(items.map((i) => i.storeId))) {
    const row = (await db.execute({ sql: "SELECT web_store_enabled FROM stores WHERE id = ?", args: [storeId] })).rows[0] as Row | undefined;
    if (row && Number(row.web_store_enabled) !== 1) {
      return { error: "web_store_off", message: "This store doesn't take orders on its website. Open it in the Peebee app to order." };
    }
  }
  return null;
}

type AppliedDiscountSummary = {
  id: string;
  storeId: string;
  code: string;
  title: string;
  kind: "percent" | "fixed" | "free_delivery" | "bogo";
  discountAmount: number;
  freeDelivery: boolean;
};

async function evaluateBagPromosAndLoyalty(
  stops: DeliveryStop[],
  promoCode?: string,
): Promise<{
  discountAmount: number;
  appliedDiscount: AppliedDiscountSummary | null;
  loyaltyCashbackUgx: number;
  discountByStore: Map<string, number>;
  freeDeliveryStoreIds: Set<string>;
}> {
  const discountByStore = new Map<string, number>();
  const freeDeliveryStoreIds = new Set<string>();
  let appliedDiscount: AppliedDiscountSummary | null = null;
  let loyaltyCashbackUgx = 0;

  const mktSettings = await getMarketplaceSettings();
  const hasDiscounts = await hasTable("store_discounts");
  const hasLoyaltyCol = await hasColumn("stores", "loyalty_enabled");
  const cleanCode = promoCode?.trim().toUpperCase() || "";

  for (const stop of stops) {
    if (hasDiscounts && !appliedDiscount) {
      const discRes = await db.execute({
        sql: cleanCode
          ? "SELECT * FROM store_discounts WHERE store_id = ? AND status = 'active' AND (starts_at IS NULL OR starts_at <= datetime('now')) AND (expires_at IS NULL OR expires_at > datetime('now')) AND (UPPER(code) = ? OR is_automatic = 1) ORDER BY CASE WHEN UPPER(code) = ? THEN 0 ELSE 1 END, created_at DESC"
          : "SELECT * FROM store_discounts WHERE store_id = ? AND status = 'active' AND (starts_at IS NULL OR starts_at <= datetime('now')) AND (expires_at IS NULL OR expires_at > datetime('now')) AND is_automatic = 1 ORDER BY created_at DESC",
        args: cleanCode ? [stop.storeId, cleanCode, cleanCode] : [stop.storeId],
      });
      for (const d of discRes.rows as Row[]) {
        const minOrder = Number(d.min_order_amount || 0);
        const maxUses = d.max_uses != null ? Number(d.max_uses) : null;
        const usesCount = Number(d.uses_count || 0);
        if (stop.itemsTotal < minOrder) continue;
        if (maxUses != null && usesCount >= maxUses) continue;

        const kind = String(d.kind) as AppliedDiscountSummary["kind"];
        const val = Number(d.value || 0);
        let amount = 0;
        let freeDel = false;
        if (kind === "percent") {
          amount = Math.min(stop.itemsTotal, Math.round((stop.itemsTotal * Math.min(95, Math.max(0, val))) / 100));
        } else if (kind === "fixed") {
          amount = Math.min(stop.itemsTotal, Math.max(0, val));
        } else if (kind === "bogo") {
          const totalQty = stop.items.reduce((sum, it) => sum + it.quantity, 0);
          if (totalQty >= 2) {
            const cheapestUnit = Math.min(...stop.items.map((it) => it.price));
            amount = Math.min(stop.itemsTotal, cheapestUnit);
          } else {
            continue;
          }
        } else if (kind === "free_delivery") {
          freeDel = true;
          freeDeliveryStoreIds.add(stop.storeId);
        }

        if (amount > 0 || freeDel) {
          discountByStore.set(stop.storeId, amount);
          appliedDiscount = {
            id: String(d.id),
            storeId: stop.storeId,
            code: String(d.code),
            title: String(d.title),
            kind,
            discountAmount: amount,
            freeDelivery: freeDel,
          };
          break;
        }
      }
    }

    if (mktSettings.eliteLoyaltyEnabled && hasLoyaltyCol) {
      const storeRes = await db.execute({
        sql: "SELECT loyalty_enabled, loyalty_cashback_percent FROM stores WHERE id = ?",
        args: [stop.storeId],
      });
      const st = storeRes.rows[0] as Row | undefined;
      if (st && Number(st.loyalty_enabled || 0) === 1) {
        const pct = Math.min(mktSettings.eliteMaxLoyaltyCashbackPercent, Math.max(0, Number(st.loyalty_cashback_percent || 0)));
        const netStoreItems = Math.max(0, stop.itemsTotal - (discountByStore.get(stop.storeId) ?? 0));
        loyaltyCashbackUgx += Math.round((netStoreItems * pct) / 100);
      }
    }
  }

  const totalItemDiscount = Array.from(discountByStore.values()).reduce((a, b) => a + b, 0);
  return {
    discountAmount: totalItemDiscount,
    appliedDiscount,
    loyaltyCashbackUgx,
    discountByStore,
    freeDeliveryStoreIds,
  };
}

// Marketplace Cart Checkout -> Real Orders linked to Boda Delivery System
marketplaceRoutes.post("/marketplace/checkout", requireAuth, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const parsed = marketplaceCheckoutSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const d = parsed.data;

  const environment = await getPlatformEnvironment();
  const deliverySettings = await getDeliverySettings();
  const { enabledModes, nearestWindowSeconds, maxAssignmentMinutes } = await getMatchingSettings();
  const userRow = await db.execute({ sql: "SELECT default_matching_mode FROM users WHERE id = ?", args: [user.sub] });
  const preferredMode = userRow.rows[0]?.default_matching_mode as MatchingMode | null | undefined;
  const matchingMode: MatchingMode = preferredMode && enabledModes.includes(preferredMode) ? preferredMode : enabledModes[0];
  const matchingDeadlineAt =
    matchingMode === "nearest_window"
      ? new Date(Date.now() + nearestWindowSeconds * 1000).toISOString()
      : matchingMode === "customer_selects"
        ? new Date(Date.now() + maxAssignmentMinutes * 60 * 1000).toISOString()
        : null;

  const paymentRail = d.paymentRail ?? (d.paymentMethod === "cod" ? "float" : "escrow");
  const stage = paymentRail === "float" ? "Match" : "Create";

  const pricing = await priceCheckoutItems(d.items, (await demoCatalogAllowed()) ? DEMO_MARKETPLACE_PRODUCTS : {});
  if (!pricing.ok) return c.json({ error: pricing.error, message: pricing.message, productId: pricing.productId }, pricing.status);
  const refused = await webStoreRefusal(pricing.items, d.salesChannel);
  if (refused) return c.json(refused, 403);
  const bag = await planMarketplaceDelivery(pricing.items, d, environment);
  const stops = bag.stops;
  const promoEval = await evaluateBagPromosAndLoyalty(stops, d.promoCode);
  for (const stop of stops) {
    const itemDisc = promoEval.discountByStore.get(stop.storeId) ?? 0;
    stop.itemsTotal = Math.max(0, stop.itemsTotal - itemDisc);
    if (promoEval.freeDeliveryStoreIds.has(stop.storeId)) {
      stop.deliveryFee = 0;
    }
  }
  if (promoEval.appliedDiscount && (await hasTable("store_discounts"))) {
    // Claimed in one conditional update, so the last use of a limited code can't be taken twice.
    const claim = await db.execute({
      sql: "UPDATE store_discounts SET uses_count = uses_count + 1 WHERE id = ? AND (max_uses IS NULL OR uses_count < max_uses)",
      args: [promoEval.appliedDiscount.id],
    });
    if (!claim.rowsAffected) {
      return c.json({ error: "promo_exhausted", message: "That offer has just been used up. Review your bag and try again." }, 409);
    }
  }
  const relay = bag.mode === "relay" ? bag.relay : null;
  if (relay && paymentRail === "float") {
    return c.json({ error: "relay_requires_prepay", message: "Long-distance deliveries are paid in the app, not in cash." }, 409);
  }
  const createdOrders: Row[] = [];
  const supportsStoreId = (await hasColumn("orders", "store_id")) && (await hasTable("stores"));

  for (const [stopIndex, stop] of stops.entries()) {
    const listId = newId("list");
    await db.execute({
      sql: "INSERT INTO lists (id, customer_id, title, status, environment) VALUES (?, ?, ?, 'active', ?)",
      args: [listId, user.sub, `${stop.storeName} Order`, environment],
    });

    for (const it of stop.items) {
      const itemName = it.variantTitle ? `${it.title} (${it.variantTitle})` : it.title;
      await db.execute({
        sql: "INSERT INTO list_items (id, list_id, name, quantity, unit_price) VALUES (?, ?, ?, ?, ?)",
        args: [newId("item"), listId, itemName, it.quantity, it.price],
      });
    }

    const orderId = newId("ord");
    const storeCol = supportsStoreId ? ", store_id" : "";
    const storeVal = supportsStoreId ? ", ?" : "";
    const storeArgs = supportsStoreId ? [stop.storeId] : [];

    // The total is the items plus this stop's share of the delivery fee, which is what the customer pays.
    await db.execute({
      sql: `INSERT INTO orders (
              id, list_id, customer_id, stage, type, payment_rail, estimated_total, delivery_fee,
              pickup_area, pickup_address, pickup_lat, pickup_lng,
              destination_area, destination_address, destination_lat, destination_lng, distance_km,
              matching_mode, matching_deadline_at, environment${storeCol}
            )
            VALUES (?, ?, ?, ?, 'shopping', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?${storeVal})`,
      args: [
        orderId,
        listId,
        user.sub,
        stage,
        paymentRail,
        stop.itemsTotal + stop.deliveryFee,
        stop.deliveryFee,
        stop.storeName,
        stop.storeAddress,
        stop.lat,
        stop.lng,
        d.destinationArea ?? null,
        d.destinationAddress ?? null,
        d.destinationLat ?? null,
        d.destinationLng ?? null,
        stop.distanceKm,
        matchingMode,
        matchingDeadlineAt,
        environment,
        ...storeArgs,
      ],
    });

    await db.execute({
      sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, ?, ?, ?)",
      args: [newId("evt"), orderId, stage, `Order placed from ${stop.storeName}`, user.sub],
    });

    await snapshotTimeFees(orderId, stop.deliveryFee);
    if (relay) {
      // Every store's order rides the same relay; only the first pickup carries its fees (the
      // others' legs are free and are handed over with it, one code for the whole bag).
      const plan = stopIndex === 0 ? relay.plan : { ...relay.plan, legs: relay.plan.legs.map((leg) => ({ ...leg, fee: 0 })), total: 0, collectTotal: 0 };
      await insertRelayLegs(orderId, plan, relay.lastMile, relay.meet);
      await db.execute({
        sql: "INSERT INTO order_events (id, order_id, stage, note, actor_id) VALUES (?, ?, ?, ?, ?)",
        args: [newId("evt"), orderId, stage, `Relay delivery by boda and matatu (${relay.plan.direction})`, user.sub],
      });
    }
    createdOrders.push({ id: orderId });

    // Cashback for this store's share of the bag; credited when the admin-chosen moment arrives (see loyalty.ts).
    try {
      const mktSettings = await getMarketplaceSettings();
      let earnedUgx = 0;
      if (mktSettings.eliteLoyaltyEnabled && (await hasColumn("stores", "loyalty_enabled"))) {
        const stRes = await db.execute({
          sql: "SELECT loyalty_enabled, loyalty_cashback_percent FROM stores WHERE id = ? LIMIT 1",
          args: [stop.storeId],
        });
        const st = stRes.rows[0] as Row | undefined;
        if (st && Number(st.loyalty_enabled) === 1) {
          const pct = Math.min(Number(st.loyalty_cashback_percent || 0), mktSettings.eliteMaxLoyaltyCashbackPercent);
          if (pct > 0) earnedUgx = Math.round((stop.itemsTotal * pct) / 100);
        }
      }
      const custRes = await db.execute({ sql: "SELECT name, phone FROM users WHERE id = ? LIMIT 1", args: [user.sub] });
      const cust = custRes.rows[0] as Row | undefined;
      // Without a verified phone number there is no loyalty account to credit.
      if (cust?.phone) {
        await recordLoyaltyForOrder({
          storeId: stop.storeId, orderId, phone: String(cust.phone), name: cust.name ? String(cust.name) : null,
          earnedUgx, spentUgx: stop.itemsTotal,
        });
      }
    } catch (err) {
      console.error("loyalty ledger update failed", err);
    }
  }

  // Several stores in one bag are one delivery: one rider collects from every
  // store in turn, and the customer pays once (see orders/bundle-funding.ts).
  if (createdOrders.length > 1 && (await hasColumn("orders", "delivery_bundle_id"))) {
    const leadId = String(createdOrders[0].id);
    await executeBatch(createdOrders.map((order) => ({
      sql: "UPDATE orders SET delivery_bundle_id = ? WHERE id = ?",
      args: [leadId, String(order.id)],
    })));
  }

  const ids = createdOrders.map((order) => String(order.id));
  const full = await db.execute({
    sql: `SELECT o.*, c.name as customer_name, r.name as rider_name FROM orders o
          LEFT JOIN users c ON c.id = o.customer_id
          LEFT JOIN users r ON r.id = o.rider_id
          WHERE o.id IN (${ids.map(() => "?").join(",")})`,
    args: ids,
  });
  const byId = new Map((full.rows as Row[]).map((row) => [String(row.id), row]));
  const orders = ids.map((id) => byId.get(id)).filter(Boolean) as Row[];

  // One notice per delivery, not one per store.
  try {
    await primeDemoAccounts();
    const onlineRiders = await db.execute(`SELECT u.id FROM riders r JOIN users u ON u.id = r.user_id WHERE r.verified = 1 AND r.is_online = 1 AND ${ridersForThisWorld("r.user_id")}`);
    const deliveryFee = stops.reduce((sum, stop) => sum + stop.deliveryFee, 0);
    const where = stops.map((stop) => stop.storeName).join(", ");
    for (const rider of onlineRiders.rows as Row[]) {
      notifyUser(rider.id as string, {
        title: stops.length > 1 ? `New delivery: ${stops.length} pickups` : `New delivery order: ${where}`,
        body: `Pickup at ${where} · Delivery fee: UGX ${deliveryFee.toLocaleString()}`,
        url: "/riders",
        tag: `order-${ids[0]}`,
      }).catch(() => {});
    }
  } catch {
    // Ignore notification broadcast failures
  }

  return c.json({ ok: true, orders, order: orders[0] }, 201);
});

const quoteSchema = marketplaceCheckoutSchema.pick({ items: true, destinationLat: true, destinationLng: true, relayLastMile: true, relayMeetStageId: true, deliveryMode: true, promoCode: true, salesChannel: true });

/** The exact delivery fee a bag will be charged, split by store. Checkout shows this, never an estimate. */
marketplaceRoutes.post("/marketplace/checkout/quote", requireAuth, async (c) => {
  const parsed = quoteSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
  const pricing = await priceCheckoutItems(parsed.data.items, (await demoCatalogAllowed()) ? DEMO_MARKETPLACE_PRODUCTS : {});
  if (!pricing.ok) return c.json({ error: pricing.error, message: pricing.message, productId: pricing.productId }, pricing.status);
  const refused = await webStoreRefusal(pricing.items, parsed.data.salesChannel);
  if (refused) return c.json(refused, 403);
  const bag = await planMarketplaceDelivery(pricing.items, parsed.data, await getPlatformEnvironment());
  const { stops, trip } = bag;
  const relayed = bag.relay;
  const promoEval = await evaluateBagPromosAndLoyalty(stops, parsed.data.promoCode);
  for (const stop of stops) {
    if (promoEval.freeDeliveryStoreIds.has(stop.storeId)) {
      stop.deliveryFee = 0;
    }
  }
  const rawItemsTotal = stops.reduce((sum, stop) => sum + stop.itemsTotal, 0);
  const discountAmount = promoEval.discountAmount;
  const itemsTotal = Math.max(0, rawItemsTotal - discountAmount);
  const deliveryFee = stops.reduce((sum, stop) => sum + stop.deliveryFee, 0);
  return c.json({
    itemsTotal,
    rawItemsTotal,
    discountAmount,
    appliedDiscount: promoEval.appliedDiscount,
    loyaltyCashbackUgx: promoEval.loyaltyCashbackUgx,
    deliveryFee,
    total: itemsTotal + deliveryFee,
    /** Which way this quote delivers; the customer can switch when a relay is offered. */
    deliveryMode: bag.mode,
    /** The delivery fee each way, so both choices show their price. */
    options: { rider: trip?.fee ?? deliveryFee, relay: relayed?.fee ?? null },
    /** "Direct" (one rider all the way) is promised in under this many hours (admin setting). */
    directMaxHours: (await getRelaySettings()).directMaxHours,
    stores: stops.map((stop) => ({ storeId: stop.storeId, storeName: stop.storeName, itemsTotal: stop.itemsTotal, deliveryFee: stop.deliveryFee })),
    // One rider's whole trip along the road: each leg, the direct trip and the distance the other stops add.
    trip,
    // A long trip by matatu relay: the rider collects from every store, then each leg as priced.
    relay: relayed
      ? {
          routeName: relayed.plan.routeName,
          direction: relayed.plan.direction,
          routeCode: relayed.plan.routeCode,
          dropMode: relayed.plan.dropMode,
          station: relayed.plan.station?.name ?? null,
          lastMile: relayed.lastMile,
          doorTotal: relayed.plan.total,
          collectTotal: relayed.plan.collectTotal ?? null,
          choiceAtOrder: relayed.plan.dropMode === "station" && relayed.lastMile !== "pending",
          meetStages: (relayed.plan.meetStages ?? []).map((stage) => ({ id: stage.id, name: stage.name, distanceKm: stage.distanceKm, isStation: !!stage.outletId })),
          meetStage: relayed.meet?.name ?? null,
          legs: relayed.plan.legs.map((leg) => ({ leg: leg.leg, kind: leg.kind, fromName: leg.fromName, toName: leg.toName, distanceKm: leg.distanceKm, fee: leg.fee })),
        }
      : null,
  });
});

type CheckoutItem = z.infer<typeof checkoutItemSchema>;
type DeliveryStop = {
  storeId: string; storeName: string; storeAddress: string | null; lat: number | null; lng: number | null;
  items: CheckoutItem[]; itemsTotal: number; distanceKm: number | null; deliveryFee: number;
};
/** One rider's whole trip: store to store in the shortest order, then to the customer, along the road. */
type BagTrip = {
  legs: Array<{ fromName: string; toName: string; km: number }>;
  totalKm: number;
  /** The first store straight to the customer, and what the other stops add. */
  directKm: number; directFee: number;
  addedKm: number; addedFee: number;
  fee: number;
};
type BagRelay = { plan: RelayPlan; lastMile: RelayLastMile; meet: RelayMeet | null; fee: number };
type BagPlan = { stops: DeliveryStop[]; mode: "rider" | "relay"; trip: BagTrip | null; relay: BagRelay | null };

/**
 * Prices a bag's delivery. One rider collects from every store, in the order
 * that makes the whole trip shortest, then rides to the customer; the fee is
 * that trip's road distance at the admin's rate. When the trip is longer than
 * the admin's relay distance a matatu relay is offered as well (and chosen by
 * default): the rider collects from every store, then hands the bag to a matatu.
 * Each store's order carries its share so the orders add up to the fee charged.
 */
async function planMarketplaceDelivery(
  items: CheckoutItem[],
  destination: { destinationLat?: number; destinationLng?: number; relayLastMile?: "door" | "collect" | "meet"; relayMeetStageId?: string; deliveryMode?: "rider" | "relay" },
  environment: Awaited<ReturnType<typeof getPlatformEnvironment>>,
): Promise<BagPlan> {
  const settings = await getDeliverySettings();
  const byStore = new Map<string, CheckoutItem[]>();
  for (const it of items) byStore.set(it.storeId, [...(byStore.get(it.storeId) ?? []), it]);

  let stops: DeliveryStop[] = [];
  for (const [storeId, storeItems] of byStore.entries()) {
    if (await demoCatalogAllowed()) await ensureDemoStoreInDb(storeId, environment);
    let storeName = "Marketplace Store";
    let storeAddress: string | null = null;
    let lat: number | null = null;
    let lng: number | null = null;
    if (await hasTable("stores")) {
      const row = (await db.execute({ sql: "SELECT name, address, lat, lng, merchant_id FROM stores WHERE id = ?", args: [storeId] })).rows[0] as Row | undefined;
      if (row) {
        storeName = String(row.name ?? storeName);
        storeAddress = (row.address as string | null) ?? null;
        lat = (row.lat as number | null) ?? null;
        lng = (row.lng as number | null) ?? null;

        // Multi-Outlet Inventory routing: if the merchant has stocked branches in store_outlet_inventory,
        // pick the active branch that has the items in stock (nearest to customer when coordinates exist).
        const mktSettings = await getMarketplaceSettings();
        if (
          row.merchant_id &&
          mktSettings.eliteMultiOutletInventoryEnabled &&
          (await hasTable("store_outlet_inventory")) &&
          (await hasTable("merchant_outlets"))
        ) {
          const outRes = await db.execute({
            sql: "SELECT id, name, address, lat, lng FROM merchant_outlets WHERE merchant_id = ? AND status = 'active'",
            args: [String(row.merchant_id)],
          });
          const outlets = outRes.rows as Row[];
          if (outlets.length > 0) {
            const invRes = await db.execute({
              sql: "SELECT outlet_id, product_id, quantity FROM store_outlet_inventory WHERE store_id = ?",
              args: [storeId],
            });
            const invRows = invRes.rows as Row[];
            if (invRows.length > 0) {
              const stockedOutlets = outlets.filter((o) =>
                storeItems.every((it) => {
                  const match = invRows.find((r) => String(r.outlet_id) === String(o.id) && String(r.product_id) === it.productId);
                  return match && Number(match.quantity || 0) >= it.quantity;
                }),
              );
              const candidates = stockedOutlets.length > 0 ? stockedOutlets : [];
              if (candidates.length > 0) {
                let chosen = candidates[0];
                if (destination.destinationLat != null && destination.destinationLng != null) {
                  let bestDist = Infinity;
                  for (const cand of candidates) {
                    if (cand.lat != null && cand.lng != null) {
                      const dKm = haversineKm(destination.destinationLat, destination.destinationLng, Number(cand.lat), Number(cand.lng));
                      if (dKm < bestDist) {
                        bestDist = dKm;
                        chosen = cand;
                      }
                    }
                  }
                }
                if (chosen.address) storeAddress = `${String(chosen.name)} · ${String(chosen.address)}`;
                if (chosen.lat != null && chosen.lng != null) {
                  lat = Number(chosen.lat);
                  lng = Number(chosen.lng);
                }
              }
            }
          }
        }
      }
    }
    // A demo store saved before it had a map pin still has its pin in the demo catalogue.
    if (lat == null || lng == null) {
      const demo = DEMO_MARKETPLACE_STORES.find((store) => store.id === storeId);
      if (demo?.lat != null && demo.lng != null) { lat = demo.lat; lng = demo.lng; }
    }
    if (storeName === "Marketplace Store") {
      const demo = DEMO_MARKETPLACE_STORES.find((store) => store.id === storeId);
      if (demo) {
        storeName = demo.name;
        storeAddress = demo.address;
        lat = demo.lat ?? null;
        lng = demo.lng ?? null;
      }
    }
    stops.push({
      storeId, storeName, storeAddress, lat, lng, items: storeItems,
      itemsTotal: storeItems.reduce((sum, it) => sum + it.price * it.quantity, 0),
      distanceKm: null, deliveryFee: 0,
    });
  }

  const { destinationLat, destinationLng } = destination;
  const located = destinationLat != null && destinationLng != null && stops.every((stop) => stop.lat != null && stop.lng != null);
  if (!located) {
    // Without coordinates there's no route: the admin's flat shopping fee, once for the whole bag.
    stops.forEach((stop, i) => { stop.deliveryFee = i === 0 ? roundFare(settings.shoppingDeliveryFee) : 0; });
    return { stops, mode: "rider", trip: null, relay: null };
  }

  const door = { lat: destinationLat!, lng: destinationLng! };
  const at = (stop: DeliveryStop) => ({ lat: stop.lat!, lng: stop.lng! });
  stops = shortestPickupOrder(stops as Array<DeliveryStop & { lat: number; lng: number }>, door);
  const legKm = await roadLegsKm([...stops.map(at), door]);
  const directKm = stops.length > 1 ? (await roadLegsKm([at(stops[0]), door]))[0] : legKm[0];
  const totalKm = legKm.reduce((sum, km) => sum + km, 0);
  const fee = roundFare(totalKm * settings.deliveryRatePerKm, settings.minimumDeliveryFee);
  const directFee = Math.min(fee, roundFare(directKm * settings.deliveryRatePerKm, settings.minimumDeliveryFee));
  const trip: BagTrip = {
    legs: legKm.map((km, i) => ({ fromName: stops[i].storeName, toName: stops[i + 1]?.storeName ?? "You", km: round1(km) })),
    totalKm: round1(totalKm),
    directKm: round1(directKm), directFee,
    addedKm: round1(Math.max(0, totalKm - directKm)), addedFee: fee - directFee,
    fee,
  };
  stops.forEach((stop, i) => { stop.distanceKm = round1(i === stops.length - 1 ? legKm[i] : legKm.slice(i).reduce((a, b) => a + b, 0)); });

  // Long trips: a relay by matatu, the rider first collecting from every store.
  let relay: BagRelay | null = null;
  const between = legKm.slice(0, -1).reduce((sum, km) => sum + km, 0);
  const last = stops[stops.length - 1];
  const plan = await planRelay(
    { lat: last.lat!, lng: last.lng!, name: last.storeName },
    { ...door, name: "Your door" },
    { start: { lat: stops[0].lat!, lng: stops[0].lng!, name: stops[0].storeName }, leadInKm: between, tripKm: totalKm },
  );
  if (plan) {
    const { lastMile, meet } = await resolveLastMile(plan, destination.relayLastMile, destination.relayMeetStageId);
    relay = { plan, lastMile, meet, fee: relayChargeFor(plan, lastMile) };
  }

  const mode = relay && destination.deliveryMode !== "rider" ? "relay" : "rider";
  if (mode === "relay") {
    // The whole relay is paid with the first pickup; the other stores ride along.
    stops.forEach((stop, i) => { stop.deliveryFee = i === 0 ? relay!.fee : 0; });
  } else {
    // The first store carries the direct trip; each further store the extra road it adds.
    const extraKm = legKm.slice(0, -1);
    const extraTotal = extraKm.reduce((sum, km) => sum + km, 0);
    let shared = 0;
    stops.forEach((stop, i) => {
      if (i === 0) { stop.deliveryFee = directFee; return; }
      stop.deliveryFee = i === stops.length - 1
        ? trip.addedFee - shared
        // Whole fare steps (UGX 500), the last store taking what's left, so no store shows odd shillings.
        : extraTotal > 0 ? Math.floor((trip.addedFee * extraKm[i - 1]) / extraTotal / 500) * 500 : 0;
      shared += stop.deliveryFee;
    });
  }
  return { stops, mode, trip, relay };
}
