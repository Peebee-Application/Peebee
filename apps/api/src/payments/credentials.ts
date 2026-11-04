/**
 * Admin-editable API credentials for the payment aggregators, stored
 * encrypted in the payment_credentials table (see
 * ../db/migrations/0028_payment_credentials.sql and ../lib/crypto.ts).
 *
 * Every field also has an env-var fallback (YO_API_USERNAME, etc.) so
 * nothing here breaks an existing deployment that only ever set env vars —
 * a DB-stored value just takes priority once an admin saves one. This is
 * read on every request (no in-memory cache) because the app runs on
 * Cloudflare Workers: a module-level cache would go stale across isolates
 * with no way to invalidate it, whereas D1 is already a fast per-request
 * read the rest of this codebase relies on (see ../lib/settings.ts).
 */

import { db } from "../db/client.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import type { PaymentProviderIdentity } from "../lib/settings.js";

export type CredentialFieldDef = {
  key: string;
  label: string;
  /** Masked in the UI and never echoed back once set. */
  secret: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  /** Env var this field falls back to when nothing's stored in the DB. */
  envVar: string;
  /** Exact length the provider requires, checked when an admin saves it. */
  exactLength?: number;
};

/** What each aggregator's real API actually needs — see wire.ts in each
 * provider's own folder for how these get used. */
