# Peebee Concierge — Frontend

pnpm monorepo: `apps/customer`, `apps/rider`, `packages/shared` (`@peebee/shared`).
Full order lifecycle wired to the real API (auth, orders, matching, MoMo escrow, chat, rider
verification). Still missing: maps/live location and VoIP/call support.

**Hosting:** Render free **Node 22** Web Services
`peebee-customer-staging` / `peebee-rider-staging` — **not** Cloudflare Pages / OpenNext.
`next.config`: `output: "standalone"`. FE talks to API via `NEXT_PUBLIC_API_URL` (Turso/API is backend-side).
Deploy config lives in the root `render.yaml` (all three services, `autoDeploy: true` on `main`).

## Local

```bash
pnpm install

pnpm --filter customer dev   # http://localhost:3000
pnpm --filter rider dev      # http://localhost:3001
```

Package names are `customer` and `rider` so `pnpm --filter customer` / `pnpm --filter rider` match Ship’s commands.

Env (each app): copy `.env.example` → `.env.local`

```
NEXT_PUBLIC_API_URL=
```

## Build

From monorepo root:

```bash
pnpm --filter customer build
pnpm --filter rider build
```

## Start (Render / production)

**Primary** (standalone; cwd = app Root Directory on Render):

```bash
node .next/standalone/apps/customer/server.js
node .next/standalone/apps/rider/server.js
```

Render sets `PORT`; Next standalone respects `process.env.PORT`.

After monorepo `next build`, copy static assets into the standalone tree if needed:

```bash
# customer example (from apps/customer)
cp -r public .next/standalone/apps/customer/
cp -r .next/static .next/standalone/apps/customer/.next/
```

**Secondary:**

```bash
pnpm --filter customer start
pnpm --filter rider start
```

## Render Web Service (notes for Ship)

| | Customer | Rider |
|--|----------|-------|
| Service name | `peebee-customer-staging` | `peebee-rider-staging` |
| Plan | Free | Free |
| Runtime | Node 22 | Node 22 |
| Root directory | `apps/customer` (or repo root — see build) | `apps/rider` |
| Build | `cd ../.. && pnpm install && pnpm --filter customer build` | same with `rider` |
| Start | `node .next/standalone/apps/customer/server.js` | `node .next/standalone/apps/rider/server.js` |
| Health check | `/` | `/` |
| Env | `NEXT_PUBLIC_API_URL=` | `NEXT_PUBLIC_API_URL=` |

If Root Directory is `apps/customer`, start path is relative to that app:  
`node .next/standalone/apps/customer/server.js` (Ship may adjust to the resolved standalone layout).

**Ship owns final deploy config** — these are scaffold notes only; no `render.yaml` in this tree.

## Workspace layout

```
apps/customer   # Home · Orders · Chat · Account + /orders/[id]/<stage>
apps/rider      # Jobs · Active · Wallet · Account + /jobs/[id]/<stage>
packages/shared # OrderStage, PaymentRail, createApiClient (@peebee/shared) — now backed by a real API
```

`workers/` legacy CF scaffold — left alone. `apps/api` now has a real backend (auth, orders,
matching, MoMo escrow, chat) — see `apps/api/README.md`. Both apps are wired to it: phone/password
auth, the full order lifecycle (customer: build list → fund → approve substitutions → confirm
handover → settle; rider: propose substitutions → start delivery → settle), live chat, and rider
verification status. State syncs via polling (no websockets) — see `lib/api.ts` / `lib/auth-context.tsx`
in each app.

## Brand

See **`BRAND.md`** for palette, surface tokens, and asset source paths.

- CSS vars + `.card` in each app `app/globals.css` (from `peebee-brand/SURFACE-TOKENS.md`)
- Tailwind colors: `cream`, `gold`, `ink`/`black`, `green`
- Lockup + sibling app icons (SVG only) under `apps/*/public/brand/`
- Lucide map: `packages/shared/docs/LUCIDE-MAP.md`
- PNG cascade remains in `peebee-brand/exports/` (copy later; not committed here)
