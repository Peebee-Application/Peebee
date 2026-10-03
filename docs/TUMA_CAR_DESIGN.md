# Tuma Car — design document (phase a)

Status: **Draft for review — no code written.** Waiting for approval before phase (b).
Scope: car/van/truck transport next to boda — on-demand rides, carpooling, self-drive hire, scheduled rides.

Legend: **[V]** verified in the repo at `main` (file named). **[A]** assumption I am making. **[?]** needs your decision.

---

## 0. Things in the brief that don't match the repo (please read first)

1. **TomTom is map tiles only [V].** `apps/*/lib/map-tiles.ts` / `navTiles.ts` only build raster tile URLs. There is no TomTom routing, search or ETA call. Geocoding is OSM Nominatim, driving routes are the public OSRM demo router (`router.project-osrm.org`). → Scheduled-ride tracking should **not** depend on a routing API (see §6.4).
2. **There are no QR payments [V].** The only "code" payment is the merchant **outlet code** (`merchant_outlets.code`) used by riders paying merchants. Tuma Car does not need QR for v1; I list it as out of scope unless you want pickup/handover QR codes.
3. **No licence registry or "KYC tier" exists [V].** KYC today = phone/email verified (`users.phone_verified_at`), rider national-ID scan + admin verify (`riders.national_id_key`, `riders.verified`), and `merchant_kyc_cases` for merchants. Nothing queries a national registry; nothing is called "tier". RSLA has a member profile (`stage_members`, migration 0062) but no formal deeper-KYC level. → I propose a `kyc_level` column and a licence-verification adapter that is **manual-review at launch** (§5).
4. **`users.role` is `CHECK (customer|rider|admin)` [V, 0001_init.sql]** on a live table. Adding a `driver`/`owner` role means rebuilding `users`. Precedent for avoiding that: ride orders reuse `orders.type='parcel'` + `is_ride` (0039) and restaurants hang off `restaurants.owner_id` with admin approval (0032). → Car owners/drivers stay `role='customer'` and are identified by rows in new tables.
5. **`payments.order_id` is `NOT NULL REFERENCES orders` [V, 0001]** and `orders.type` is `CHECK (shopping|parcel)`. Money flows (collection/refund/disbursement) are order-shaped. → Every car booking gets a linked `orders` row (see §3.1, decision D1).
6. **Two money systems coexist [V].** (i) Wallet balances: `users.wallet_balance(_sandbox)` + `wallets` (multi-wallet, 0045) + `wallet_ledger`, moved by `apps/api/src/wallet/service.ts` (`creditWallet/debitWallet/payFromWallet/refundOrderToWallet/transfer*`); riders have `riders.wallet_balance` + `wallet_withdrawals`(rider-only, 0012). (ii) A double-entry ledger `ledger_accounts / ledger_transactions / ledger_entries` (0048) with idempotent `postLedgerTransaction` (`apps/api/src/ledger/service.ts`, owner types `platform|customer|order|merchant|rider|provider`). Merchant money uses (ii); customers/riders use (i). → Car money should use (ii) for escrow/fees/deposits and settle owner/driver earnings into a withdrawable wallet balance (§4).
7. **Migration numbering has gaps/duplicates [V]** (two `0012`, `0013`, `0042`, `0043`). Next free number is **0064**.
8. **CI is red on every commit on `main` [V]** (the `CI` workflow, independent of deploy). Not caused by this work, but "tests pass" needs a local run until that's fixed.

---

## 1. Existing code we will reuse (all [V])

