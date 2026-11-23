# Taxibee continuation handover

Updated 23 November 2026. **Continue this implementation. Do not start over.**

## Read first

- Repository: `Peebee-Application/Peebee`, local checkout `/workspace/Peebee`.
- Implementation branch: `codex/taxibee-customer`.
- Implementation commit: `7fd72cd1391ac3ae7f30aaabd3137645c30987a0`, pushed to GitHub.
- App: `apps/taxibee`. Read its `README.md` and this repository's `AGENTS.md`
  and `COLLABORATION.md` before doing anything.
- Reference: existing checkout `/workspace/flyexpress`, repository
  `xristo7/flyexpress`, commit `84e0470fb20f506d253068208fa25844b0a4f796`.
- `xristo7/flyexpressprojections` is a different selected repository, not the
  customer UI reference. Do not modify it for this task.

Fetch and inspect Git status, branch, upstream, commits and PR state. The
handover itself is a later commit on the same branch. If this PR has since
merged, continue from current `origin/main` and preserve the merged work.
Do not reset, clean, overwrite, recreate the app or recreate its assets.
Read the existing diff before making changes. Use the existing isolated
checkout unless concurrent work requires otherwise under repository rules.

## User's approved scope

Create an independent customer app called **Taxibee** at
**https://taxibee.peebee.online**. First reproduce the complete Fly Express
mockup, changing its branding to Taxibee/Peebee: official Peebee symbol,
black, gold, charcoal and cream. Preserve layouts and flows; later design
modifications wait until the user reviews this replica.

Taxibee is another frontend for Peebee's existing TaxiPress taxi service.
It must share the same users, API, wallet, bookings and database. Do not
provision a separate backend or database. The user approved retaining the
original JavaScript UI while using TypeScript for the API integration.
The user authorized proceeding autonomously; do not repeat design approval
questions or ask for credentials already available. Never bypass required
platform/repository protections or expose credentials.

## Already implemented — reuse it

- Original HTML/CSS/JavaScript screens copied and rebranded in `public/`.
  Source demo passwords/local account provisioning were removed.
- Official Peebee SVG logo and finished rebranded fleet, driver and
  onboarding artwork are committed under `public/assets/`. **Do not spend
  credits regenerating these assets.** Seat layout geometry remains the
  original source, with positioned identity overlays to preserve hotspots.
- `src/live.ts`: typed adapter using the existing shared Peebee API client.
  Supports customer authentication, TaxiPress queues/bookings, wallet and
  mobile-money/cash payment requests, server-issued ticket codes, cancellation,
  wallet top-ups and display-name updates. Browser sessions are per-origin;
  user identities and backend records are shared, not duplicated.
- `src/worker.mjs`: fixed-origin `/api/v1/*` gateway to
  `https://api.peebee.online/v1/*`. Forwards customer bearer authentication,
  drops cookies, prevents customer-response caching, adds security headers,
  and returns a safe 502 on upstream connection failures.
- Full reference mockup available at `/?preview=1` → **Enter design preview**.
  A persistent banner identifies sample data. Preview never authenticates or
  writes through the API.
- All icon/map/barcode/QR code libraries are bundled locally.
- Root scripts: `dev:taxibee`, `build:taxibee`, `test:taxibee`, `deploy:taxibee`.
- Wrangler configuration creates only Worker `peebee-taxibee` and custom
  domain `taxibee.peebee.online`, in Peebee account
  `5b3ae942adb5457f1fa4d7f5effbf3ff`. No DB migrations or modifications to
  existing Peebee frontends/API were made.

## Important limits — do not overstate completion

As of this handover, implementation is committed and pushed. **It has not
been merged or deployed.** Recheck the PR/deployment state before acting;
another agent may have advanced it after this document was written.

The full UI replica is in design-preview mode. Live backend parity does not
cover every simulated mockup service. The existing TaxiPress API does not
provide the mockup's numbered-seat allocation, bundled return packages,
corporate/voucher demo payments or synthetic traffic tracking. Separate
parcel/charter simulators are also not connected here. Live mode blocks
fake success and sends unsupported services to Peebee. Read the app README
for the exact scope; never describe every mockup feature as production-ready.

Authenticated real-production customer flows and real payment settlement
have **not** been exercised. Browser integration tests use API fixtures,
not real customer records. Do not spend live money just to test.

