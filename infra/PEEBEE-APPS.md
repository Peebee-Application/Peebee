# Peebee app deployment

All applications belong to Cloudflare account
`5b3ae942adb5457f1fa4d7f5effbf3ff` (`peebeeapp.workers.dev`).

| Application | Worker | Root directory | Custom domain |
|---|---|---|---|
| Public website | `peebee` | `apps/web` | `peebee.online`, `www.peebee.online` |
| Customer | `peebee-customer` | `apps/customer` | `customer.peebee.online` |
| Rider | `peebee-rider` | `apps/rider` | `rider.peebee.online` |
| Admin | `peebee-admin` | `apps/admin` | `admin.peebee.online` |
| Restaurant | `peebee-restaurant` | `apps/restaurant` | `restaurant.peebee.online` |
| Merchant | `peebee-merchant` | `apps/merchant` | `merchant.peebee.online` |
| Car / partner | `peebee-partner` | `apps/partner` | `car.peebee.online`, `partner.peebee.online` |
| API | `peebee-api` | `apps/api` | `api.peebee.online` |

Each frontend builds against `https://api.peebee.online` from its tracked
`.env.production`. The API explicitly allows the configured frontend origins;
unconfigured hosts, former Peebee domains, and production localhost origins are
rejected. API verification links use the Peebee API and frontend addresses.

## Workers Builds

Connect each Worker to `Peebee-Application/Peebee`, select production branch
`main`, use the root directory above, and leave the build command empty. Set the
production deploy command to:

```bash
git fetch origin main:refs/remotes/origin/main && git switch -C main && pnpm run deploy
```

This supports Cloudflare's detached retry checkout while retaining the existing
clean-main preflight and exact comparison against `origin/main`. A stale build is
still rejected. The Worker name must exactly match its app's `wrangler.jsonc`.
Custom domains in the active `peebee.online` zone manage their DNS automatically.

## API resources before deployment

The Peebee account initially has no D1 database. Before the first API deployment,
choose a fresh Peebee database or a migration of existing app data, then replace
the historical D1 and R2 references in `apps/api/wrangler.jsonc` with resources in
the Peebee account. Do not deploy against another account's database identifier.

Apply the existing SQL migration files in order to the selected database by hand;
the app deploy does not run them. This includes
`apps/api/src/db/migrations/0076_email_api_keys.sql` already present on main.
Keep mock payments enabled until payment-provider setup is explicitly completed.
Do not seed the public service with the local demo accounts.

Set `JWT_SECRET` and `CREDENTIALS_ENCRYPTION_KEY` as Worker secrets. Keep these
values stable for an existing database and its sessions; use fresh random values
for a fresh database. Provider credentials, Google sign-in, and Web Push keys are
separate account setup and must not be copied from another application's account.

## Verification

After deployment, verify HTTPS loads each app, `/health` responds on the API,
each frontend's CSP allows `api.peebee.online`, and API CORS preflights allow
each app origin. Confirm a database-backed public endpoint works before treating
the API as ready. The full visual rebrand and replacement logos remain separate.
