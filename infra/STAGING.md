# Staging (free-first)

**Stack:** Cloudflare Workers (host, all three services) + Cloudflare D1 (DB). Previously
Render + Turso — kept as reference/rollback (`render.yaml`), no longer the active deploy
target. The earlier "R2 billing wall" pause turned out to be specific to R2; Workers + D1 +
assets deploy fine on the free tier and are what we actually use now — no R2 involved.

See **[CLOUDFLARE.md](./CLOUDFLARE.md)** for full deploy instructions, required secrets, and
known gotchas (sharp bundling, `NEXT_PRIVATE_MINIMAL_MODE`, Node 22 requirement).

## Live

- [x] Private repo `Peebee-Application/Peebee`
- [x] D1 database `peebee-api` (free) — this app's schema, bound natively to the Worker
- [x] `peebee-api` — real backend (auth, orders, matching, MoMo escrow, chat, rider
      verification) — https://peebee-api.doxalight-inc.workers.dev (`GET /health`) — verified
      working end to end (register/login/orders) against D1
- [x] `peebee-customer` — https://peebee-customer.doxalight-inc.workers.dev
- [x] `peebee-rider` — https://peebee-rider.doxalight-inc.workers.dev
- [ ] GH Actions deploy workflow (currently manual `wrangler deploy`)

Note: the old Turso `peebee-staging` database (from earlier scaffolding, "19 tables") has an
unrelated schema — its `users` table doesn't even have an `id` column matching what this
app expects. Left untouched; this app now uses its own dedicated D1 database instead. Turso
still backs local dev only (`apps/api/src/db/client.ts` falls back to
`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` when no D1 binding is present — point that at a
`turso dev` instance, not the old staging DB).

## API

- Path: `apps/api` (not `workers/api`, which is an unrelated legacy scaffold)
- Deploy: `pnpm --filter api deploy` (`wrangler deploy`)
- Health: `GET /health`
- Secrets (via `wrangler secret put`): `JWT_SECRET` (set), MoMo sandbox creds (optional)
- DB: D1 binding `env.DB` → `peebee-api` (see `apps/api/wrangler.jsonc`)

## Blocked / wait

- Neon paid, paid TURN, production
- MoMo *live* mode — sandbox integration is done; going live needs MTN merchant approval +
  real credentials as Worker secrets

## Env (names only)

- `NEXT_PUBLIC_API_URL` — baked in at build time via each app's `.env.production`
- `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` — local dev fallback only, not used in staging
- MoMo / maps / TURN / push — see `infra/ENV.md`
