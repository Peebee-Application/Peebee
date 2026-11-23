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
`https://api.peebee.online/v1/*`; there is no second database and no database
migration. Bearer credentials are forwarded only to that fixed API origin.
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

Some source mockup behaviours have no equivalent in the current TaxiPress
API: numbered-seat allocation, bundled return packages, corporate/voucher
mock payments, synthetic traffic tracking, and its separate parcel/charter
simulators. They remain in the labelled design preview. The live interface
does not fabricate them; services outside this integration direct customers
to Peebee. This release does not claim full backend parity with every mockup
screen. Changes to those services belong in Peebee's shared API and admin
settings, rather than a separate Taxibee database.

## Deploy

Merge via PR. On clean `main` matching `origin/main`, run `pnpm deploy:taxibee`.
The existing deployment preflight is required. The Worker is
`peebee-taxibee`; Wrangler attaches `taxibee.peebee.online` as a custom domain.
Only the existing Peebee Cloudflare account and zone are used. Existing apps,
Workers, DNS records, and the shared API are not redeployed by this command.
