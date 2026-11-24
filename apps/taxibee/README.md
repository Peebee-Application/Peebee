# Taxibee

Independent Peebee customer frontend at **https://taxibee.peebee.online**.

## Source and identity

The presentation is copied from `xristo7/flyexpress` at commit
`84e0470fb20f506d253068208fa25844b0a4f796`. Its screen renderers, responsive
layouts and interactions are retained in `public/script.js`, `index.html` and
`styles.css`. Branding uses the official Peebee symbol, black/charcoal, gold
`#c9a227`, and cream. `taxibee.css` contains identity overrides. Source demo
passwords and browser-local user registration have been removed.

`src/live.ts` is the TypeScript integration boundary. It uses Peebee's existing
`createApiClient`, account identities, TaxiPress queues/bookings, wallet and
payment APIs. The independent Worker forwards `/api/v1/*` to the existing
`https://api.peebee.online/v1/*`; it has no separate database or Taxibee-owned
schema. Additive schema changes are applied to Peebee's shared database through
the reviewed API migration workflow. Bearer credentials are forwarded only to
that fixed API origin.
Customer responses are never cached. No Cloudflare deployment token belongs
in app configuration or browser code.

Accounts and records are shared. Browser sessions are separate per origin:
customers sign in with their existing Peebee credentials in either app.

The app opens directly for everyone. Only account actions and submitting a
booking require sign-in. The on-demand account screen reuses the Customer app's
artwork, styles, identifier rules and shared authentication endpoints: Google,
or email/phone and password, including account creation and recovery. Google
uses the existing public OAuth client ID from `/v1/auth/config`; the OAuth
client must authorize `https://taxibee.peebee.online` as a JavaScript origin.

Booking choices survive reload and sign-in in this tab's session storage.
They contain no credentials, prices or payment consent; current availability
and prices are loaded again before confirmation. Sign-in never automatically
submits a booking. Signing out clears account-owned progress and private data.
Public routes expose current catalogue/aggregate availability and public taxi
profiles; booking, wallet and tracking endpoints remain authenticated.

Screen-protection overlays, focus/visibility hiding and print blocking have
been removed from both live and practice modes. Screenshots and printing work.

## Run and check

From the repository root with Node >=22 and pnpm 9.15.0:

```sh
pnpm install --frozen-lockfile
pnpm dev:taxibee
pnpm --filter taxibee typecheck
pnpm test:taxibee
pnpm build:taxibee
pnpm --filter taxibee test:browser
```

The development Worker listens on port 3015. Install the test browser with
`pnpm --filter taxibee exec playwright install chromium`, or set `CHROMIUM_PATH`
to an existing Chrome/Chromium executable. Use
`TAXIBEE_TEST_URL` for another local test server. The browser suite uses
controlled API fixtures and does not write to the live database or move money.

Workerd's local runtime may not resolve external hosts in a proxy-only cloud
environment. An upstream error is returned as a safe 502; it is not a failed
customer sign-in. For a local backend, override `API_ORIGIN` in Wrangler's dev
command. Production uses Cloudflare's network and the fixed Peebee API origin.

## Review the replica

`/?preview=1` exposes the complete UI for customer practice with sample data. Select
**Enter practice mode**. A persistent banner distinguishes this mode; it
does not authenticate, book, pay, or write through the API. This is the
surface for reviewing the full Fly Express replica before later redesigns.

The functional rollout, connected capabilities and remaining backend work are
tracked in [`docs/TAXIBEE-FUNCTIONALITY.md`](../../docs/TAXIBEE-FUNCTIONALITY.md).
Practice remains isolated from production account APIs. Live customer tools
also use shared account verification/password recovery, support conversations,
driver profiles/chat/tracking, ticket exports/sharing, offers, wallet transfers
and statements, saved contacts/places and account alerts. Admin configuration
and server eligibility determine availability.

The normal live app supports customer sign-in/registration, current route
queues, passenger/luggage bookings, wallet and mobile-money/cash payment,
server-issued boarding tickets, booking cancellation, wallet top-ups and
display-name updates. Prices, availability and eligibility come from Peebee.
Provider approval is required for real mobile-money settlement; no client
button can simulate it.

Numbered selection uses real departure inventory after migration 0168 and
staff approval of each taxi's layout. Holds, expiry, fees and payment deadlines
are server-controlled. Existing departures keep their allocation; older clients
get automatic numbers without a seat-choice fee. See the rollout instructions
in `docs/TAXIBEE-FUNCTIONALITY.md` before enabling it.

Prepaid return bundles use a server quote, one combined wallet/provider payment,
linked outbound/return allocations, reverse-route redemption, date conditions
and unused-return refunds. Apply migration 0169 and configure Admin → Taxipress
before offering them. Return capacity is chosen after outbound boarding, against
the actual queue; this does not promise a scheduled future departure.

