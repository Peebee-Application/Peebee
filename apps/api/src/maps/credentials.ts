/**
 * Admin-editable API credentials for the map providers, stored encrypted
 * in maps_credentials (same table shape and same crypto helper as
 * ../payments/credentials.ts and ../calls/credentials.ts — see
 * ../db/migrations/0041_maps.sql and ../lib/crypto.ts). "streetmaps"
 * (OpenStreetMap tiles + Nominatim geocoding) needs no credentials at all.
 */

import { db } from "../db/client.js";
import { decryptSecret, encryptSecret } from "../lib/crypto.js";
import type { MapsProviderIdentity } from "../lib/settings.js";

export type CredentialFieldDef = {
  key: string;
  label: string;
  secret: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
  envVar: string;
};

export const MAPS_PROVIDER_CREDENTIAL_FIELDS: Record<Exclude<MapsProviderIdentity, "streetmaps">, CredentialFieldDef[]> = {
  google: [
    {
      key: "apiKey",
      label: "Maps JavaScript API key",
      secret: true,
      required: true,
      envVar: "GOOGLE_MAPS_API_KEY",
      helpText:
        "From Google Cloud Console — a browser key with the Maps JavaScript, Places, and Geocoding APIs enabled, " +
        "restricted to this app's domains. This key is sent to the browser to render the map, same as Google's own docs expect.",
    },
  ],
  mapbox: [
    {
      key: "accessToken",
      label: "Access token",
      secret: true,
      required: true,
      envVar: "MAPBOX_ACCESS_TOKEN",
      helpText:
        "From your Mapbox account's Tokens page — a public token (starts with pk.) scoped to this app's URL. " +
        "Public tokens are meant to be used client-side, same as Mapbox's own docs expect.",
    },
  ],
  maptiler: [
    {
      key: "apiKey",
      label: "API key",
      secret: true,
      required: true,
      envVar: "MAPTILER_API_KEY",
      helpText: "From your MapTiler Cloud account's Keys page. Still OpenStreetMap data, styled by MapTiler.",
    },
  ],
  stadia: [
    {
      key: "apiKey",
      label: "API key",
      secret: true,
      required: true,
      envVar: "STADIA_MAPS_API_KEY",
      helpText:
        "From your Stadia Maps account's API Keys page. Restrict it to this app's domains — Stadia's free tier " +
        "requires either domain restriction or a set-up billing account.",
    },
  ],
  thunderforest: [
    {
      key: "apiKey",
      label: "API key",
      secret: true,
      required: true,
      envVar: "THUNDERFOREST_API_KEY",
      helpText: "From your Thunderforest account's dashboard.",
    },
  ],
  jawg: [
    {
      key: "accessToken",
      label: "Access token",
      secret: true,
      required: true,
      envVar: "JAWG_ACCESS_TOKEN",
      helpText: "From your Jawg Maps account's Access tokens page.",
    },
  ],
  tomtom: [
    {
      key: "apiKey",
      label: "API key",
      secret: true,
      required: true,
      envVar: "TOMTOM_API_KEY",
      helpText:
        "From your TomTom Developer Portal dashboard — a key with the Map Display API enabled. " +
        "Restrict it to this app's domains, since it's sent to the browser to load map tiles.",
    },
  ],
};

type Row = { value: string };

async function readStored(provider: Exclude<MapsProviderIdentity, "streetmaps">, field: string): Promise<string | undefined> {
  let res;
  try {
    res = await db.execute({
      sql: "SELECT value FROM maps_credentials WHERE provider = ? AND field = ?",
      args: [provider, field],
    });
  } catch (err) {
    console.error("maps_credentials read failed, falling back to env var:", err);
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

export async function getMapsCredential(provider: Exclude<MapsProviderIdentity, "streetmaps">, field: string): Promise<string | undefined> {
  const stored = await readStored(provider, field);
  if (stored) return stored;
  const def = MAPS_PROVIDER_CREDENTIAL_FIELDS[provider].find((f) => f.key === field);
  return def?.envVar ? process.env[def.envVar] || undefined : undefined;
}

export async function isMapsProviderConfigured(provider: MapsProviderIdentity): Promise<boolean> {
  if (provider === "streetmaps") return true;
  const required = MAPS_PROVIDER_CREDENTIAL_FIELDS[provider].filter((f) => f.required);
  const values = await Promise.all(required.map((f) => getMapsCredential(provider, f.key)));
  return values.every((v) => !!v);
}

export async function mapsCredentialFieldStatus(provider: Exclude<MapsProviderIdentity, "streetmaps">) {
  const fields = MAPS_PROVIDER_CREDENTIAL_FIELDS[provider];
  return Promise.all(
    fields.map(async (f) => ({
      key: f.key,
      label: f.label,
      secret: f.secret,
      required: f.required,
      placeholder: f.placeholder,
      helpText: f.helpText,
      set: !!(await getMapsCredential(provider, f.key)),
    })),
  );
}

export async function saveMapsCredentials(
  provider: Exclude<MapsProviderIdentity, "streetmaps">,
  fields: Record<string, string>,
): Promise<string[]> {
  const validKeys = new Set(MAPS_PROVIDER_CREDENTIAL_FIELDS[provider].map((f) => f.key));
  const changed: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!validKeys.has(key)) continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const encrypted = await encryptSecret(trimmed);
    await db.execute({
      sql: `INSERT INTO maps_credentials (provider, field, value, updated_at) VALUES (?, ?, ?, datetime('now'))
            ON CONFLICT(provider, field) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [provider, key, encrypted],
    });
    changed.push(key);
  }
  return changed;
}

export async function clearMapsCredential(provider: Exclude<MapsProviderIdentity, "streetmaps">, field: string): Promise<void> {
  await db.execute({ sql: "DELETE FROM maps_credentials WHERE provider = ? AND field = ?", args: [provider, field] });
}