| Need | Reuse |
|---|---|
| Auth, JWT, admin roles | `apps/api/src/auth/*`, `packages/shared/src/permissions.ts` (`Permission`, `ADMIN_ROLES`), `admin/permissions.ts`, activity log + revert (`admin/activity.ts`) |
| Settings / admin config | `settings` table + `getSetting/setSetting`, `settings/routes.ts` (zod `updateSchema`, `PAYMENTS_FIELDS` permission gating), admin app `app/settings/*` pages, `SettingsPageShell` |
| Wallet / money | `wallet/service.ts`, `ledger/service.ts`, `payments/service.ts` + provider adapters (`yo`, `flutterwave`, `mtn`, `airtel`, each with a `mock.ts`), `payments_active_providers` + demo mode, sandbox/live `environment` on every money row |
| Provider swap | `payments/gateway.ts` (`PaymentGatewayAdapter`, `resolveProvider`) — **no Car code talks to a provider directly** |
| Ride request, tracking | `orders` (+`is_ride`, `rider_lat/lng/location_updated_at`, `PickedUp` stage), `/orders/:id/location`, `LiveTrackingMap` |
| Fare negotiation | `fee_proposals` (driver proposes new total, customer accepts/rejects), `FeeProposalCard` |
| Waiting/cancel fees | `order_time_fees`, `orders.time_fee_policy` snapshot, transition-token pattern in `orders/time-fees.ts` |
| Matching | `matching_mode` (first_to_claim / nearest_window / customer_selects), `order_applications`, `rider_order_locks` |
| Notifications | `lib/webpush.ts notifyUser()`, `push/routes.ts` |
| Chat / calls / ratings | order chat, `calls/*`, `order_ratings` |
| Files | R2 binding `RIDER_DOCS` via `storage/r2.ts` (admin-only retrieval pattern) |
| Scheduled work | Cron `*/2 * * * *` and `0 3 * * *` in `worker.ts` / `wrangler.jsonc` (e.g. `sweepExpiredOrders`) |
| Place picking | `PlaceFlow` (map / search / saved places) for pickup, destination, route |
| Vetting pattern | rider verify flow, `merchant_kyc_cases`, restaurant `pending_approval → active → suspended` |
| Feature gating | `settings` flags (`merchant_payments_enabled`), `platform_environment` live/sandbox, `merchant_custody_approvals` for live custody |

---

## 2. Decisions I need from you before phase (b) — [?]

| # | Question | My recommendation |
|---|---|---|
| D1 | **Booking model.** (A) every car booking = a commercial `car_bookings` row **plus a linked shadow `orders` row** (so payments, chat, calls, events, push links, ratings, tracking, time-fees all work unchanged); or (B) a fully parallel set of tables. | **A.** Far less to rebuild; `orders.type` stays `parcel`. Costs: a few new nullable columns on `orders`; carpool seats map to one shadow order per seat-booking. |
| D2 | **Where do owner/driver earnings sit?** Rider wallet columns are on `riders`; customer wallet is on `users`. | Credit **`users.wallet_balance`** (they are users) via ledger-backed postings; generalise `wallet_withdrawals` to non-riders (it is `rider_id`-keyed today). |
| D3 | **New app name/host.** | `apps/car` → `car.tumaffe.online` (one worker, owner + driver modes behind one sign-in). Needs deploy-matrix + preview-hub + CORS entries. |
| D4 | **Owner vs driver identity.** One person can be both. | One `car_partners` row per user with capability flags `is_owner`, `is_driver`; drivers may be attached to an owner's listing. |
| D5 | Seat price: do you want the **suggested price** table maintained by admin only (manual), or fed externally later? (listed as undecided in the brief) | Manual admin table at launch, with `source` + `updated_at` columns so a feed can replace it. |

### Resolved by you (supersedes the recommendations above where they differ)

