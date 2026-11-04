# peebee-api

Hono API for Peebee Concierge. Real order lifecycle, auth, rider matching, MoMo
escrow, and chat. Runs as a Cloudflare Worker (`src/worker.ts`) backed by D1
(`env.DB`, native binding, no HTTP hop) — and unchanged as a Node process
(`src/index.ts`) for local dev, backed by Turso (libsql over HTTP) since a D1
binding only exists inside a Worker. See `src/db/client.ts`.

## Local

```bash
pnpm install
cp .env.example .env.local   # fill in JWT_SECRET and TURSO_DATABASE_URL/TURSO_AUTH_TOKEN
pnpm --filter api migrate    # creates tables
pnpm --filter api seed       # demo customer/rider/admin (password: password123)
pnpm --filter api dev        # http://localhost:10000
```

For `TURSO_DATABASE_URL`, run `turso dev` and point at that — **not** any pre-existing
Turso database, in case it carries an unrelated schema (this bit us once in staging: a
same-named `users` table from earlier scaffolding, no `id` column). Local dev has no
D1 access, so it always uses this Turso fallback regardless of what staging uses.

## Endpoints

See `GET /v1` for the full live list. Highlights:

- **Auth**: `POST /v1/auth/register`, `POST /v1/auth/login`, `GET /v1/auth/me`
- **Lists**: `POST /v1/lists`, `GET /v1/lists/recent`, `GET /v1/lists/:id`
- **Orders** (stage machine: Create → Match → Fund → Shop → Substitute → Approve → Deliver → Handover → Settle):
  `POST /v1/orders`, `GET /v1/orders/:id`, `POST /v1/orders/:id/match`,
  `POST /v1/orders/:id/fund`, `POST /v1/orders/:id/substitutions`,
  `POST /v1/orders/:id/substitutions/:subId/decision`,
  `POST /v1/orders/:id/deliver`, `POST /v1/orders/:id/handover`,
  `POST /v1/orders/:id/settle`
- **Chat**: `GET|POST /v1/orders/:id/chat`
- **Payments**: `GET /v1/payments/:id/refresh` (polls MoMo status),
  `POST /v1/payments/momo/callback` (webhook)
- **Riders**: `POST /v1/riders/apply`, `POST /v1/riders/status`,
  `GET /v1/riders/me`, `GET /v1/riders/me/orders`
- **Admin** (mock manual KYC — no real document verification integration):
  `GET /v1/admin/riders`, `POST /v1/admin/riders/:userId/verify`,
  `GET /v1/admin/stats`, `GET /v1/admin/integrations`,
  `GET /v1/admin/customers`, `GET /v1/admin/customers/:id`,
  `GET /v1/admin/orders`, `POST /v1/admin/users/:id/status`

## MoMo (escrow funding + rider payout)

Real MTN MoMo Open API integration (`src/momo/client.ts`), defaults to the
**sandbox** environment — no real money moves until you switch
`MOMO_TARGET_ENV=production` with real MTN merchant credentials, which you
must obtain yourself (MTN business approval required; this repo can't do
that for you).

To test against the free sandbox:

1. Create a developer account at https://momodeveloper.mtn.com/, subscribe
   to Collections + Disbursements, copy the subscription key(s).
2. Set `MOMO_SUBSCRIPTION_KEY` in `.env.local`.
3. Run `pnpm --filter api exec tsx src/momo/provision-sandbox.ts` — prints
   `MOMO_API_USER` / `MOMO_API_KEY` to add to `.env.local`.
4. Fund an order (`POST /v1/orders/:id/fund`) with a sandbox test MSISDN,
   then poll `GET /v1/payments/:id/refresh` until `status: "successful"`.

## Cloudflare Workers (`peebee-api`) — primary deploy target

```bash
pnpm --filter api deploy   # wrangler deploy
```

DB is the `DB` D1 binding declared in `wrangler.jsonc` (database `peebee-api`) — no DB secrets
needed in production. Secrets via `wrangler secret put <NAME>`: `JWT_SECRET` (set), MoMo
credentials (optional). See `infra/CLOUDFLARE.md` for the full picture (including known
bundling gotchas) and `infra/ENV.md` for the env name matrix.

Do not commit secrets. `render.yaml` / the old Render service are kept for reference only.

## Separate practice database (optional, recommended)

The shared practice world (Admin → Practice) keeps its demo people, orders and money in D1. By default that is the main
database, told apart by `prac_` ids. To keep it completely apart from live data, give the Worker a second D1 database
bound as `DB_PRACTICE`:

1. `npx wrangler d1 create peebee-practice` (from `apps/api`) — note the `database_id` it prints.
2. Add it to `wrangler.jsonc` next to `DB`: `{ "binding": "DB_PRACTICE", "database_name": "peebee-practice", "database_id": "<id>", "migrations_dir": "src/db/migrations" }`.
3. `npx wrangler d1 migrations apply peebee-practice --remote` — the practice database needs the same schema as the main one,
   so run this again after every new migration you apply to the main database.
4. Deploy, then Admin → Practice → "Lay down the practice world".

While `DB_PRACTICE` is bound, every request made with a practice session (and the background job's practice work) reads
and writes it instead of `DB`. Settings and admin switches are always read from the main database, so practice follows the
real fares, modules and notices. Without the binding nothing changes. Cloudflare's daily D1 read limit is per account, so
a second database isolates data but does not add read allowance.