## Verified checks — do not repeat without a reason

- Production build and TypeScript check passed.
- Four gateway tests passed: auth/cookie/cache handling, write forwarding,
  status preservation, fixed routing and safe upstream errors.
- Chromium mobile/desktop smoke tests passed: replica screens, 14 passenger
  seats and disabled driver control, preview makes no API writes, rejected
  login, shared customer/booking payloads, wallet payment, server QR/code,
  persistence after reload, loaded assets and no horizontal overflow.
- Reference comparison at 390px and 1440px showed identical measured bounds
  for search, services, departure cards and wallet cards. This is not a
  claim that every pixel of every screen was independently certified.
- All literal local media references resolve. Classic-script syntax passed
  via `node --input-type=commonjs --check < public/script.js`. Do not check
  the legacy file as an ES module: the original contains duplicate function
  declarations valid in its classic-script context.
- Git diff whitespace check passed. Lockfile changes are scoped to the new app.
- Direct production API request without a customer token returned expected
  401. Local Workerd cannot resolve external hosts in this proxy-only cloud
  runtime; that produced a diagnosed local gateway 502, not a production
  authentication failure. Cloudflare production networking is still to verify.

## Access already configured

- GitHub reads, API access, and push access verified for this repository.
- `CLOUDFLARE_API_TOKEN` securely bound in the published environment, restricted
  to `api.cloudflare.com`. Token validity and account/zone reads verified.
- `peebee.online` zone is active. At the last read there was no
  `peebee-taxibee` Worker and no `taxibee.peebee.online` DNS record.
- Write permissions for actual Worker/custom-domain deployment remain to be
  verified by performing that deployment. Do not print secret values or
  copy them into files. Reuse injected credentials; inspect names/status only.
- Network destinations configured: `api.github.com`, `api.cloudflare.com`,
  `*.peebee.online`, `*.workers.dev`, plus package-manager presets.

## Next actions, in order

1. Check current Git/PR status and read this app's existing files. Do not
   reimplement or regenerate anything already present.
2. Open or reuse a PR from `codex/taxibee-customer` to `main`. The suggested
   description is also in `/tmp/taxibee-pr.md` if the same machine remains.
   Include the distinction between full design preview and live API scope.
3. Review the change and merge through the PR, respecting branch protections.
   Do not bypass `scripts/preflight-deploy.mjs`.
4. Switch to a clean local `main` matching current `origin/main`. Run
   `pnpm deploy:taxibee` with available Cloudflare authentication. This deploy
   must only affect the new Worker/domain; preserve other Peebee services/DNS.
5. Verify HTTPS, DNS/custom-domain attachment, root/preview HTML, scripts and
   assets, the gateway's expected unauthenticated 401, and browser rendering
   with no JavaScript exceptions. Do not equate an upload with a working site.
6. Give the user the live URL and preview URL for replica review, PR/commit,
   test evidence and the precise remaining backend limitations. Do not begin
   a redesign before their review.

## Commands and retained local resources

Use Node >=22 and the pinned pnpm 9.15.0. This machine has Node 24 and pnpm at
`/workspace/.onboarding-tools/node_modules/.bin/pnpm`; add that directory to
PATH. Dependencies are installed. Only reinstall if missing or changed.

```sh
cd /workspace/Peebee
pnpm --filter taxibee build
pnpm --filter taxibee typecheck
pnpm --filter taxibee test
pnpm --filter taxibee test:browser
```

Browser tests expect a dev server at port 3015 and `/usr/bin/chromium`.
Override `TAXIBEE_TEST_URL` and `CHROMIUM_PATH` if needed. Startup:

```sh
XDG_CONFIG_HOME=/workspace/.onboarding/config WRANGLER_SEND_METRICS=false \
  pnpm --filter taxibee exec wrangler dev --port 3015
```

Restart this dev server after a build adds/removes assets: its asset manifest
can otherwise retain an older file list. Processes do not survive snapshots.
The proxy environment requires writable npm cache/config paths under
`/workspace` or `/tmp`; do not disable TLS or checksum verification.

On the same machine, screenshots are in `/tmp/taxibee-evidence/`, the reference
layout comparison script in `/tmp/taxibee-compare.cjs`, and logs in
`/tmp/taxibee-dev.log`. The source reference server was started on port 3005.
Treat these as optional retained evidence, not files guaranteed in a new task.