| # | Decision |
|---|---|
| D1 | **Yes** — every car booking carries a linked `orders` row, so payments, chat, calls, tracking, ratings and fees work unchanged. Car rides "work the same way boda rides work". |
| D2 | **Yes** — owner and driver earnings are credited to the wallet balance; withdrawals are opened to non-riders. |
| D3 | **Two separate apps, not one:** an **Owner app** and a **Driver app**. A driver can also be an owner (one account, both apps). The Owner app shows the owner's vehicles and **rides currently being taken** (live). |
| D3a | **Supply flow:** owners put a car up for service → Tuma managers see newly available cars in the admin app → managers **assign drivers** to them → drivers use those cars on the Driver app. (So "listing" = owner offers a vehicle; "assignment" = admin links it to a driver. A car with no assigned driver is not bookable with-driver.) |
| D3b | **Predefined profit share** between **owner / driver / platform**, set by admin (per category, with a global default), applied when a booking completes. Replaces the idea of the owner pricing a separate driver fee. |
| D4 | **Yes** — one person can be both owner and driver. |
| D5 | **Prices are determined in the app** (category rates / suggested price). In addition, **drivers and riders can bid** with a different price; the customer sees all bids and **picks** one. Bidding only works when the admin has allowed multiple applications ("Let me choose" matching mode) and switched bidding on. **Applies to boda rides too.** |

**Delivered so far (this PR): D5 for boda** — `bidding_enabled`, `bidding_min_percent`, `bidding_max_percent` settings (Admin → Rider matching); `order_applications.bid_amount`, `orders.app_price` (migration 0064); riders/drivers apply with a price inside the allowed range; the customer sees every bid beside the app price (best first) and picks; the chosen bid becomes the order total; auto-matching never applies a bid. Car drivers reuse the same endpoints/columns when the Driver app arrives.

Still open from your brief and **not decided here**: Tuma commission (§4 has the field, default off), advance-booking window (setting, no default — feature stays off until set), deposit amounts, penalty values, self-drive legal/insurance (lawyer).

---

## 3. Data model (proposed, migrations start at 0064)

All money tables carry `environment ('live'|'sandbox')`, integer UGX, `created_at/updated_at` as `datetime('now')` TEXT — same as existing tables. D1 limits respected: additive only, no non-constant `ADD COLUMN` defaults (the 0063 incident), no constraint rebuilds on live tables.

### 3.1 Catalog & vetting

- `vehicle_categories` — `id, kind ('passenger'|'cargo'), name, seats INT NULL, cargo_type TEXT NULL, size_label TEXT NULL, reference_image_key, suggested_price INT, suggested_unit ('trip'|'day'|'km'), deposit_amount INT NULL [?], active, sort`.
- `car_partners` — `user_id PK→users, is_owner, is_driver, status ('pending'|'approved'|'suspended'|'rejected'), kyc_level ('baseline'|'enhanced'), reviewed_by, reviewed_at`.
- `partner_kyc_cases` — same shape as `merchant_kyc_cases`: `phone_verified, identity_verified, id_document_key, licence_key (drivers), licence_number_hash, licence_expiry, notes, status`.
- `vehicles` — `id, owner_id→car_partners, plate UNIQUE, make, model, year, colour, status ('pending'|'approved'|'rejected'|'suspended'), reviewed_*`.
- `vehicle_documents` — `id, vehicle_id, type ('logbook'|'insurance'|'inspection'|'other'), r2_key, expires_at, status`. Expiry feeds a cron that auto-suspends listings.
- `vehicle_listings` — `id, vehicle_id, category_id, status ('draft'|'live'|'paused'|'suspended'), price INT, price_unit, **service_with_driver, service_self_drive** (flags; at least one), `driver_fee INT NOT NULL DEFAULT 0` (explicit even when 0), `base_lat/base_lng/base_area`, `title`, `completed_trips INT` (denormalised counter), cargo `type/size` via category.
- `listing_media` — `id, listing_id, r2_key, sort` (owner photos).
- `listing_availability` — `id, listing_id, starts_at, ends_at, kind ('blocked'|'booked')` — drives the "available vs booked" badge; written by bookings.
- `listing_drivers` — `listing_id, driver_user_id, active` (an owner's assigned drivers).

### 3.2 Bookings (all four modes)

- `car_bookings` — `id, mode ('on_demand'|'carpool'|'self_drive'|'scheduled'), order_id→orders (shadow order, D1), customer_id, listing_id, owner_id, driver_id NULL, status (see §6), with_driver INT, `vehicle_price, driver_fee, extras_fee, platform_fee (null until [?] decided), total`, `scheduled_for NULL`, `starts_at/ends_at` (self-drive), `fee_policy` JSON snapshot (penalties, waiting time — snapshotted at booking like `time_fee_policy`), `environment`.
- `car_booking_fees` — `id, booking_id, kind ('no_show'|'late_cancel'|'damage'|'deposit_forfeit'), amount, note, environment, UNIQUE(booking_id, kind)` (new table because `order_time_fees.amount` is `CHECK >= 500 AND %500` and rider-shaped).
- `orders` additions (nullable, additive): `service_class TEXT` ('boda' default NULL = boda, 'car', 'cargo'), `scheduled_for TEXT`, `vehicle_listing_id TEXT`. Boda behaviour unchanged when NULL.

