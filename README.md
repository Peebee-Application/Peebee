# Peebee Concierge

Uganda boda shopping concierge — customers post shopping lists; verified riders buy and deliver.

## Stack (staging, free-tier)

- **Monorepo** `Peebee-Application/Peebee`
- **Apps:** `apps/customer`, `apps/rider`, `apps/admin`, `apps/restaurant`, `apps/merchant`, and `apps/web` (Next.js App Router → **Cloudflare Workers** via OpenNext)
- **API:** `apps/api` (Hono → **Cloudflare Worker**); `workers/api` is an unrelated legacy scaffold — leave alone
- **DB:** Cloudflare D1 (`peebee-api`), bound natively to the API Worker. Turso backs local dev only.
- **Shared:** `packages/shared` (`@peebee/shared`)

See **[infra/CLOUDFLARE.md](./infra/CLOUDFLARE.md)** for deploy commands, required secrets, and
known gotchas. Render (`render.yaml`) is kept for reference/rollback but is no longer the active
deploy target — see **[FRONTEND.md](./FRONTEND.md)**.

## Layout

```
apps/customer/   # customer web PWA
apps/rider/      # rider web PWA
apps/admin/      # admin dashboard (riders, customers, orders, integrations)
apps/restaurant/ # restaurant order, payment, and wallet app
apps/merchant/   # formal merchant onboarding, payments, wallet, outlets, and staff
apps/web/        # public website, terms, and privacy pages
apps/api/        # real backend (Hono, on Cloudflare Workers)
workers/api/     # legacy CF worker scaffold — leave alone
packages/shared/ # OrderStage, PaymentRail, API client for the real backend
tools/stubs/     # sharp no-op stub (see infra/CLOUDFLARE.md gotchas)
infra/           # env matrix, deploy notes
```

## Environments

| Env | Services | DB |
|-----|----------|-----|
| staging | `peebee-api` plus customer, rider, admin, restaurant, merchant, and web Workers | D1 `peebee-api` |
| production | *blocked until Sharon OK* | *blocked* |

## Secrets

Never commit `.env` or secrets. Cloudflare secrets are set via `wrangler secret put` (see
`infra/CLOUDFLARE.md`). See `infra/ENV.md` for the full env name matrix.