export const PROVIDER_CREDENTIAL_FIELDS: Record<PaymentProviderIdentity, CredentialFieldDef[]> = {
  yo: [
    {
      key: "apiUsername",
      label: "API username",
      secret: false,
      required: true,
      envVar: "YO_API_USERNAME",
      helpText: "From your Yo! Payments merchant dashboard.",
    },
    {
      key: "apiPassword",
      label: "API password",
      secret: true,
      required: true,
      envVar: "YO_API_PASSWORD",
    },
    {
      key: "targetEnv",
      label: "Environment",
      secret: false,
      required: false,
      placeholder: "sandbox",
      envVar: "YO_TARGET_ENV",
      helpText: '"sandbox" or "production" — defaults to sandbox if left blank.',
    },
    {
      key: "callbackSecret",
      label: "Callback secret",
      secret: true,
      required: false,
      envVar: "YO_CALLBACK_SECRET",
      helpText: "Shared secret Yo! includes on payment callbacks, used to verify they're genuine.",
    },
  ],
  flutterwave: [
    {
      key: "secretKey",
      label: "Secret key",
      secret: true,
      required: true,
      envVar: "FLUTTERWAVE_SECRET_KEY",
      helpText: "From Settings → API in your Flutterwave dashboard.",
    },
    {
      key: "webhookSecret",
      label: "Webhook secret hash",
      secret: true,
      required: false,
      envVar: "FLUTTERWAVE_WEBHOOK_SECRET",
      helpText: "The secret hash you set under Settings → Webhooks — used to verify incoming webhooks.",
    },
    {
      key: "encryptionKey",
      label: "Encryption key",
      secret: true,
      required: false,
      envVar: "FLUTTERWAVE_ENCRYPTION_KEY",
      exactLength: 24,
      helpText: "From Settings → API. Only needed for direct card payments (Peebee's own card form) — the payload is encrypted with it before it reaches Flutterwave.",
    },
  ],
  // Direct MTN MoMo Open API — no aggregator in between. Two subscription
  // keys because MTN issues collection and disbursement access separately;
  // a merchant approved for one isn't automatically approved for the
  // other. See ./mtn/wire.ts.
  mtn: [
    {
      key: "apiUser",
      label: "API user (UUID)",
      secret: false,
      required: true,
      envVar: "MOMO_API_USER",
      helpText: "The API user UUID created against your MoMo Developer subscription.",
    },
    {
      key: "apiKey",
      label: "API key",
      secret: true,
      required: true,
      envVar: "MOMO_API_KEY",
    },
    {
      key: "disbursementApiUser",
      label: "Disbursements API user (UUID)",
      secret: false,
      required: false,
      envVar: "MOMO_DISBURSEMENT_API_USER",
      helpText: "Only if MTN issued your Disbursements API user separately. Leave blank to reuse the API user above.",
    },
    {
      key: "disbursementApiKey",
      label: "Disbursements API key",
      secret: true,
      required: false,
      envVar: "MOMO_DISBURSEMENT_API_KEY",
      helpText: "The key for the Disbursements API user above. Leave blank to reuse the API key above.",
    },
    {
      key: "collectionSubscriptionKey",
      label: "Collections subscription key",
      secret: true,
      required: true,
      envVar: "MOMO_COLLECTION_SUBSCRIPTION_KEY",
      helpText: "From the Collections product on your MTN MoMo Developer account.",
    },
    {
      key: "disbursementSubscriptionKey",
      label: "Disbursements subscription key",
      secret: true,
      // Required alongside the collections key (not optional) — this
      // adapter reports supportsDisbursement: true, so resolveProvider()
      // may route a rider payout here once it's "configured" at all. A
      // merchant only approved for Collections so far shouldn't show as
      // configured until Disbursements is approved and keyed in too.
      required: true,
      envVar: "MOMO_DISBURSEMENT_SUBSCRIPTION_KEY",
      helpText: "From the Disbursements product on your MTN MoMo Developer account.",
    },
    {
      key: "targetEnv",
      label: "Environment",
      secret: false,
      required: false,
      placeholder: "sandbox",
      envVar: "MOMO_TARGET_ENV",
      helpText: '"sandbox" or "production" — defaults to sandbox if left blank.',
    },
  ],
  // Direct Airtel Money OpenAPI. Collections only for now — Airtel's
  // disbursement endpoint requires RSA-encrypting a disbursement PIN with
  // their published public key, which isn't implemented yet; see
  // ./airtel/wire.ts.
  airtel: [
    {
      key: "clientId",
      label: "Client ID",
      secret: false,
      required: true,
      envVar: "AIRTEL_CLIENT_ID",
      helpText: "From your Airtel Money OpenAPI application.",
    },
    {
      key: "clientSecret",
      label: "Client secret",
      secret: true,
      required: true,
      envVar: "AIRTEL_CLIENT_SECRET",
    },
    {
      key: "country",
      label: "Country code",
      secret: false,
      required: false,
      placeholder: "UG",
      envVar: "AIRTEL_COUNTRY",
      helpText: "Two-letter country code Airtel issued this application for — defaults to UG.",
    },
    {
      key: "targetEnv",
      label: "Environment",
      secret: false,
      required: false,
      placeholder: "sandbox",
      envVar: "AIRTEL_TARGET_ENV",
      helpText: '"sandbox" or "production" — defaults to sandbox if left blank.',
    },
  ],
};

type Row = { provider: string; field: string; value: string };

/** One encrypted value, read straight from the DB every call — see the
 * module doc for why this isn't cached. */
async function readStored(provider: PaymentProviderIdentity, field: string): Promise<string | undefined> {
  let res;
  try {
    res = await db.execute({
      sql: "SELECT value FROM payment_credentials WHERE provider = ? AND field = ?",
      args: [provider, field],
    });
  } catch (err) {
    // Falls back to the env var instead of throwing if the table hasn't
    // been migrated onto this environment's DB yet — every payment
    // initiation calls through here (via isConfigured()), so a schema
    // mismatch here shouldn't take down live payment processing.
    console.error("payment_credentials read failed, falling back to env var:", err);
    return undefined;
  }
  const row = res.rows[0] as unknown as Row | undefined;
  if (!row) return undefined;
  try {
    return await decryptSecret(row.value);
  } catch {
    return undefined;
  }
}

/** Resolves one credential field: DB value if an admin has saved one,
 * otherwise the env var this field falls back to. */