### 3.3 Carpool

- `carpool_routes` — `id, owner_id, listing_id, origin_label/lat/lng, dest_label/lat/lng, distance_km`.
- `carpool_meeting_points` — `id, route_id, kind ('pickup'|'dropoff'), label, lat, lng, sort` (shared points along the route).
- `carpool_schedules` — `id, route_id, weekdays (bitmask), depart_time, seats_total, seat_price, suggested_price, door_pickup_fee NULL, door_dropoff_fee NULL, active, valid_from, valid_to` (recurring calendar rule).
- `carpool_trips` — `id, schedule_id, trip_date, depart_at, seats_total, seats_taken, status ('open'|'full'|'departed'|'completed'|'cancelled')` — **materialised by a nightly cron N days ahead** (N = admin setting) so seat counts are plain rows, not computed from rules.
- `carpool_seats` — `id, trip_id, booking_id, passenger_id, seats INT, pickup ('meeting'|'door'), dropoff ('meeting'|'door'), pickup_point_id, dropoff_point_id, door_lat/lng…, arrived_at, driver_waited_until, outcome ('boarded'|'no_show'|'cancelled')`. Seat taking is a conditional `UPDATE … WHERE seats_taken + ? <= seats_total` (same race-safe pattern as `time-fees.ts`).
- `route_fare_references` — `id, origin_label, dest_label, typical_fare INT, source, updated_at` (suggested-seat-price data, admin-maintained, [?] D5).

### 3.4 Self-drive

- `renter_licences` — `user_id, licence_key (R2), licence_number_hash, expiry, method ('registry'|'manual_photo'), status ('pending'|'verified'|'rejected'), verified_by, verified_at`.
- `rental_deposits` — `id, booking_id, amount, status ('held'|'released'|'partly_forfeited'|'forfeited'), ledger_tx_hold, ledger_tx_release, environment`.
- `rental_inspections` — `id, booking_id, phase ('pickup'|'return'), taken_by, completed_at` and `rental_inspection_photos` — `id, inspection_id, slot ('front'|'rear'|'left'|'right'|'interior'|'odometer'|'fuel'|…), r2_key, taken_at (server time), device_ts, lat, lng`. Required slots set by admin; a phase cannot complete until every slot has a photo (server-enforced).
- `rental_disputes` — `id, booking_id, raised_by, reason, status, resolution, amount` (links both inspections as evidence).

### 3.5 Scheduled rides

- Uses `car_bookings.scheduled_for` + `orders.scheduled_for` (boda **and** car). Driver is **assigned at booking** (`driver_id` set, `rider_order_locks` not used until the ride is near, to avoid blocking a rider for days).
- `scheduled_checks` — `id, booking_id, checked_at, driver_lat, driver_lng, distance_to_pickup_km, eta_minutes NULL, verdict ('on_track'|'late_risk'|'no_signal')` — audit of the tracking sweep.

### 3.6 Audit

Existing `order_events` (stage notes) on the shadow order + `car_booking_events` — `id, booking_id, type, actor_id, note, created_at` for handoff/photo/penalty timestamps. Ledger entries carry `referenceType='car_booking'`.

