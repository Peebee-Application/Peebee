# Cloudflare (primary staging host)

The active services run on Cloudflare Workers. Render config (`render.yaml`) is kept
for reference/rollback but is no longer the active deploy target.

| Service | Type | URL |
|---|---|---|
| `tuma-api` | Worker (Hono) | https://api.tumaffe.online |
| `tuma-customer` | Worker (Next.js via OpenNext) | https://tuma-customer.doxalight-inc.workers.dev |
| `tuma-rider` | Worker (Next.js via OpenNext) | https://tuma-rider.doxalight-inc.workers.dev |
| `tuma-admin` | Worker (Next.js via OpenNext) | not yet deployed — `apps/admin`, same deploy flow as customer/rider |
| `tuma-restaurant` | Worker (Next.js via OpenNext) | `restaurant.tumaffe.online` when deployed |
| `tuma-merchant` | Worker (Next.js via OpenNext) | `merchant.tumaffe.online` when deployed |
| `tuma-web` | Worker (Next.js via OpenNext) | `tumaffe.online` when deployed |

**Database: Cloudflare D1** (`tuma-api`, id `26926e12-d2f4-4b40-8b1b-019f6c169e10`), bound
natively to the `tuma-api` Worker as `env.DB` — no cross-provider HTTP hop. This is a
*separate* database from the old Turso `tuma-staging` one: that DB has its own unrelated
19-table schema from earlier scaffolding (a real `users` table with different columns —
discovered the hard way, via `no such column: id` in production), so rather than touch
tables we don't understand, this app gets a dedicated D1 database with its own schema.
Turso is kept as a **local-dev-only fallback** in `apps/api/src/db/client.ts` (used when no
D1 binding is present, e.g. under plain `pnpm dev`) — see `TURSO_DATABASE_URL` below.

## Requirements

- **Node ≥ 22** for `wrangler` v4 (the OpenNext Cloudflare adapter requires it). If your
  default Node is older, point `PATH` at a Node 22 install for deploy commands only —
  the build step (`opennextjs-cloudflare build`) works fine on older Node.
- `wrangler` authenticated (`wrangler login` or an API token in `CLOUDFLARE_API_TOKEN`).

## Automated CI/CD (GitHub Actions)

Deployments are automated through `.github/workflows/deploy.yml`:

- **Branch Push (Preview):** Any push to a non-`main` branch automatically deploys changed apps to **Cloudflare Preview** via `wrangler versions upload --preview-alias <branch-alias>`. Preview URLs follow the format: `https://<branch-alias>-tuma-<app>.doxalight-inc.workers.dev` and are posted to the GitHub Actions Job Summary.
- **Main Merge (Live):** Any push/merge to `main` automatically deploys changed apps to **Cloudflare Live** (production domains and live `workers.dev`) using `pnpm run deploy` (with `scripts/preflight-deploy.mjs` verification).
- **Required GitHub Secrets:**
  - `CLOUDFLARE_API_TOKEN` (API token with *Edit Cloudflare Workers* / *Account > Workers Scripts > Edit* permissions)
  - `CLOUDFLARE_ACCOUNT_ID` (Cloudflare account ID)

### Manual / Local Deploy Commands

Live deployments are accepted only from a clean local `main` at the exact same
commit as `origin/main`. See `COLLABORATION.md` for the Claude Code/Codex
branch and handoff workflow.

```bash
# Live Deployments (from main only)
pnpm --filter api deploy          # wrangler deploy
pnpm --filter customer deploy     # opennextjs-cloudflare build && wrangler deploy
pnpm --filter rider deploy
pnpm --filter admin deploy
pnpm --filter restaurant deploy
pnpm --filter merchant deploy
pnpm --filter web deploy

# Preview Uploads (from any branch)
pnpm --filter api deploy:preview
pnpm --filter customer deploy:preview
pnpm --filter rider deploy:preview
pnpm --filter admin deploy:preview
pnpm --filter restaurant deploy:preview
pnpm --filter merchant deploy:preview
pnpm --filter web deploy:preview
```

## Config

- `apps/api/wrangler.jsonc` — `d1_databases` binding (`DB` → `tuma-api`), `vars` for CORS
  origins and MoMo sandbox settings. Secrets (`JWT_SECRET`, MoMo credentials) are set via
  `wrangler secret put <NAME>` — never committed, never put in `vars`.
- Frontend `wrangler.jsonc` files under `apps/customer`, `apps/rider`, `apps/admin`,
  `apps/restaurant`, `apps/merchant`, and `apps/web` —
  static assets binding + `NEXT_PRIVATE_MINIMAL_MODE=1` (see gotcha below).
  `NEXT_PUBLIC_API_URL` is baked in at **build** time via `.env.production` in each app
  (safe to commit — it's a public value).

### Secrets already set

```bash
cd apps/api
wrangler secret put JWT_SECRET   # done

# Optional, only needed to test MoMo escrow funding/payout:
wrangler secret put MOMO_SUBSCRIPTION_KEY
wrangler secret put MOMO_API_USER
wrangler secret put MOMO_API_KEY
```

### Local dev (Turso fallback)

`apps/api/src/db/client.ts` uses D1 (`env.DB`) when running as a Worker, and falls back to
`TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` when no D1 binding exists (plain `pnpm dev`/`tsx`,
which can't see D1 bindings). For local dev, point that at a `turso dev` instance — **not**
the old `tuma-staging` Turso DB, which has an unrelated schema (see above). Run
`pnpm --filter api migrate` against it to apply this app's schema.

## Known gotchas (already worked around in this repo)

- **`sharp` breaks the Workers bundle.** Next.js's built-in image optimizer references
  `sharp` (native binary) even with `images.unoptimized: true`. Fixed via a pnpm override
  pointing `sharp` at a tiny no-op stub (`tools/stubs/sharp/`, wired in the root
  `package.json`'s `pnpm.overrides`) — safe because neither app calls `next/image`.
- **`Dynamic require of ".../middleware-manifest.json" is not supported`.** A known
  opennextjs-cloudflare bug under pnpm's symlinked `node_modules`
  ([opennextjs-cloudflare#1232](https://github.com/opennextjs/opennextjs-cloudflare/issues/1232)).
  Worked around with `NEXT_PRIVATE_MINIMAL_MODE=1` in each frontend's `wrangler.jsonc`
  vars — disables Next.js middleware support, which neither app uses.
  Revisit if you ever add `middleware.ts`.
- **`wrangler deploy` crashes with `Error: write EOF` on Windows** when it auto-detects an
  OpenNext project and re-delegates to `opennextjs-cloudflare deploy` internally. Worked
  around by building first (`opennextjs-cloudflare build`) then deploying with
  `OPEN_NEXT_DEPLOY=true wrangler deploy`, which skips the auto-delegation (already
  wired into each app's `deploy` npm script... except the script itself calls
  `opennextjs-cloudflare build && wrangler deploy`, which still hits this on native
  Windows — WSL or CI/Linux runners don't have this problem).
- **`workerd` postinstall fails / `wrangler dev` doesn't work** on this Windows Server
  environment specifically (missing shared libs for the local runtime binary).
  `wrangler deploy` (real deploys) is unaffected — only local preview is.
