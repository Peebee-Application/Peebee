import { Hono } from "hono";
import { requireAuth } from "../auth/middleware.js";
import { db } from "../db/client.js";
import { consume, hashKey } from "../lib/ratelimit.js";
import { getOptions } from "../lib/option-settings.js";
import { hasColumn, hasTable } from "../lib/schema.js";
import { migrationPending, publicRateLimit } from "../lib/guards.js";
import { newCode, makeChallenge, proofIsValid } from "../lib/phone-proof.js";
import { sendSms, smsIsReal } from "../lib/sms-gateway.js";
import { isHttpsUrl } from "../lib/validation.js";
import { getR2Bucket, r2IsReady } from "../storage/r2.js";
import {
  downloadPageUrl, licensePoolCounts, newAccessToken, purchaseDigitalProduct, refundFulfillment, sha256Hex, signFileLink, verifyFileLink,
} from "./digital-sales.js";
import { findPublicStore } from "./public.js";
import { getMerchantStore } from "./digital-lms.js";
import { fetchTrustedFile, trustedFileUrl } from "./file-proxy.js";

type Row = Record<string, unknown>;

export const digitalDeliveryRoutes = new Hono();

const apiBase = () => process.env.API_PUBLIC_URL ?? ((process.env.ENVIRONMENT ?? "development") !== "development" ? "https://api.peebee.online" : "http://localhost:8787");

/* ------------------------------------------------------------- buying */

{
  digitalDeliveryRoutes.post("/marketplace/digital/:productId/buy", requireAuth, async (c) => {
    const user = c.get("user");
    const slow = await consume(`digital-buy:${await hashKey(user.sub)}`, 10, 600);
    if (!slow.allowed) return c.json({ error: "rate_limited", message: "Too many purchase attempts. Please wait a few minutes." }, 429);

    const found = await db.execute({ sql: "SELECT store_id FROM store_digital_products WHERE id = ?", args: [c.req.param("productId")!] }).catch(() => null);
    const storeId = found?.rows[0]?.store_id ? String(found.rows[0].store_id) : null;
    const store = storeId ? await findPublicStore(storeId) : null;
    if (!store) return c.json({ error: "product_not_found", message: "That product isn't for sale." }, 404);

    const buyer = (await db.execute({ sql: "SELECT id, name, phone FROM users WHERE id = ?", args: [user.sub] })).rows[0] as Row | undefined;
    const result = await purchaseDigitalProduct({
      buyer: { id: user.sub, name: buyer?.name ? String(buyer.name) : null, phone: buyer?.phone ? String(buyer.phone) : null },
      productId: c.req.param("productId")!,
      store,
    });
    if (!result.ok) return c.json({ error: result.error, message: result.message }, result.status);
    return c.json({
      ok: true,
      fulfillmentId: result.fulfillmentId,
      accessUrl: result.accessUrl,
      token: result.token,
      licenseKey: result.licenseKey,
      expiresAt: result.expiresAt,
      maxDownloads: result.maxDownloads,
      pricePaidUgx: result.pricePaidUgx,
      sms: result.sms,
      needsManualFulfilment: result.needsManualFulfilment,
    }, 201);
  });
}

/* ------------------------------------------------------ the buyer's page */

async function findByToken(token: string): Promise<Row | null> {
  if (!(await hasTable("store_digital_fulfillments"))) return null;
  const res = await db.execute({
    sql: `SELECT f.*, p.title AS product_title, p.kind AS product_kind, p.file_url AS product_file_url, p.file_key AS product_file_key,
                 p.file_name AS product_file_name, p.mime_type AS product_mime, p.delivery_instructions AS product_instructions,
                 p.linked_course_id AS product_course_id, s.name AS store_name, s.status AS store_status
          FROM store_digital_fulfillments f
          JOIN store_digital_products p ON p.id = f.digital_product_id
          JOIN stores s ON s.id = f.store_id
          WHERE f.access_token = ? LIMIT 1`,
    args: [await sha256Hex(token)],
  }).catch(() => null);
  return (res?.rows[0] as Row | undefined) ?? null;
}