---

## 4. Money flow

1. **Quote:** `total = vehicle_price + (driver_fee if with driver) + extras (door pickup/drop-off) [+ platform_fee when [?] decided]`. A cap like `MAX_SERVICE_FEE_SHARE` applies to any platform fee shown to the customer.
2. **Pay upfront** (carpool, self-drive, scheduled; on-demand follows the existing escrow stage): through the existing `payments/service` against the **shadow order** (so provider swap, sandbox, reconciliation all apply) or `payFromWallet`. Ledger: customer → `order` escrow account.
3. **Release at completion:** escrow → owner payable (`vehicle_price`) and driver payable (`driver_fee`) → withdrawable wallet balance; platform fee (when decided) → platform account. Idempotency keys `car:<booking>:<step>`.
4. **Penalties** (admin-set amounts + percentages): *no-show* — driver waited the configured time then left → customer is charged `no_show_fee`, `driver_share_percent` of it goes to the driver, remainder platform; *late cancel* — fee if cancelled inside the admin window, rest refunded to wallet. Snapshotted into `car_bookings.fee_policy` at booking so later admin edits never change a booking in flight.
5. **Deposit (self-drive):** hold from wallet/card = ledger transfer customer → `deposit_hold` account; released on clean return, partly/fully forfeited on dispute resolution.
6. **Live money is behind `car_live_money_enabled`** (§7). With it off, car modes run in **sandbox environment only** (existing `*_sandbox` balances and mock provider adapters).

---

## 5. Vetting & KYC

- **Baseline (all partners and renters):** phone verified + national ID scan (R2, admin-only retrieval) + admin approval — the existing rider/merchant pattern, tracked in `partner_kyc_cases`.
- **Drivers:** + driving licence photo + expiry. **Owners:** + per-vehicle logbook/insurance/inspection; a vehicle cannot list until `approved`; expired documents auto-pause listings.
- **Renters:** licence photo cross-checked against the account identity by an admin (`method='manual_photo'`); a `LicenceVerifier` interface lets a registry adapter replace it later [A: registry access unknown].
- **RSLA-ready:** `car_partners.kyc_level` ('baseline' now; 'enhanced' later) so partners can later join RSLA at the deeper tier. The enhanced requirements themselves aren't defined in the repo [?].
- Vetting requirements (which documents are mandatory per role/category) are admin-configurable settings, not code.

---

## 6. Behaviour per mode

### 6.1 On-demand
Customer picks Boda/Car → category → pool of live listings (photo, price, **Available / Booked**, completed trips; truck type+size) → with driver / self-drive (if offered) → `PlaceFlow` for pickup/destination → book. Driver accepts (reusing apply/claim + lock logic); `fee_proposals` handles fare adjustment; tracking reuses `/orders/:id/location`.

