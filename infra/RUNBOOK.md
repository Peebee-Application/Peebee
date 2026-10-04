# Peebee Concierge — Runbook

Command reference for local dev, build, and deploy. Generated from the current repo state (`README.md`, `FRONTEND.md`, `apps/api/README.md`, `infra/DEPLOY.md`, `infra/STAGING.md`) on 2026-09-12.

Prereqs: Node ≥ 22, pnpm (`corepack enable` will get you `pnpm@9.15.0` per `package.json`).

---

## 1. Install

From the monorepo root:

```bash
corepack enable
pnpm install
```

## 2. Environment files

Each frontend app needs a local env file:

```bash
cp apps/customer/.env.example apps/customer/.env.local
cp apps/rider/.env.example apps/rider/.env.local
```

Set in both:

```
NEXT_PUBLIC_API_URL=http://localhost:10000
```

(Points at the local API below. Swap for `https://peebee-api.doxalight-inc.workers.dev` to hit
staging instead.)

The API (`apps/api`) is a real backend now — auth, orders lifecycle, matching, MoMo escrow, chat,
rider verification. Staging runs on Cloudflare D1 (native Worker binding); local dev falls back
to Turso since D1 bindings only exist inside a Worker. Copy `apps/api/.env.example` to
`.env.local` and set `JWT_SECRET` and `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — point those at
a `turso dev` instance, not a shared staging DB (see `infra/STAGING.md` for why). Full env names
for every stage are in `infra/ENV.md` — never commit real values.

## 3. Local dev

```bash
cp apps/api/.env.example apps/api/.env.local   # set JWT_SECRET + TURSO_*
pnpm --filter api migrate    # creates tables
pnpm --filter api seed       # demo customer/rider/admin, password: password123
```

Run each in its own terminal:

```bash
pnpm --filter api dev        # Hono API      -> http://localhost:10000
pnpm --filter customer dev   # Next.js app    -> http://localhost:3000
pnpm --filter rider dev      # Next.js app    -> http://localhost:3001
```

Quick checks once the API is up:

```bash
curl http://localhost:10000/health
curl -X POST http://localhost:10000/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"phone":"+256700000001","password":"password123"}'
```

See `apps/api/README.md` for the full endpoint list and how to test the MoMo escrow flow against
the free sandbox (no real money — going live needs your own MTN merchant credentials).

Root-level shortcuts (same thing, from `package.json`):

```bash
pnpm dev:api
pnpm dev:customer
pnpm dev:rider
```

> `workers/api` is a legacy Cloudflare Worker scaffold — leave it alone; `apps/api` is the real backend now.

## 4. Build

```bash
pnpm --filter api build        # apps/api/dist/index.js
pnpm --filter customer build   # apps/customer/.next
pnpm --filter rider build      # apps/rider/.next
```

Root-level shortcuts:

```bash
pnpm build:api
pnpm build:customer
pnpm build:rider
```

## 5. Deploy (Cloudflare Workers + D1)

All three services deploy as Cloudflare Workers. Needs Node ≥ 22 for `wrangler` v4 (see
`infra/CLOUDFLARE.md` for the full picture, required secrets, and known gotchas).

```bash
pnpm --filter api deploy        # wrangler deploy
pnpm --filter customer deploy   # opennextjs-cloudflare build && wrangler deploy
pnpm --filter rider deploy
```

Currently live:
- `peebee-api` → https://peebee-api.doxalight-inc.workers.dev (`GET /health`)
- `peebee-customer` → https://peebee-customer.doxalight-inc.workers.dev
- `peebee-rider` → https://peebee-rider.doxalight-inc.workers.dev

Database: Cloudflare D1 (`peebee-api`), bound natively to the Worker as `env.DB` — schema
applied, verified working end to end (auth, orders). Not the old Turso `peebee-staging` DB,
which turned out to have an unrelated schema from earlier scaffolding — see
`infra/STAGING.md`. Turso only backs local dev now (see `apps/api/README.md`).

Blocked / not yet live: MoMo live mode, paid TURN, production environment (waiting on
product sign-off). `render.yaml` / the Render services are kept for reference/rollback only
— no longer the active deploy target.

## 6. Lint / typecheck

```bash
pnpm -r lint
```

---

## Quick preview (fastest path to seeing it in a browser)

```bash
corepack enable
pnpm install
pnpm --filter api dev &
pnpm --filter customer dev &
pnpm --filter rider dev &
```

Then open:
- Customer app: http://localhost:3000
- Rider app: http://localhost:3001
- API health: http://localhost:10000/health