function stateOf(row: Row): { usable: boolean; reason?: "revoked" | "refunded" | "expired" | "pending" | "limit_reached" } {
  if (row.status === "revoked") return { usable: false, reason: row.refunded_at ? "refunded" : "revoked" };
  if (row.status !== "active") return { usable: false, reason: "pending" };
  if (row.expires_at && new Date(String(row.expires_at)).getTime() <= Date.now()) return { usable: false, reason: "expired" };
  const max = Number(row.max_downloads ?? 0);
  if (max > 0 && Number(row.download_count) >= max) return { usable: false, reason: "limit_reached" };
  return { usable: true };
}

const MESSAGES: Record<string, string> = {
  revoked: "This purchase has been withdrawn by the store.",
  refunded: "This purchase was refunded.",
  expired: "This download link has expired.",
  pending: "This purchase isn't ready yet.",
  limit_reached: "The download limit for this purchase has been reached.",
};

/** What the page shows. Viewing never uses up a download; only the file request does. */
digitalDeliveryRoutes.get("/marketplace/digital-fulfillments/:token", async (c) => {
  const limited = await publicRateLimit(c, "dl-view", c.req.param("token")!.slice(0, 16), "rate_limit_token_download_per_minute", 60);
  if (limited) return limited;
  const row = await findByToken(c.req.param("token")!);
  if (!row) return c.json({ error: "not_found", message: "This link isn't valid." }, 404);
  const state = stateOf(row);
  if (!state.usable && (state.reason === "revoked" || state.reason === "refunded" || state.reason === "pending")) {
    return c.json({ error: state.reason, message: MESSAGES[state.reason!] }, 403);
  }

  const opts = await getOptions(["digital_license_reveal"]);
  const reveal = String(opts.digital_license_reveal);
  const license = row.license_key_issued ? String(row.license_key_issued) : null;
  let licenseKey: string | null = null;
  let licenseLocked: "phone" | "sms" | null = null;
  if (license) {
    if (reveal === "on_token_page") licenseKey = license;
    else if (reveal === "sms_only") licenseLocked = "sms";
    else if (await proofIsValid(c.req.header("x-phone-proof"), String(row.customer_phone ?? ""), "digital_access")) licenseKey = license;
    else licenseLocked = "phone";
  }
  const max = Number(row.max_downloads ?? 0);
  const phone = String(row.customer_phone ?? "");
  return c.json({
    ok: true,
    purchase: {
      id: String(row.id),
      title: String(row.product_title),
      kind: String(row.product_kind),
      storeName: String(row.store_name),
      fileName: row.product_file_name ? String(row.product_file_name) : null,
      instructions: row.product_instructions ? String(row.product_instructions) : null,
      hasFile: Boolean(row.product_file_key || row.product_file_url),
      downloadsUsed: Number(row.download_count) || 0,
      maxDownloads: max,
      downloadsLeft: max > 0 ? Math.max(0, max - (Number(row.download_count) || 0)) : null,
      expiresAt: row.expires_at ? String(row.expires_at) : null,
      canDownload: state.usable,
      problem: state.usable ? null : { reason: state.reason, message: MESSAGES[state.reason!] },
      licenseKey,
      licenseLocked,
      maskedPhone: phone.length > 4 ? `${"•".repeat(phone.length - 4)}${phone.slice(-4)}` : null,
      needsManualFulfilment: Number(row.needs_manual_fulfilment) === 1 && !license,
      courseUrl: row.product_course_id ? `${process.env.CUSTOMER_APP_URL ?? "https://app.peebee.online"}/learn/course/${String(row.product_course_id)}` : null,
    },
  });
});