### 6.2 Carpool
Owner builds a route + weekly schedule on a calendar; app shows `route_fare_references` as the suggested seat price (override allowed). Passenger searches by route/date, picks meeting points (or door pickup/drop-off with the owner's extra fees), pays upfront. At departure: driver "arrived" starts the waiting clock (`carpool_waiting_minutes`); after it, driver may mark **left** → no-show penalty flow. Passenger cancel after booking → late-cancel fee rules.

### 6.3 Self-drive
List a car with a flat daily rate. Renter: licence verified → deposit held → **pickup inspection** (all required photos, server timestamps) → trip → **return inspection** → deposit released or dispute raised with both photo sets side by side for admin.

### 6.4 Scheduled
Book boda or car for later (window = `scheduled_max_advance_hours`, **no default**). Driver locked at booking. A cron (every 2 min, existing) checks rides inside `scheduled_watch_minutes` of pickup: if the driver's last ping (`orders.rider_lat/lng`, written by the existing location endpoint) isn't getting closer to pickup within the expected window, or no signal → push to the customer ("your driver may be late") with **Re-match** / keep. Uses straight-line distance trend, not a routing API [A, because no ETA provider exists — see §0.1]; an ETA provider can be added behind the same check later.

---

## 7. Admin settings (all in Admin → new "Tuma Car" section; stored in `settings`, audited via the activity log; new permission `car.manage` + `car.vetting`)

Categories (CRUD, reference image, suggested price, deposit [?]); required vetting documents per role/category; carpool: `waiting_minutes`, no-show fee (amount or %), driver share of no-show %, late-cancel window + fee (amount or %), door pickup/drop-off fee guidance, seat-price reference table, `trip_materialise_days`; self-drive: required inspection slots, deposit per category [?]; scheduled: `max_advance_hours` (no default), `watch_minutes`, notify threshold; platform fee per mode (**fields exist, empty/off — [?] undecided**); document-expiry grace days.

### Feature flags (settings keys, default `0`)
`car_enabled` (master), `car_ondemand_enabled`, `car_carpool_enabled`, `car_selfdrive_enabled`, `car_scheduled_enabled`, `car_live_money_enabled`. Modes are only visible to customers when master + mode are on **and** (live env ⇒ `car_live_money_enabled` on). `scheduled` additionally requires `max_advance_hours` to be set.

---

## 8. API (all under `/v1`, zod-validated, same `requireAuth` middleware; paths indicative)

- **Public/customer:** `GET /car/categories`, `GET /car/listings?category=&near=`, `GET /car/listings/:id`, `POST /car/bookings` (mode-aware), `GET /car/bookings/:id`, `POST /car/bookings/:id/cancel`, carpool `GET /car/carpool/trips?from=&to=&date=` + `POST /car/carpool/trips/:id/seats`, rentals `POST /car/rentals/licence`, `POST /car/rentals/:id/inspection/:phase/photos`, scheduled `POST /car/bookings` with `scheduledFor`, `POST /car/bookings/:id/rematch`.
- **Partner (owner/driver):** `POST /car/partner/apply`, `GET/PUT /car/partner/profile`, vehicles + documents CRUD, listings CRUD (+ media upload, availability, service mode, driver fee), drivers assign/remove, carpool routes/schedules/trips, bookings inbox (accept/decline/arrived/waited/left/started/completed), earnings + `POST /car/partner/withdrawals` (generalised withdrawals, D2).
- **Admin:** `/admin/car/categories`, `/admin/car/partners` (+ approve/reject/suspend), `/admin/car/vehicles`, `/admin/car/listings` (moderate), `/admin/car/renters`, `/admin/car/bookings`, `/admin/car/disputes` (+ resolve with amounts), `/admin/car/settings`.
- **Cron:** nightly carpool-trip materialiser + document-expiry sweep; 2-minute scheduled-ride watcher + (existing) job-expiry style sweeps for unaccepted on-demand bookings.

---

## 9. Screens

**Customer app (changes):** Ride entry gets **Boda | Car** toggle (extends the existing "Where to?" / Ride tile) → category grid → vehicle pool cards → listing detail → booking summary (with driver / self-drive, extras, total, penalties disclosed up front) → payment (existing pay screen). Tabs/entries for **Carpool** (search, trip detail with meeting points + seat count), **Rent a car** (licence, deposit, inspection camera flow), **Schedule** (date/time picker inside the same flow). Bookings list shows all modes; tracking page reused. Wording per mode via the PlaceFlow `concept` pattern.

**Partner app (new `apps/car`):** onboarding/KYC; **Owner:** vehicles & documents, listings (photos, price vs suggested, service mode, driver fee, availability calendar), drivers, carpool routes + calendar, bookings, earnings/withdraw. **Driver:** job inbox, active job (navigate, arrived/waiting timer, start/finish), inspection capture (self-drive handover), earnings.

**Admin app:** the settings in §7 plus Vetting queue (partners, vehicles, documents, renter licences), Listings moderation, Bookings & Disputes (photo viewer), Car reports.

---

## 10. Phased plan (pause after each marked ⏸)

| Phase | Deliverable | Notes |
|---|---|---|
| **a** ✅ | This document; D1–D5 answered (see "Resolved by you") | |
| **0** ✅ | Bidding for boda (D5) — admin toggle + limits, bids on apply, customer picks | migration 0064 |
| **b** | Migrations 0064+ (catalog, partners, listings, bookings, carpool, self-drive, scheduled, audit, orders additions) + migration test that runs all migrations in-memory | additive only |
| **c** | API: catalog, partner onboarding/vetting, listings, booking engine for on-demand, then carpool, self-drive, scheduled; money via ledger + payments gateway behind flags; cron sweeps | tests per module (same harness as `expiry.integration.test.ts`) |
| **d** | Admin screens + permissions + settings | |
| **a–c** ✅ | Backend foundation: migration **0065** (new tables only), `car_*` settings + admin API (categories, owner/driver approval, vehicle approval, driver assignment, bookings), booking/bidding/driver endpoints, orders hooks (car rides never reach boda riders; settle splits owner/driver/platform), integration tests. Admin: `car_enabled`, `car_ondemand_enabled`, `car_matching_mode`, default shares, pickup radius — all default **off**. Linked order is a normal `orders` row (no new orders columns; `car_bookings.order_id` links them). | 0065 (apply by hand) |
| **e** | `apps/car` partner app (owner + driver) + deploy plumbing (matrix, preview-hub, CORS/CSP) | |
| **f** | Customer app changes | |
| **g** | End-to-end tests in sandbox env, flag matrix tests, docs/runbook | live-money flag stays off |

Out of scope, extension points only: Tours, matatu, relay, Connect, Marketplace, Ads, Warehouses, Packaging, Fix/Fuel. The shared pieces they would reuse are `vehicle_categories`/`vehicles`/`listings`, the ledger accounts, and the scheduling/availability tables.

---

## 11. Risks and open items

- Shadow-order approach (D1) touches the hottest tables (`orders`); mitigated by nullable additive columns and `service_class IS NULL ⇒ boda`.
- Public OSRM/Nominatim are demo services with usage limits — fine for pilot, not for volume; flagged for the hosting plan.
- Self-drive terms (liability, insurance, damage thresholds) need Ugandan legal review before `car_selfdrive_enabled` in live.
- Commission/fee, deposit amounts, penalty values, advance window: shipped as empty/disabled settings; features that depend on them stay off until you set them.
- Live money for any car mode additionally follows the existing custody-approval gate used for merchant funds [A: same gate applies].


---

## 12. Build status and deviations (updated after the build)

Shipped, all admin-controlled and off by default: on-demand rides with bidding, owner/driver/vehicle approval and driver assignment, owner/driver/platform profit share, the Partner app (Owner | Driver), cash-out of earnings, scheduled rides, carpool, self-drive hire.

Deliberate differences from the plan above:
- **Migrations are 0065–0069** (0064 is bidding): 0065 core, 0066 withdrawals, 0067 scheduled, 0068 carpool, 0069 self-drive. All additive; each mode's code is dormant until its migration is applied.
- **No new columns on `orders`.** A car ride links to its order through `car_bookings.order_id`; boda behaviour is unchanged.
- **Scheduled rides** open to drivers `openMinutes` before pickup instead of locking a driver at booking, so no driver is blocked for days. The customer pays after choosing a driver, as for any ride.
- **Carpool** uses single published trips (with an optional weekly repeat within an admin limit) rather than recurring schedule rules and a nightly materialiser. Meeting points, door pickup fees, no-show and late-cancel fees are not built (undecided values).
- **Self-drive** holds rent + deposit from the renter's wallet and releases them at the end (deposit back unless the owner claims damage, ruled on by an admin). Inspection photos, late-return fees and a licence verifier are not built; the licence is recorded, not verified. Needs Tuma's percentage set and a legal review before live money.
- Navigation in the Partner app opens the phone's maps app; there is no in-app map.
