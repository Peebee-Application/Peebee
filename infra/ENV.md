# Env matrix (names only)

Per environment: `local` | `preview` | `staging` | `prod`

## Database
- `DATABASE_URL`

## MoMo (MTN direct)
MTN is normally configured in Admin → Settings → Payments (stored encrypted); these are the fallback when nothing is saved
there. See `docs/MTN_GO_LIVE.md` for the move from sandbox to production.
- `MOMO_BASE_URL` (defaults to MTN's sandbox host; set it, as a Worker secret, to the production host to go live)
- `MOMO_COLLECTION_SUBSCRIPTION_KEY`
- `MOMO_DISBURSEMENT_SUBSCRIPTION_KEY`
- `MOMO_API_USER`, `MOMO_API_KEY` (Collections; also used for Disbursements unless the next two are set)
- `MOMO_DISBURSEMENT_API_USER`, `MOMO_DISBURSEMENT_API_KEY` (optional)
- `MOMO_TARGET_ENV` (`sandbox` | `production`; MTN's production text is country-specific)
- `MOMO_SUBSCRIPTION_KEY` is read only by the one-off sandbox helper `apps/api/src/momo/provision-sandbox.ts`
- The MTN adapter sends no callback URL (results are polled), so no `MOMO_CALLBACK_URL` is needed

## Maps
- `MAPS_API_KEY` (server)
- Public map key only if required; restrict by HTTP referrer

## Storage (R2)
- `RIDER_DOCS` Worker R2 binding (private rider, order, chat, restaurant, and merchant KYC files)
- Optional S3-compatible keys only if a non-Worker process must access the bucket

## WebRTC TURN
- `TURN_URLS`
- `TURN_USERNAME`
- `TURN_CREDENTIAL`

## Push
- `PUSH_VAPID_PUBLIC_KEY`
- `PUSH_VAPID_PRIVATE_KEY`
- `PUSH_SUBJECT`

## App
- `JWT_SECRET` / `SESSION_SECRET`
- `CREDENTIALS_ENCRYPTION_KEY` (required to encrypt provider credentials and merchant settlement destinations)
- `CORS_ORIGINS`

Do not paste secret values into chat, issues, or commits.