/** Text a code to the phone on the purchase, so the licence key can be shown on the page. */
digitalDeliveryRoutes.post("/marketplace/digital-fulfillments/:token/phone-code", async (c) => {
  const row = await findByToken(c.req.param("token")!);
  if (!row || !row.customer_phone) return c.json({ error: "not_found", message: "This link isn't valid." }, 404);
  const limited = await publicRateLimit(c, "dl-code", String(row.customer_phone), "rate_limit_public_inquiry_per_hour", 3600);
  if (limited) return limited;
  if (!(await smsIsReal())) return c.json({ error: "sms_not_configured", message: "Phone codes are not available right now." }, 503);
  const code = newCode();
  const sent = await sendSms(String(row.customer_phone), `Your Peebee code is ${code}. It expires in 10 minutes. Don't share it.`);
  if (sent.status !== "sent") return c.json({ error: "sms_failed", message: "We couldn't send the code. Please try again." }, 502);
  return c.json(await makeChallenge(String(row.customer_phone), "digital_access", code));
});

/**
 * Takes one download and says where the file is. The count is taken by one conditional update, so a burst of requests
 * can't pass the limit. How the buyer reaches the bytes follows the admin's storage option.
 */
digitalDeliveryRoutes.post("/marketplace/digital-fulfillments/:token/download", async (c) => {
  const limited = await publicRateLimit(c, "dl", c.req.param("token")!.slice(0, 16), "rate_limit_token_download_per_minute", 60);
  if (limited) return limited;
  const row = await findByToken(c.req.param("token")!);
  if (!row) return c.json({ error: "not_found", message: "This link isn't valid." }, 404);
  const state = stateOf(row);
  if (!state.usable) return c.json({ error: state.reason, message: MESSAGES[state.reason!] }, 403);
  if (!row.product_file_key && !row.product_file_url) return c.json({ error: "no_file", message: "This purchase has no file to download." }, 409);

  const options = await getOptions(["digital_storage_backend", "digital_proxy_trusted_hosts"]);
  const backend = String(options.digital_storage_backend);
  // Refuse before charging a download attempt. Private R2 files are unaffected.
  if (!row.product_file_key && backend !== "external_url_via_redirect" &&
      !trustedFileUrl(String(row.product_file_url), options.digital_proxy_trusted_hosts as string[])) {
    return c.json({ error: "file_host_untrusted", message: "This file's host is not approved. Ask the store to upload the file to Peebee." }, 409);
  }

  const max = Number(row.max_downloads ?? 0);
  const claim = await db.execute({
    sql: `UPDATE store_digital_fulfillments SET download_count = download_count + 1
          WHERE id = ? AND status = 'active' AND (? = 0 OR download_count < ?)`,
    args: [String(row.id), max, max],
  });
  if (!claim.rowsAffected) return c.json({ error: "limit_reached", message: MESSAGES.limit_reached }, 403);
  await db.execute({ sql: "UPDATE store_digital_products SET downloads_count = downloads_count + 1 WHERE id = ?", args: [String(row.digital_product_id)] });

  if (!row.product_file_key && backend === "external_url_via_redirect") {
    return c.json({ ok: true, downloadUrl: String(row.product_file_url), via: "merchant_address", fileName: row.product_file_name });
  }
  const link = await signFileLink(String(row.id), 60);
  return c.json({ ok: true, downloadUrl: `${apiBase()}/v1/marketplace/digital-files/${link}`, via: "peebee", expiresInSeconds: 60, fileName: row.product_file_name });
});