Some source mockup behaviours have no equivalent in the current TaxiPress
API: synthetic traffic tracking, fixed-day hire packages and
preferred-driver guarantees. They remain in the labelled design preview. The live interface
does not fabricate them; services outside this integration direct customers
to Peebee. This release does not claim full backend parity with every mockup
screen. Changes to those services belong in Peebee's shared API and admin
settings, rather than a separate Taxibee database.

## Deploy

Corporate credit and prepaid travel vouchers use shared approved-account budgets,
receivables, primary-wallet repayments and source-preserving refunds after migration
0170. Both sales switches default off. See `docs/TAXIBEE-TRAVEL-CREDIT.md` for
staff approvals, funding limits, extra-charge terms and rollout instructions.

Future departures are staff-published TaxiPress slots that reserve separate
capacity, collect payment through Peebee, and activate into the physical queue
when the assigned driver checks in. Apply migration 0172 and configure the
default-off sale switch and schedule rules in Admin → Taxipress. See
`docs/TAXIBEE-FUTURE-DEPARTURES.md` for operating and refund behavior.

Saved queue departures sync across a customer's Taxibee sessions through the
shared account API after migration 0173. That migration was applied on
2026-11-24; inactive queue items are removed from the saved list.

Merge via PR. Deploy the shared API and apply reviewed migrations first, then
run the existing `Deploy to Cloudflare` workflow on clean `main` with
`apps=taxibee` and `target=live`. The existing deployment preflight is
required. The Worker is `peebee-taxibee`; Wrangler attaches
`taxibee.peebee.online` as a custom domain.
Only the existing Peebee Cloudflare account and zone are used. Existing apps,
Workers, DNS records, and the shared API are not redeployed by this command.

## Parcels and special hire

Live parcel preparation uses shared delivery/relay quotes and creates real Peebee
parcel orders after sign-in and explicit confirmation. Sender/recipient contacts
travel in the order item instructions. The status view uses server-issued delivery
and collection codes, relay legs, actual order photos, chat and shared checkout.
Direct rider delivery remains available where relay is not offered.

Special Hire uses approved passenger categories from Peebee Car, category fares,
optional hourly luxury chauffeur hire and scheduled pickup where enabled by Admin.
A category request does not reserve a specific driver or vehicle; assignment is
shown when confirmed by the server. Fixed-day packages, self-drive and preferred
driver guarantees are outside this integration.

Public service catalogue/quotes use `/v1/taxibee-services/*`; history requires a
customer session and is restricted to its owner and platform environment. Existing
shared creation/payment/assignment endpoints remain authoritative. Interrupted
creation blocks automatic resubmission and directs the customer to history. No
migration, service switch change, separate database or production test purchase
is required. Practice mode continues using isolated sample flows.

## Account, notifications and customer support tools

Live mode adds actual profile-photo upload/removal, password-protected changes to
a verified email/phone, per-token device/session history and remote session revocation.
History starts when a token is first observed after the upgrade; it does not invent
older sign-ins or failed-login records. Google-only accounts first set a password
through existing account recovery before replacing their sign-in contact.

Notifications require explicit browser permission and registration, configured
VAPID keys and the existing Peebee push sender. Account category preferences affect
server delivery. The service worker caches only the static app shell for installation
and offline fallback; it never caches API, account, booking, ticket, payment, or
attachment responses. It filters encrypted push payloads by account binding and
clears notifications on account changes. Revoked registered sessions stop receiving
push. Mobile browser/OS support and provider delivery remain operational dependencies.

## Install Taxibee

Taxibee is installable as a Progressive Web App at `https://taxibee.peebee.online`.
On Android or desktop Chrome/Edge, use the in-app **Install** prompt when offered,
or choose **Install Taxibee** from the browser menu. On iPhone/iPad, open the site in
Safari, tap **Share**, then **Add to Home Screen**. The app shell can open offline,
but route availability, prices, accounts, and bookings require an internet connection.

Booking chat supports real image and voice files, microphone recording with explicit
sending, and authenticated attachment viewing. In-app calls reuse the shared real
WebRTC engine with booking/assigned-driver authorization; mock/unimplemented providers
are refused. Calls have Answer/Decline/End controls and stop media on sign-out.
The existing phone-call option remains available where a driver has shared a number.

Lost-property reports are owned, environment-scoped records linked to actual orders.
They keep customer/staff updates, private image attachments and staff status changes
(open/investigating/found/returned/closed), with optimistic conflict handling and
idempotent report creation. Admin → Customer account and support tools supplies
the staff queue, policy switches/limits and verified support/safety contacts.
No demonstration contact number is substituted when those settings are empty.

Migration **0171_customer_account_tools.sql** was applied to the existing D1
database on 2026-11-24 through the reviewed migration workflow. Before migration,
existing authentication and push continue working; new storage features return
an upgrade-pending response. Deploy shared services before Taxibee through the
clean-main preflight after PR merge. Practice remains isolated.
Wallet PIN/Auto-Pay controls are still unavailable: shared payments require explicit
review, and this release introduces no automatic charging or device-only payment lock.
