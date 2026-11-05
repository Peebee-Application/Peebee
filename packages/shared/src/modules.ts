/**
 * The one list of everything on the platform that can be switched on or off.
 *
 * Every module has two independent switches: Live (what real users get) and Practice (the simulated Entebbe world).
 * A module can therefore be on in Practice while still off in Live; staff try it there, then switch Live on.
 * Modules sit in clusters (Ride, Buy, Learn...) and can nest (Ride > Peebee Car > Carpool). A module is only
 * available when every module above it is also on, in the same world.
 *
 * `liveKey` points a module at the setting that already gates it on the server, so the old switches and these
 * share one value. `channel` does the same for a switch inside the Channels config. Modules with neither are stored
 * in `modules_live` (default on).
 */
import { sanitizeChannelsConfig } from "./channels-config.js";

export type ModuleWorld = "live" | "practice";

export type ModuleClusterId = "ride" | "deliver" | "buy" | "learn" | "hive" | "channels" | "money";

export type ModuleClusterDef = { id: ModuleClusterId; label: string; description: string };

/** How much of a module the Practice world already simulates (see `practice` on each module). */
export type PracticeCoverage = "full" | "partial" | "none";

export type ModuleDef = {
  key: string;
  cluster: ModuleClusterId;
  /** Key of the module this one sits under; the cluster's own switch for a top-level module. */
  parent?: string;
  label: string;
  description: string;
  /** The `settings` row that already gates this module in Live. `defaultOn` is what that row means when empty. */
  liveKey?: string;
  defaultOn?: boolean;
  /** A switch inside the Channels config: a yes/no at `path`, or (with `includes`) whether that value is in the list at `path`. */
  channel?: { path: string; includes?: string };
  /** What the Practice world holds for this module: people, content, orders, places. */
  practice: { coverage: PracticeCoverage; has: string[]; missing?: string[] };
};

export const MODULE_CLUSTERS: readonly ModuleClusterDef[] = [
  { id: "ride", label: "Ride", description: "Boda, Peebee Car, Luxury, Ambulance, Move, Taxipress and carpools." },
  { id: "deliver", label: "Deliver", description: "Parcels and long-distance relay between towns." },
  { id: "buy", label: "Buy", description: "Shopping lists, food, stores, pharmacy and fuel." },
  { id: "learn", label: "Learn", description: "Schools, courses, live classes and certificates." },
  { id: "hive", label: "Hive", description: "Home services and the Peebee Hire marketplace." },
  { id: "channels", label: "Channels", description: "Creator channels: what people can post, go live with, and earn from." },
  { id: "money", label: "Money", description: "Paid memberships and reading aloud." },
];

const m = (
  key: string, cluster: ModuleClusterId, label: string, description: string,
  practice: ModuleDef["practice"], extra: Partial<Pick<ModuleDef, "parent" | "liveKey" | "defaultOn" | "channel">> = {},
): ModuleDef => ({ key, cluster, label, description, practice, ...extra });

const NO_PRACTICE: ModuleDef["practice"] = { coverage: "none", has: [], missing: ["Channels are not part of Practice"] };

/** A Channels module: its switch is a value inside the Channels config, so Admin → Channels and Services stay one setting. */
const c = (key: string, label: string, description: string, path: string, parent?: string, includes?: string): ModuleDef => ({
  key, cluster: "channels", label, description, practice: NO_PRACTICE, ...(parent ? { parent } : {}), channel: { path, ...(includes ? { includes } : {}) },
});