/** The bytes, for a link that is still fresh. Private storage or the merchant's address, never exposed to the buyer. */
digitalDeliveryRoutes.get("/marketplace/digital-files/:link", async (c) => {
  const id = await verifyFileLink(c.req.param("link")!);
  if (!id) return c.json({ error: "link_expired", message: "This download link has expired. Open your purchase page and try again." }, 410);
  const row = (await db.execute({
    sql: `SELECT f.status, p.file_key, p.file_url, p.file_name, p.mime_type FROM store_digital_fulfillments f
          JOIN store_digital_products p ON p.id = f.digital_product_id WHERE f.id = ?`,
    args: [id],
  })).rows[0] as Row | undefined;
  if (!row || row.status !== "active") return c.json({ error: "revoked", message: "This purchase is no longer available." }, 403);

  const name = String(row.file_name || "download").replace(/[^\w.\- ]+/g, "_");
  const headers: Record<string, string> = {
    "Content-Disposition": `attachment; filename="${name}"`,
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, no-store",
  };
  if (row.file_key) {
    if (!r2IsReady()) return c.json({ error: "storage_unavailable", message: "File storage is not available right now." }, 503);
    const object = await getR2Bucket().get(String(row.file_key));
    if (!object) return c.json({ error: "file_missing", message: "The file is missing. Please tell the store." }, 404);
    headers["Content-Type"] = object.httpMetadata?.contentType ?? "application/octet-stream";
    if (object.size != null) headers["Content-Length"] = String(object.size);
    return new Response(object.body, { headers });
  }
  const url = String(row.file_url ?? "");
  if (!isHttpsUrl(url)) return c.json({ error: "file_missing", message: "The file is missing. Please tell the store." }, 404);
  const hosts = (await getOptions(["digital_proxy_trusted_hosts"])).digital_proxy_trusted_hosts as string[];
  const upstream = await fetchTrustedFile(url, hosts).catch(() => null);
  if (!upstream?.ok || !upstream.body) return c.json({ error: "file_unavailable", message: "The store's file could not be fetched right now." }, 502);
  headers["Content-Type"] = upstream.headers.get("content-type") ?? "application/octet-stream";
  const length = upstream.headers.get("content-length");
  if (length) headers["Content-Length"] = length;
  return new Response(upstream.body, { headers });
});

/* --------------------------------------------------- the signed-in buyer */

digitalDeliveryRoutes.get("/me/digital-purchases", requireAuth, async (c) => {
  if (!(await hasColumn("store_digital_fulfillments", "buyer_user_id"))) return c.json({ purchases: [] });
  const res = await db.execute({
    sql: `SELECT f.id, f.status, f.download_count, f.max_downloads, f.expires_at, f.price_paid_ugx, f.created_at, f.refunded_at,
                 p.title, p.kind, s.name AS store_name
          FROM store_digital_fulfillments f JOIN store_digital_products p ON p.id = f.digital_product_id JOIN stores s ON s.id = f.store_id
          WHERE f.buyer_user_id = ? AND f.status IN ('active', 'revoked') ORDER BY f.created_at DESC LIMIT 100`,
    args: [c.get("user").sub],
  });
  return c.json({ purchases: res.rows });
});

/** A fresh link for a purchase the signed-in buyer owns; the old link stops working. */
digitalDeliveryRoutes.post("/me/digital-purchases/:id/link", requireAuth, async (c) => {
  const row = (await db.execute({
    sql: "SELECT id, status FROM store_digital_fulfillments WHERE id = ? AND buyer_user_id = ?",
    args: [c.req.param("id")!, c.get("user").sub],
  })).rows[0] as Row | undefined;
  if (!row || row.status !== "active") return c.json({ error: "not_found", message: "That purchase isn't available." }, 404);
  const token = newAccessToken();
  await db.execute({ sql: "UPDATE store_digital_fulfillments SET access_token = ?, token_hint = ? WHERE id = ?", args: [await sha256Hex(token), token.slice(-4), String(row.id)] });
  return c.json({ ok: true, accessUrl: downloadPageUrl(token) });
});

/* ------------------------------------------------------------ the merchant */

const EXECUTABLE_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|js|jse|wsf|sh|bash|apk|app|dmg|pkg|jar|dll|bin)$/i;
function looksExecutable(head: Uint8Array): boolean {
  if (head[0] === 0x4d && head[1] === 0x5a) return true; // Windows program (MZ)
  if (head[0] === 0x7f && head[1] === 0x45 && head[2] === 0x4c && head[3] === 0x46) return true; // Linux program (ELF)
  if ((head[0] === 0xcf || head[0] === 0xce) && head[1] === 0xfa && head[2] === 0xed && head[3] === 0xfe) return true; // macOS program
  if (head[0] === 0x23 && head[1] === 0x21) return true; // #! script
  return false;
}