export async function getCredential(provider: PaymentProviderIdentity, field: string): Promise<string | undefined> {
  const stored = await readStored(provider, field);
  if (stored) return stored;
  const def = PROVIDER_CREDENTIAL_FIELDS[provider].find((f) => f.key === field);
  const envVar = def?.envVar;
  return envVar ? process.env[envVar] || undefined : undefined;
}

/** Whether every *required* field for this provider resolves to something
 * (DB or env fallback) — the same "is this aggregator actually usable"
 * check ../service.ts's isConfigured() needs. */
export async function isProviderConfigured(provider: PaymentProviderIdentity): Promise<boolean> {
  const required = PROVIDER_CREDENTIAL_FIELDS[provider].filter((f) => f.required);
  const values = await Promise.all(required.map((f) => getCredential(provider, f.key)));
  return values.every((v) => !!v);
}

/** Whether the saved keys are the provider's test/sandbox ones, which move no real money and never send a real phone
 * prompt. Flutterwave test secret keys start with FLWSECK_TEST; the telcos and Yo! are on test when the Environment field
 * is blank or "sandbox" (their default). Any other value is a production target (MTN's is country-specific, for example
 * "mtnuganda"), the same rule the MTN adapter uses to pick EUR or UGX. Only meaningful once the provider is configured. */
export async function providerUsesTestCredentials(provider: PaymentProviderIdentity): Promise<boolean> {
  if (provider === "flutterwave") {
    const key = (await getCredential("flutterwave", "secretKey")) ?? "";
    return key.toUpperCase().startsWith("FLWSECK_TEST");
  }
  const env = ((await getCredential(provider, "targetEnv")) ?? "sandbox").trim().toLowerCase();
  return env === "" || env === "sandbox";
}

/** Field-by-field "is something set" status for the admin UI — never the
 * actual values, DB-stored or env-fallback alike. */
export async function credentialFieldStatus(provider: PaymentProviderIdentity) {
  const fields = PROVIDER_CREDENTIAL_FIELDS[provider];
  return Promise.all(
    fields.map(async (f) => ({
      key: f.key,
      label: f.label,
      secret: f.secret,
      required: f.required,
      placeholder: f.placeholder,
      helpText: f.helpText,
      set: !!(await getCredential(provider, f.key)),
    })),
  );
}

/** The first submitted value that breaks its field's required length, as an
 * admin-facing message — checked before anything is saved so a bad entry
 * never lands (and never counts as "set"). Blank values are skipped, as
 * saveCredentials skips them. */
export function credentialLengthError(provider: PaymentProviderIdentity, fields: Record<string, string>): string | null {
  for (const def of PROVIDER_CREDENTIAL_FIELDS[provider]) {
    const value = fields[def.key]?.trim();
    if (value && def.exactLength && value.length !== def.exactLength) {
      return `${def.label} must be exactly ${def.exactLength} characters (you entered ${value.length}). Copy it again from the provider dashboard.`;
    }
  }
  return null;
}

/**
 * Saves whichever fields were submitted (blank/omitted fields are left
 * untouched — an admin re-saving one field shouldn't wipe the others).
 * Returns which field keys actually changed, for the activity log — never
 * the values themselves.
 */
export async function saveCredentials(
  provider: PaymentProviderIdentity,
  fields: Record<string, string>,
): Promise<string[]> {
  const validKeys = new Set(PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
  const changed: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!validKeys.has(key)) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const encrypted = await encryptSecret(trimmed);
    await db.execute({
      sql: `INSERT INTO payment_credentials (provider, field, value, updated_at) VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(provider, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [provider, key, encrypted],
    });
    changed.push(key);
  }
  return changed;
}

/** Clears one saved field, reverting that provider back to its env-var
 * fallback (if any) for that field. */
export async function clearCredential(provider: PaymentProviderIdentity, field: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM payment_credentials WHERE provider = ? AND field = ?",
    args: [provider, field],
  });
}