export const MODULES: readonly ModuleDef[] = [
  // Ride
  m("ride", "ride", "Rides", "Every way of moving a person. Off pauses all of them.", { coverage: "full", has: ["customers", "boda riders", "car drivers", "trips"] }, { liveKey: "service_ride_enabled", defaultOn: true }),
  m("ride.boda", "ride", "Boda", "Motorcycle rides, multi-stop trips and Name your fare.", { coverage: "full", has: ["boda riders", "stages", "fare offers", "live trips"] }, { parent: "ride" }),
  m("ride.for_other", "ride", "Ride for someone else", "Book a ride on behalf of another passenger.", { coverage: "full", has: ["saved passengers", "passenger trip-link sharing"] }, { parent: "ride", liveKey: "ride_for_other_enabled", defaultOn: true }),
  m("ride.bidding", "ride", "Name your fare", "Riders and drivers counter the customer's price.", { coverage: "full", has: ["fare offers", "counter offers"] }, { parent: "ride", liveKey: "bidding_enabled", defaultOn: false }),
  m("ride.car", "ride", "Peebee Car", "Car rides with owners, drivers and vehicles.", { coverage: "full", has: ["car drivers", "vehicles", "car types", "owners"] }, { parent: "ride", liveKey: "car_enabled", defaultOn: false }),
  m("ride.car.ondemand", "ride", "On-demand car rides", "Book a car now.", { coverage: "full", has: ["car drivers", "trips"] }, { parent: "ride.car", liveKey: "car_ondemand_enabled", defaultOn: false }),
  m("ride.car.scheduled", "ride", "Scheduled rides", "Book a car for later.", { coverage: "full", has: ["scheduled bookings", "driver watch alerts"] }, { parent: "ride.car", liveKey: "car_scheduled_enabled", defaultOn: false }),
  m("ride.car.carpool", "ride", "Carpool", "Share seats on a driver's trip.", { coverage: "full", has: ["carpool trips", "weekly repeats", "seat payment timeouts"] }, { parent: "ride.car", liveKey: "car_carpool_enabled", defaultOn: false }),
  m("ride.car.selfdrive", "ride", "Self-drive rental", "Rent a car and drive it yourself.", { coverage: "full", has: ["rental cars", "owners", "inspections", "renter KYC"] }, { parent: "ride.car", liveKey: "car_selfdrive_enabled", defaultOn: false }),
  m("ride.car.deals", "ride", "Owner-driver deals", "Drivers apply to owners' cars on agreed terms.", { coverage: "full", has: ["owners", "drivers", "deal applications", "rent/share terms"] }, { parent: "ride.car", liveKey: "car_deals_enabled", defaultOn: false }),
  m("ride.luxury", "ride", "Luxury", "Chauffeured sedans, SUVs and limousines, with hourly hire.", { coverage: "full", has: ["luxury cars", "chauffeurs", "hourly hire"] }, { parent: "ride" }),
  m("ride.ambulance", "ride", "Ambulance", "Basic and ICU patient transport.", { coverage: "full", has: ["ambulances", "crews"] }, { parent: "ride" }),
  m("ride.move", "ride", "Move (cargo)", "Vans and trucks for loads.", { coverage: "full", has: ["cargo vans", "pickups", "box trucks", "heavy trucks", "owners"] }, { parent: "ride", liveKey: "service_cargo_enabled", defaultOn: true }),
  m("ride.taxipress", "ride", "Taxipress", "Seats on the next shared taxi along a fixed route.", { coverage: "full", has: ["routes", "taxis", "queue", "seat bookings", "parcels"] }, { parent: "ride", liveKey: "taxipress_enabled", defaultOn: false }),

  // Deliver
  m("deliver", "deliver", "Deliveries", "Every way of moving a parcel.", { coverage: "full", has: ["customers", "riders", "parcels"] }),
  m("deliver.parcel", "deliver", "Parcel delivery", "Send a parcel across town.", { coverage: "full", has: ["riders", "parcel orders", "receipts"] }, { parent: "deliver", liveKey: "service_parcel_enabled", defaultOn: true }),
  m("deliver.relay", "deliver", "Relay delivery", "Long parcels boda → matatu → boda.", { coverage: "full", has: ["matatu routes", "operators", "petrol stations", "relay orders"] }, { parent: "deliver", liveKey: "relay_enabled", defaultOn: false }),

  // Buy
  m("buy", "buy", "Buy", "Everything customers purchase.", { coverage: "full", has: ["customers", "stores", "restaurants"] }),
  m("buy.shopping", "buy", "Shopping lists", "A rider shops a list for the customer.", { coverage: "full", has: ["shopping lists", "riders", "merchants", "outlets"] }, { parent: "buy", liveKey: "service_shopping_enabled", defaultOn: true }),
  m("buy.food", "buy", "Food ordering", "Restaurants, kitchens, street food and juices.", { coverage: "full", has: ["restaurants", "menus", "dishes", "reviews", "orders"] }, { parent: "buy", liveKey: "service_food_enabled", defaultOn: true }),
  m("buy.marketplace", "buy", "Marketplace", "Pro stores, products and ads.", { coverage: "full", has: ["stores", "products", "spotlight", "carts"] }, { parent: "buy", liveKey: "marketplace_enabled", defaultOn: true }),
  m("buy.marketplace.live", "buy", "Live selling", "Stores sell on a live stream.", { coverage: "full", has: ["live sessions", "live chat", "live orders"] }, { parent: "buy.marketplace", liveKey: "marketplace_live_enabled", defaultOn: true }),
  m("buy.pharmacy", "buy", "Pharmacy", "Prescriptions and medicine orders.", { coverage: "full", has: ["pharmacies", "prescriptions", "quotes"] }, { parent: "buy", liveKey: "pharmacy_enabled", defaultOn: true }),
  m("buy.gas", "buy", "Fuel (Gas)", "Riders buy fuel vouchers redeemed at stations.", { coverage: "full", has: ["stations", "attendants", "vouchers", "dispenses"] }, { parent: "buy", liveKey: "service_gas_enabled", defaultOn: true }),
  m("buy.guest", "buy", "Guest checkout", "Order without an account through a shared link.", { coverage: "full", has: ["guest orders", "tracking codes", "status that moves on"] }, { parent: "buy", liveKey: "guest_checkout_enabled", defaultOn: true }),

  m("buy.marketplace.elite", "buy", "Merchant Elite", "Shopify-level tools for large stores: collections, discounts, inventory across outlets.", { coverage: "full", has: ["collections", "discounts"] }, { parent: "buy.marketplace", liveKey: "marketplace_elite_enabled", defaultOn: true }),
  m("buy.marketplace.elite.b2b", "buy", "Wholesale (B2B) orders", "Draft orders and payment terms for business buyers.", { coverage: "full", has: ["draft orders"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_b2b_enabled", defaultOn: true }),
  m("buy.marketplace.elite.multi_outlet", "buy", "Stock across outlets", "Inventory counted per outlet.", { coverage: "full", has: ["outlet inventory"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_multi_outlet_inventory_enabled", defaultOn: true }),
  m("buy.marketplace.elite.domain", "buy", "Custom domain", "A store on its own web address.", { coverage: "full", has: ["store storefront"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_custom_domain_enabled", defaultOn: true }),
  m("buy.marketplace.elite.loyalty", "buy", "Loyalty cashback", "Customers earn points back on purchases.", { coverage: "full", has: ["loyalty accounts"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_loyalty_enabled", defaultOn: true }),
  m("buy.marketplace.elite.pos", "buy", "In-store POS", "Sell at the counter and print receipts.", { coverage: "full", has: ["POS sales"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_pos_enabled", defaultOn: true }),
  m("buy.marketplace.elite.transfers", "buy", "Stock transfers", "Move stock between outlets.", { coverage: "full", has: ["transfers"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_stock_transfers_enabled", defaultOn: true }),
  m("buy.marketplace.elite.crm", "buy", "Customer CRM", "Know your customers and their spend.", { coverage: "full", has: ["customer records"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_crm_enabled", defaultOn: true }),
  m("buy.marketplace.elite.purchase_orders", "buy", "Supplier purchase orders", "Order stock from suppliers.", { coverage: "full", has: ["suppliers", "purchase orders"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_purchase_orders_enabled", defaultOn: true }),
  m("buy.marketplace.elite.bundles", "buy", "Product bundles", "Sell products together for one price.", { coverage: "full", has: ["bundles"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_bundles_enabled", defaultOn: true }),
  m("buy.marketplace.elite.winback", "buy", "Win-back campaigns", "Bring back customers who stopped buying.", { coverage: "full", has: ["campaigns"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_winback_enabled", defaultOn: true }),
  m("buy.marketplace.elite.sections", "buy", "Storefront sections", "Page-builder sections on the storefront.", { coverage: "full", has: ["sections"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_storefront_sections_enabled", defaultOn: true }),
  m("buy.marketplace.elite.sms", "buy", "SMS receipts and alerts", "Text messages to customers.", { coverage: "full", has: ["SMS log"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_sms_alerts_enabled", defaultOn: true }),
  m("buy.marketplace.elite.digital", "buy", "Digital products", "Downloads, licence keys and course access.", { coverage: "full", has: ["digital products", "fulfilments"] }, { parent: "buy.marketplace.elite", liveKey: "marketplace_elite_digital_products_enabled", defaultOn: true }),
  m("buy.marketplace.elite.lms", "buy", "Course sync", "Digital course sales enrol learners in Peebee Learn.", { coverage: "full", has: ["course enrolments"] }, { parent: "buy.marketplace.elite.digital", liveKey: "marketplace_elite_lms_sync_enabled", defaultOn: true }),
  m("ride.taxipress.luggage", "ride", "Luggage options", "Passengers choose luggage and pay by size.", { coverage: "full", has: ["luggage bookings"] }, { parent: "ride.taxipress", liveKey: "taxipress_luggage_enabled", defaultOn: true }),
  m("ride.taxipress.assistance", "ride", "Assistance", "Passengers ask for help boarding.", { coverage: "full", has: ["assistance requests"] }, { parent: "ride.taxipress", liveKey: "taxipress_assistance_enabled", defaultOn: true }),
  m("ride.taxipress.language", "ride", "Driver language", "Passengers choose the language they speak.", { coverage: "full", has: ["language choices"] }, { parent: "ride.taxipress", liveKey: "taxipress_language_enabled", defaultOn: true }),
  m("ride.taxipress.others", "ride", "Book for someone else", "Buy seats for another passenger.", { coverage: "full", has: ["bookings for others"] }, { parent: "ride.taxipress", liveKey: "taxipress_book_for_others_enabled", defaultOn: true }),

  // Learn
  m("learn", "learn", "Peebee Learn", "Schools, classes and courses.", { coverage: "full", has: ["schools", "learners", "educators", "courses", "lessons"] }, { liveKey: "learn_enabled", defaultOn: true }),
  m("learn.masterclasses", "learn", "Masterclasses", "One-off paid expert sessions.", { coverage: "full", has: ["creators", "masterclass bookings"] }, { parent: "learn", liveKey: "learn_masterclasses_enabled", defaultOn: true }),
  m("learn.paid_courses", "learn", "Paid courses", "Courses sold to learners.", { coverage: "full", has: ["courses", "invoices"] }, { parent: "learn", liveKey: "learn_paid_courses_enabled", defaultOn: true }),
  m("learn.live", "learn", "Live classes", "Live classrooms with whiteboard and chat.", { coverage: "full", has: ["meetings", "participants", "chat"] }, { parent: "learn", liveKey: "learn_live_enabled", defaultOn: true }),
  m("learn.tv", "learn", "TV Learn", "Learning on the TV app.", { coverage: "full", has: ["trial picker", "TV pairing"] }, { parent: "learn", liveKey: "learn_tv_learn_enabled", defaultOn: true }),
  m("learn.certificates", "learn", "Certificates", "Issued when a course is completed.", { coverage: "full", has: ["credentials"] }, { parent: "learn", liveKey: "learn_certificates_enabled", defaultOn: true }),
  m("learn.assignments", "learn", "Assignments", "Homework, submissions and marking.", { coverage: "full", has: ["worksheets", "submissions", "merits"] }, { parent: "learn", liveKey: "learn_assignments_enabled", defaultOn: true }),
  m("learn.reviews", "learn", "Course reviews", "Learners rate courses.", { coverage: "full", has: ["peer review", "course ratings"] }, { parent: "learn", liveKey: "learn_reviews_enabled", defaultOn: true }),
  m("learn.subscriptions", "learn", "Subscriptions", "Passes that unlock learning.", { coverage: "full", has: ["subscription passes"] }, { parent: "learn", liveKey: "learn_subscriptions_enabled", defaultOn: true }),

  m("learn.enrolments", "learn", "Enrolment", "Learners join published courses, free or paid from their wallet.", { coverage: "full", has: ["courses", "enrolments"] }, { parent: "learn", liveKey: "learn_enrolments_enabled", defaultOn: true }),
  m("learn.uploads", "learn", "Video and audio uploads", "Educators attach files to lessons.", { coverage: "full", has: ["lessons", "uploaded media"] }, { parent: "learn", liveKey: "learn_video_uploads_enabled", defaultOn: true }),
  m("learn.fees", "learn", "School fees", "Schools invoice learners, who pay from their wallet.", { coverage: "full", has: ["tuition invoices"] }, { parent: "learn", liveKey: "learn_fees_enabled", defaultOn: true }),
  m("learn.live_lessons", "learn", "Live video lessons", "Scheduled lessons with a Zoom, Meet or Jitsi link.", { coverage: "full", has: ["live meetings"] }, { parent: "learn", liveKey: "learn_live_lessons_enabled", defaultOn: true }),
  m("learn.trial_classes", "learn", "Trial live classes", "Anyone signed in can join a practice class.", { coverage: "full", has: ["trial class", "tutors"] }, { parent: "learn", liveKey: "learn_trial_classes_enabled", defaultOn: true }),
  m("learn.badges", "learn", "Badges", "Milestone badges for learners.", { coverage: "full", has: ["merit stars", "stickers"] }, { parent: "learn", liveKey: "learn_badges_enabled", defaultOn: true }),
  m("learn.drip", "learn", "Drip release", "Sections open some days after enrolment.", { coverage: "full", has: ["scheduled section release"] }, { parent: "learn", liveKey: "learn_drip_enabled", defaultOn: true }),
  m("learn.prerequisites", "learn", "Prerequisites", "Items done in order, or another course first.", { coverage: "full", has: ["locked lessons"] }, { parent: "learn", liveKey: "learn_prerequisites_enabled", defaultOn: true }),
  m("learn.coupons", "learn", "Coupons", "Discount codes on courses.", { coverage: "full", has: ["coupon codes"] }, { parent: "learn", liveKey: "learn_coupons_enabled", defaultOn: true }),
  m("learn.bundles", "learn", "Bundles", "Several courses sold for one price.", { coverage: "full", has: ["bundles"] }, { parent: "learn", liveKey: "learn_bundles_enabled", defaultOn: true }),
  m("learn.qa", "learn", "Questions and answers", "Learners ask questions on a lesson.", { coverage: "full", has: ["questions", "upvotes"] }, { parent: "learn", liveKey: "learn_qa_enabled", defaultOn: true }),
  m("learn.announcements", "learn", "Announcements", "Educators post to a course.", { coverage: "full", has: ["guardian alerts", "course announcements"] }, { parent: "learn", liveKey: "learn_announcements_enabled", defaultOn: true }),
  m("learn.cohorts", "learn", "Cohorts", "Intakes of a course with a start date and seat limit.", { coverage: "full", has: ["cohorts"] }, { parent: "learn", liveKey: "learn_cohorts_enabled", defaultOn: true }),
  m("learn.instructors", "learn", "Extra teachers", "Other teachers who edit and mark a course.", { coverage: "full", has: ["educators", "co-teaching"] }, { parent: "learn", liveKey: "learn_instructors_enabled", defaultOn: true }),

  // Hive
  m("hive", "hive", "Hive", "Home services and hiring.", { coverage: "full", has: ["customers", "providers", "workers"] }),
  m("hive.work", "hive", "Home services (Work)", "Clean, Laundry and Fix jobs with providers.", { coverage: "full", has: ["providers", "catalogue", "jobs", "photos"] }, { parent: "hive", liveKey: "work_enabled", defaultOn: true }),
  m("hive.work.chat", "hive", "Job chat", "Customer and provider chat on a job.", { coverage: "full", has: ["messages", "photo messages"] }, { parent: "hive.work", liveKey: "work_chat_enabled", defaultOn: true }),
  m("hive.work.tracking", "hive", "Provider tracking", "Live location of a provider on the way.", { coverage: "full", has: ["job status", "live location"] }, { parent: "hive.work", liveKey: "work_tracking_enabled", defaultOn: true }),
  m("hive.work.photos", "hive", "Photos on jobs", "Customer and provider attach photos to a job.", { coverage: "full", has: ["jobs", "job photos"] }, { parent: "hive.work", liveKey: "work_photos_enabled", defaultOn: true }),
  m("hive.work.tomorrow", "hive", "Book for tomorrow", "Offer “Tomorrow” as a time for a job.", { coverage: "full", has: ["jobs"] }, { parent: "hive.work", liveKey: "work_schedule_tomorrow_enabled", defaultOn: true }),
  m("hive.work.onsite", "hive", "On-site checks", "Confirm the provider arrived at the address.", { coverage: "full", has: ["arrival checks"] }, { parent: "hive.work", liveKey: "work_onsite_check_enabled", defaultOn: false }),
  m("hive.hire", "hive", "Peebee Hire", "Find workers, gigs and projects.", { coverage: "full", has: ["workers", "gigs", "projects", "hiring posts", "escrow"] }, { parent: "hive", liveKey: "talent_enabled", defaultOn: false }),
  m("hive.hire.gigs", "hive", "Gigs", "Short jobs workers apply to.", { coverage: "full", has: ["gigs", "applications"] }, { parent: "hive.hire", liveKey: "talent_gigs_enabled", defaultOn: true }),
  m("hive.hire.projects", "hive", "Projects", "Larger jobs with milestones.", { coverage: "full", has: ["projects", "milestones"] }, { parent: "hive.hire", liveKey: "talent_projects_enabled", defaultOn: true }),
  m("hive.hire.hiring", "hive", "Hiring posts", "Employers advertise open roles.", { coverage: "full", has: ["roles"] }, { parent: "hive.hire", liveKey: "talent_hiring_enabled", defaultOn: true }),
  m("hive.hire.search", "hive", "Worker search", "Customers browse workers.", { coverage: "full", has: ["workers"] }, { parent: "hive.hire", liveKey: "talent_worker_search_enabled", defaultOn: true }),
  m("hive.hire.reviews", "hive", "Ratings", "Employers and workers rate each other.", { coverage: "full", has: ["workers", "rating history"] }, { parent: "hive.hire", liveKey: "talent_reviews_enabled", defaultOn: true }),
  m("hive.hire.chat", "hive", "Messaging", "Employer and applicant chat.", { coverage: "full", has: ["applications", "conversations"] }, { parent: "hive.hire", liveKey: "talent_chat_enabled", defaultOn: true }),
  m("hive.hire.recurring", "hive", "Repeat jobs", "Rebook the same worker daily, weekly or monthly.", { coverage: "full", has: ["recurring jobs"] }, { parent: "hive.hire", liveKey: "talent_recurring_enabled", defaultOn: true }),


  // Channels. Live only: Practice does not simulate channels, so these have no Practice switch.
  c("channels", "Channels", "Creator channels, posts and everything below. Off hides all of it; store and other module posts in the Spotlight stay.", "enabled"),
  c("channels.open", "Opening a channel", "Anyone can open or convert to a channel. Off stops new channels.", "general.channelsOpen", "channels"),
  c("channels.posts.video", "Video posts", "Creators can post videos.", "publishing.postTypes", "channels", "video"),
  c("channels.posts.image", "Photo posts", "Creators can post single images.", "publishing.postTypes", "channels", "image"),
  c("channels.posts.carousel", "Carousel posts", "Creators can post image carousels.", "publishing.postTypes", "channels", "carousel"),
  c("channels.posts.text", "Text and poll posts", "Creators can post text and polls.", "publishing.postTypes", "channels", "text"),
  c("channels.posts.audio", "Audio posts", "Creators can post audio.", "publishing.postTypes", "channels", "audio"),
  c("channels.scheduling", "Scheduling posts", "Creators can schedule posts for later.", "publishing.schedulingEnabled", "channels"),
  c("channels.comments", "Comments", "People can comment on posts.", "publishing.commentsEnabled", "channels"),
  c("channels.likes", "Likes", "People can like posts.", "publishing.reactionsEnabled", "channels"),
  c("channels.live", "Going live", "People can go live from their phone camera.", "live.enabled", "channels"),
  c("channels.live.comments", "Live comments", "Viewers can comment while a stream is on.", "live.commentsEnabled", "channels.live"),
  c("channels.live.helper", "Helper device", "The host can use a second device to read, hide and pin comments.", "live.helperEnabled", "channels.live"),
  c("channels.live.broadcasts", "Broadcasts", "A channel airs pre-recorded videos back to back like a TV station.", "live.broadcastsEnabled", "channels.live"),
  c("channels.live.premieres", "Premieres", "A channel premieres a video with a countdown and live chat.", "live.premieresEnabled", "channels.live"),
  c("channels.live.reminders", "Airing reminders", "People can tap Remind me before an airing starts.", "live.remindersEnabled", "channels.live"),
  c("channels.money", "Money from audiences", "Memberships, paid posts, tips and gifts.", "monetization.enabled", "channels"),
  c("channels.money.memberships", "Memberships", "Creators sell monthly memberships.", "monetization.memberships", "channels.money"),
  c("channels.money.payperview", "Pay-per-view posts", "Creators charge for single posts.", "monetization.payPerView", "channels.money"),
  c("channels.money.tips", "Tips", "People can tip a creator.", "monetization.tips", "channels.money"),
  c("channels.money.gifts", "Gifts", "People can send gifts on posts and live streams.", "monetization.gifts", "channels.money"),
  c("channels.causes", "Causes", "Fundraising campaigns and donations.", "causes.enabled", "channels"),
  c("channels.rewards", "Rewards", "Points for views and cash-outs.", "rewards.enabled", "channels"),
  c("channels.withdrawals", "Cash withdrawals", "Paying creators out.", "kyc.withdrawalsEnabled", "channels"),

  // Money
  m("money", "money", "Money", "Paid memberships and reading aloud.", { coverage: "full", has: ["wallets", "mobile money"] }),
  m("money.pro", "money", "Peebee Pro", "Paid subscription for riders and stores.", { coverage: "full", has: ["rider Pro card", "store Pro", "renewals"] }, { parent: "money", liveKey: "pro_subscription_enabled", defaultOn: false }),
  m("money.luganda_audio", "money", "Luganda list reading", "Read shopping lists aloud in Luganda.", { coverage: "full", has: ["audio samples"] }, { parent: "money", liveKey: "luganda_audio_enabled", defaultOn: false }),
];

/** The modules the Practice world simulates: everything except those marked as not part of it (Channels). */
export const PRACTICE_MODULES: readonly ModuleDef[] = MODULES.filter((x) => x.practice.coverage !== "none");

export const MODULE_KEYS: readonly string[] = MODULES.map((x) => x.key);

const BY_KEY = new Map(MODULES.map((x) => [x.key, x]));
export const getModule = (key: string): ModuleDef | undefined => BY_KEY.get(key);

/** A cluster's own top-level module is the one whose key equals the cluster id, if any; otherwise its roots are those with no parent. */
export function parentOf(def: ModuleDef): ModuleDef | undefined {
  return def.parent ? BY_KEY.get(def.parent) : undefined;
}

export function childrenOf(key: string): ModuleDef[] {
  return MODULES.filter((x) => x.parent === key);
}

/** Per-world switches as stored: what an admin set, before the parent chain is applied. */
export type ModuleFlags = Record<string, { live: boolean; practice: boolean }>;

/** What a module is actually doing: its own switch AND every module above it. */
export type ModuleAvailability = Record<string, { live: boolean; practice: boolean }>;

export function resolveModuleAvailability(flags: ModuleFlags, sync = false): ModuleAvailability {
  const out: ModuleAvailability = {};
  const resolve = (def: ModuleDef): { live: boolean; practice: boolean } => {
    const done = out[def.key];
    if (done) return done;
    const own = syncedFlag(def, flags[def.key] ?? { live: true, practice: true }, sync);
    const up = def.parent ? resolve(BY_KEY.get(def.parent)!) : { live: true, practice: true };
    return (out[def.key] = { live: own.live && up.live, practice: own.practice && up.practice });
  };
  for (const def of MODULES) resolve(def);
  return out;
}

/**
 * Why a module is off, and what people see where it used to be. Admin picks the reason when switching a module off;
 * a message and a date are optional on top of the reason's own wording.
 */
export type ModuleNoticeReason = "coming_soon" | "maintenance" | "unavailable";
export type ModuleNotice = { reason: ModuleNoticeReason; message?: string; /** A launch or return date, `YYYY-MM-DD` or a full ISO time. */ returnAt?: string };

export const MODULE_NOTICE_MESSAGE_MAX = 200;

export const MODULE_NOTICE_REASONS: readonly { id: ModuleNoticeReason; label: string; headline: string; dateLabel: string; hint: string }[] = [
  { id: "coming_soon", label: "Coming soon", headline: "Coming soon", dateLabel: "Launching", hint: "Not launched yet. Add a launch date if you have one." },
  { id: "maintenance", label: "Back soon", headline: "Back soon", dateLabel: "Expected back", hint: "Switched off for maintenance or an upgrade. Add when it returns." },
  { id: "unavailable", label: "Not available", headline: "Not available right now", dateLabel: "Expected", hint: "A plain notice when there is no more to say." },
];

export const DEFAULT_MODULE_NOTICE: ModuleNotice = { reason: "unavailable" };

/** Stored notices, by module. Only modules that are off carry one when served, so a stale note never shows on a live module. */
export type ModuleNotices = Record<string, ModuleNotice>;

/**
 * With "keep Live and Practice the same" on, a module is on only if it is on in both worlds, so something off in one is
 * off in the other. Modules Practice does not simulate (Channels) have no Practice switch to compare, so they keep Live's.
 */
export function syncedFlag(def: ModuleDef, own: { live: boolean; practice: boolean }, sync: boolean): { live: boolean; practice: boolean } {
  if (!sync || def.practice.coverage === "none") return own;
  const both = own.live && own.practice;
  return { live: both, practice: both };
}

/** The wire shape of GET /v1/settings `modules`: raw flags (for the admin editor), resolved availability (for apps), and why things are off. */
export type ModuleSettings = { flags: ModuleFlags; available: ModuleAvailability; notices?: ModuleNotices; /** Live and Practice are kept the same. */ sync?: boolean; /** What a switched-off module looks like everywhere else: gone, or greyed out. */ display?: ModuleOfflineDisplay };

/** Admin's choice for what a switched-off module looks like on every screen that refers to it. Opening its own page always shows "Currently Offline". */
export type ModuleOfflineDisplay = "hide" | "inactive";
export const MODULE_OFFLINE_DISPLAYS: readonly { id: ModuleOfflineDisplay; label: string; hint: string }[] = [
  { id: "hide", label: "Hide it", hint: "Every button, link, card, tab and mention of it disappears." },
  { id: "inactive", label: "Grey it out", hint: "Buttons, links, cards and tabs stay where they are, greyed out and not tappable." },
];

/** Admin write: only the flags that changed, per world. A notice of `null` clears it. */
export type ModuleSettingsUpdate = { live?: Record<string, boolean>; practice?: Record<string, boolean>; notices?: Record<string, ModuleNotice | null>; sync?: boolean; display?: ModuleOfflineDisplay };

/** The notice to show for a module that is off: its own, else the nearest module above it that has one, else a plain "not available". */
export function noticeFor(key: string, notices: ModuleNotices | null | undefined): ModuleNotice {
  for (let def = getModule(key); def; def = def.parent ? getModule(def.parent) : undefined) {
    const n = notices?.[def.key];
    if (n) return n;
  }
  return DEFAULT_MODULE_NOTICE;
}

/** Trims and bounds a notice from the outside world; returns null for anything that is not one. */
export function cleanModuleNotice(input: unknown): ModuleNotice | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const reason = MODULE_NOTICE_REASONS.find((r) => r.id === raw.reason)?.id;
  if (!reason) return null;
  const message = typeof raw.message === "string" ? raw.message.trim().slice(0, MODULE_NOTICE_MESSAGE_MAX) : "";
  const returnAt = typeof raw.returnAt === "string" && raw.returnAt.length <= 40 && Number.isFinite(Date.parse(raw.returnAt)) ? raw.returnAt : "";
  return { reason, ...(message ? { message } : {}), ...(returnAt ? { returnAt } : {}) };
}

export const MODULE_SWITCHES_STORAGE_KEY = "peebee_module_availability";

/** Remembers the last availability the API sent so code outside React (the practice world) can ask without a request. */
export function rememberModuleAvailability(available: ModuleAvailability | undefined) {
  try {
    if (available && typeof window !== "undefined") window.localStorage.setItem(MODULE_SWITCHES_STORAGE_KEY, JSON.stringify(available));
  } catch { /* storage blocked: modules then read as on */ }
}

function readRemembered(): ModuleAvailability | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(MODULE_SWITCHES_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ModuleAvailability) : null;
  } catch { return null; }
}

/** Is this module on for the given world? Unknown modules and an unloaded cache read as on, so a slow load never hides things. */
export function isModuleOn(key: string, world: ModuleWorld, available: ModuleAvailability | null | undefined = readRemembered()): boolean {
  return available?.[key]?.[world] ?? true;
}

/** Practice runs only on the device that opted in; the same helper the practice world answers with. */
export function practiceModuleOn(key: string): boolean {
  return isModuleOn(key, "practice");
}

/** Where an app already reads each module from in GET /v1/settings, so existing screens obey the switches without changes. */
const SETTINGS_PATH: Record<string, string> = {
  "ride": "services.ride", "ride.move": "services.cargo", "deliver.parcel": "services.parcel", "buy.shopping": "services.shopping", "buy.food": "services.food",
  "ride.for_other": "rideForOtherEnabled", "ride.bidding": "bidding.enabled",
  "ride.car": "car.enabled", "ride.car.ondemand": "car.onDemandEnabled", "ride.car.scheduled": "car.scheduled.enabled", "ride.car.carpool": "car.carpool.enabled",
  "ride.car.selfdrive": "car.selfDrive.enabled", "ride.car.deals": "car.deals.enabled",
  "buy.marketplace": "marketplace.enabled", "buy.marketplace.live": "marketplace.liveEnabled", "buy.pharmacy": "pharmacy.enabled", "buy.gas": "gas.enabled",
  "hive.work": "work.enabled", "money.pro": "proSubscriptionEnabled", "money.luganda_audio": "lugandaAudioEnabled",
};

/**
 * Settings an app receives, narrowed to what the given world allows. In Live the stored values already are the Live
 * switches, so a module can only turn one off (a parent being off). In Practice the stored values are ignored: the
 * Practice switch decides, so something off in Live can still be tried there.
 */
export function applyModuleAvailability<T extends object>(settings: T, available: ModuleAvailability | undefined, world: ModuleWorld): T {
  if (!available) return settings;
  const next = structuredClone(settings) as Record<string, unknown>;
  for (const [key, path] of Object.entries(SETTINGS_PATH)) {
    const on = isModuleOn(key, world, available);
    if (on && world === "live") continue;
    const parts = path.split(".");
    let node: Record<string, unknown> | undefined = next;
    for (const part of parts.slice(0, -1)) node = node && typeof node[part] === "object" && node[part] ? (node[part] as Record<string, unknown>) : undefined;
    const last = parts[parts.length - 1]!;
    if (node && last in node) node[last] = on;
  }
  return next as T;
}

function channelValue(config: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), config);
}

/** Is a Channels module's switch on in this stored Channels config (JSON text)? */
export function channelModuleOn(def: ModuleDef, rawConfig: string | undefined): boolean {
  if (!def.channel) return true;
  let parsed: unknown = {};
  try { parsed = JSON.parse(rawConfig || "{}"); } catch { /* an unreadable config reads as defaults */ }
  const value = channelValue(sanitizeChannelsConfig(parsed), def.channel.path);
  return def.channel.includes ? Array.isArray(value) && value.includes(def.channel.includes) : value === true;
}

/** The Channels-config patch that turns a Channels module on or off, given the config as it is now. */
export function channelModulePatch(def: ModuleDef, current: unknown, on: boolean): Record<string, unknown> {
  const { path, includes } = def.channel!;
  if (!includes) return { [path]: on };
  const list = channelValue(current, path);
  const next = new Set(Array.isArray(list) ? (list as string[]) : []);
  if (on) next.add(includes); else next.delete(includes);
  return { [path]: [...next] };
}
