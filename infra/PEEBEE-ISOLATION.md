# Independent Peebee deployment

Peebee is operated only in Cloudflare account
`5b3ae942adb5457f1fa4d7f5effbf3ff` (peebeeapp@gmail.com).
Every Worker configuration pins this account. Local deployment preflight and
the GitHub deployment workflow reject a different account environment variable.

The application uses the fresh `peebee-api` D1 database
`4c80fcd2-0c4e-4594-a598-2b93ae36040d` and the Peebee R2 bucket `peebee`.
Existing application data is not imported. Apply all SQL migrations in
`apps/api/src/db/migrations` to this fresh database in filename order. The
configured migration directory allows Wrangler to record which files ran.

The public website Worker is `peebee`. Other Workers are `peebee-api`,
`peebee-admin`, `peebee-customer`, `peebee-rider`, `peebee-restaurant`,
`peebee-merchant`, `peebee-partner`, and `peebee-preview-hub`.
Their custom domains belong to the active `peebee.online` zone in this account.
The partner application serves both `car.peebee.online` and
`partner.peebee.online`.

Generate independent JWT, credential encryption, and Web Push private keys.
Set private values as Worker secrets; only the Web Push public key is committed.
Google sign-in requires a Peebee OAuth client and remains unconfigured until one
is supplied. Payment and map credentials start empty; payments use the mock
provider until configured by an admin. Never run the development demo seed on
the public database.

Create the first super admin for peebeeapp@gmail.com with a randomly generated
temporary password and require a password change on first use. Keep its initial
access information outside version control.

The supplied provider keys are held in an encrypted local import bundle.
Gemini testing rotation can use the three keys that passed provider validation;
the other seven unique keys remain disabled. Resend recognizes nine send-only
keys. Email delivery requires verified Peebee sender addresses, and keys sharing
a provider team/project must share a quota group. Rotation uses five-minute
intervals and does not increase provider quotas.

All code deployment must follow the clean-main preflight. Deployment does not
apply database migrations automatically. The Peebee repository is
`Peebee-Application/Peebee`.