/** Upload (or replace) the private file for a product. The body is the file itself, streamed to storage. */
digitalDeliveryRoutes.put("/merchants/me/digital-products/:id/file", requireAuth, async (c) => {
  const store = await getMerchantStore(c.get("user").sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  const pending = await migrationPending(c, "0138_digital_fulfillment.sql", "store_digital_products");
  if (pending) return pending;
  if (!(await hasColumn("store_digital_products", "file_key"))) return c.json({ error: "migration_pending", message: "File uploads are being set up (0138_digital_fulfillment.sql is not applied yet)." }, 503);
  if (!r2IsReady()) return c.json({ error: "storage_unavailable", message: "File storage is not connected on this platform yet." }, 503);

  const product = (await db.execute({ sql: "SELECT id, file_key FROM store_digital_products WHERE id = ? AND store_id = ?", args: [c.req.param("id")!, String(store.id)] })).rows[0] as Row | undefined;
  if (!product) return c.json({ error: "not_found", message: "That product isn't yours." }, 404);

  const o = await getOptions(["digital_max_file_mb", "digital_allow_executables", "digital_file_scan"]);
  const length = Number(c.req.header("content-length"));
  if (!Number.isFinite(length) || length <= 0) return c.json({ error: "length_required", message: "Send the file with its size." }, 411);
  if (length > Number(o.digital_max_file_mb) * 1024 * 1024) return c.json({ error: "file_too_large", message: `Files can be up to ${o.digital_max_file_mb} MB.` }, 413);
  const stream = c.req.raw.body;
  if (!stream) return c.json({ error: "missing_file", message: "Choose a file to upload." }, 400);
  const slow = await consume(`digital-upload:${await hashKey(c.get("user").sub)}`, 30, 3600);
  if (!slow.allowed) return c.json({ error: "rate_limited", message: "Too many uploads. Please wait a while." }, 429);

  const rawName = decodeURIComponent(c.req.header("x-file-name") ?? "file").replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "file";
  const scanning = String(o.digital_file_scan) !== "off";
  if (scanning && !o.digital_allow_executables && EXECUTABLE_EXT.test(rawName)) {
    return c.json({ error: "unsupported_file_type", message: "Program files aren't allowed. Put them in a .zip, or ask the platform to allow them." }, 400);
  }
  // One branch is read for the first bytes, the other goes to storage, so the file is never held in memory.
  const [probe, upload] = stream.tee();
  const reader = probe.getReader();
  const first = await reader.read();
  void reader.cancel().catch(() => undefined);
  const head = (first.value ?? new Uint8Array()).slice(0, 8);
  if (scanning && !o.digital_allow_executables && looksExecutable(head)) {
    void upload.cancel().catch(() => undefined);
    return c.json({ error: "unsupported_file_type", message: "That file is a program, which isn't allowed here. Put it in a .zip, or ask the platform to allow program files." }, 400);
  }

  const key = `digital/${String(store.id)}/${String(product.id)}/${crypto.randomUUID()}`;
  const mime = (c.req.header("content-type") ?? "application/octet-stream").split(";")[0].trim().slice(0, 100);
  await getR2Bucket().put(key, upload as unknown as ReadableStream, { httpMetadata: { contentType: mime } });
  if (product.file_key) await getR2Bucket().delete(String(product.file_key)).catch(() => undefined);
  await db.execute({
    sql: "UPDATE store_digital_products SET file_key = ?, file_name = ?, file_size_bytes = ?, mime_type = ?, file_url = '', updated_at = datetime('now') WHERE id = ?",
    args: [key, rawName, length, mime, String(product.id)],
  });
  return c.json({ ok: true, file: { name: rawName, sizeBytes: length, contentType: mime } }, 201);
});

digitalDeliveryRoutes.get("/merchants/me/digital-products/:id/license-pool", requireAuth, async (c) => {
  const store = await getMerchantStore(c.get("user").sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  const owned = (await db.execute({ sql: "SELECT id FROM store_digital_products WHERE id = ? AND store_id = ?", args: [c.req.param("id")!, String(store.id)] })).rows[0];
  if (!owned) return c.json({ error: "not_found" }, 404);
  const counts = await licensePoolCounts(c.req.param("id")!);
  const keys = (await hasTable("store_license_keys"))
    ? (await db.execute({ sql: "SELECT license_key FROM store_license_keys WHERE product_id = ? AND status = 'available' ORDER BY created_at LIMIT 5000", args: [c.req.param("id")!] })).rows.map((r) => String((r as Row).license_key))
    : [];
  return c.json({ ...counts, keys });
});

/** Refund a sale from the merchant's balance and (admin option) end the buyer's access. */
digitalDeliveryRoutes.post("/merchants/me/digital-fulfillments/:id/refund", requireAuth, async (c) => {
  const store = await getMerchantStore(c.get("user").sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  const result = await refundFulfillment({ fulfillmentId: c.req.param("id")!, storeId: String(store.id), actorId: c.get("user").sub });
  if (!result.ok) return c.json({ error: result.error, message: result.message }, result.error === "not_found" ? 404 : 409);
  return c.json({ ok: true });
});

/** A backordered licence: the merchant types the key in by hand. */
digitalDeliveryRoutes.post("/merchants/me/digital-fulfillments/:id/license", requireAuth, async (c) => {
  const store = await getMerchantStore(c.get("user").sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  const body = (await c.req.json().catch(() => ({}))) as { license_key?: unknown };
  const key = typeof body.license_key === "string" ? body.license_key.trim() : "";
  if (!key || key.length > 200) return c.json({ error: "invalid_body", message: "Enter the licence key." }, 400);
  const res = await db.execute({
    sql: "UPDATE store_digital_fulfillments SET license_key_issued = ?, needs_manual_fulfilment = 0 WHERE id = ? AND store_id = ? AND status = 'active' AND needs_manual_fulfilment = 1",
    args: [key, c.req.param("id")!, String(store.id)],
  });
  if (!res.rowsAffected) return c.json({ error: "not_found", message: "Nothing to fulfil on that purchase." }, 404);
  return c.json({ ok: true });
});

/** Send the buyer a new link by SMS (the old one stops working). */
digitalDeliveryRoutes.post("/merchants/me/digital-fulfillments/:id/resend", requireAuth, async (c) => {
  const store = await getMerchantStore(c.get("user").sub, c.req.header("X-Merchant-Id"));
  if (!store) return c.json({ error: "no_store" }, 404);
  const row = (await db.execute({
    sql: "SELECT f.id, f.customer_phone, p.title FROM store_digital_fulfillments f JOIN store_digital_products p ON p.id = f.digital_product_id WHERE f.id = ? AND f.store_id = ? AND f.status = 'active'",
    args: [c.req.param("id")!, String(store.id)],
  })).rows[0] as Row | undefined;
  if (!row || !row.customer_phone) return c.json({ error: "not_found", message: "That purchase can't be resent." }, 404);
  const token = newAccessToken();
  await db.execute({ sql: "UPDATE store_digital_fulfillments SET access_token = ?, token_hint = ? WHERE id = ?", args: [await sha256Hex(token), token.slice(-4), String(row.id)] });
  const sent = await sendSms(String(row.customer_phone), `${String(row.title)}: your new download link: ${downloadPageUrl(token)}`);
  await db.execute({ sql: "UPDATE store_digital_fulfillments SET sms_status = ? WHERE id = ?", args: [sent.status, String(row.id)] });
  return c.json({ ok: sent.status !== "failed", sms: sent.status, ...(sent.status === "failed" ? { error: sent.error } : {}) });
});

