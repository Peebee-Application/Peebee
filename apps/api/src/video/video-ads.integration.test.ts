import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type InArgs } from "@libsql/client/node";

process.env.JWT_SECRET = "video-ads-test-only-secret";
process.env.CREDENTIALS_ENCRYPTION_KEY = "video-ads-test-encryption-key";

import app from "../app.js";
import { signToken } from "../auth/jwt.js";
import { setD1Binding, type D1Database } from "../db/client.js";
import { splitSqlStatements } from "../db/split-sql.js";
import { resetSchemaCache } from "../lib/schema.js";
import { invalidateSettingsCache } from "../lib/settings.js";

type Json = Record<string, any>;

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql,
    args: [] as unknown[],
    bind(...args: unknown[]) {
      this.args = args;
      return this;
    },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({
    prepare,
    async batch(statements: ReturnType<typeof prepare>[]) {
      const results = await client.batch(statements.map(({ sql, args }) => ({ sql, args: args as InArgs })), "write");
      return results.map((result) => ({ results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } }));
    },
  } as unknown as D1Database);
}

async function setup(opts: { migrate?: boolean } = {}) {
  resetSchemaCache();
  invalidateSettingsCache();
  const client = createClient({ url: "file::memory:" });
  const migrations = join(process.cwd(), "src/db/migrations");
  for (const file of readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort()) {
    if (opts.migrate === false && /^(0135|0136|0176)_/.test(file)) continue;
    for (const sql of splitSqlStatements(readFileSync(join(migrations, file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);

  let n = 0;
  const mkUser = async (id: string, role: "customer" | "admin" = "customer") => {
    n += 1;
    await client.execute({
      sql: "INSERT INTO users (id, phone, name, role, password_hash, admin_role) VALUES (?, ?, ?, ?, 'x', ?)",
      args: [id, `+25672000${String(n).padStart(4, "0")}`, `User ${id}`, role, role === "admin" ? "super_admin" : null],
    });
    return signToken({ sub: id, role });
  };
  const call = async (path: string, o: { method?: string; token?: string; body?: unknown } = {}) => {
    const res = await app.request(`/v1${path}`, {
      method: o.method ?? (o.body !== undefined ? "POST" : "GET"),
      headers: { "Content-Type": "application/json", ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
      body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    });
    const text = await res.text();
    let json: Json = {};
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  return { client, call, mkUser };
}

/** Pretends every video address answers a HEAD request as a real file. */
function stubFetch() {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "HEAD") return new Response(null, { status: 200, headers: { "content-type": url.endsWith(".m3u8") ? "application/vnd.apple.mpegurl" : "video/mp4" } });
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return () => { globalThis.fetch = real; };
}

test("video: off until an admin turns it on, and the migration being missing is not an error", async () => {
  const { call, mkUser } = await setup({ migrate: false });
  const token = await mkUser("c1");
  const admin = await mkUser("a1", "admin");
  const r = await call("/video/assets/import", { token, body: { provider: "link", reference: "https://cdn.example.com/a.mp4" } });
  assert.equal(r.status, 503);
  assert.equal((await call("/video/providers", { token })).status, 200);
  const status = await call("/admin/video", { token: admin });
  assert.equal(status.status, 200);
  assert.equal(status.json.migrationApplied, false);
  assert.equal((await call("/ads/plan?asset=x")).status, 200);
  assert.equal((await call("/ads/decision?asset=x")).json.ad, null);
});

test("video: bringing a link, with the safety checks", async () => {
  const { call, mkUser } = await setup();
  const restore = stubFetch();
  try {
    const creator = await mkUser("c1");
    const other = await mkUser("c2");
    const admin = await mkUser("a1", "admin");
    const link = (reference: string, t = creator) => call("/video/assets/import", { token: t, body: { provider: "link", reference } });

    assert.equal((await link("https://cdn.example.com/a.mp4")).status, 503, "still off");
    assert.equal((await call("/admin/video/config", { method: "PUT", token: creator, body: { enabled: true } })).status, 403, "creators cannot change settings");
    assert.equal((await call("/admin/video/config", { method: "PUT", token: admin, body: { enabled: true } })).status, 200);
    assert.equal((await link("https://cdn.example.com/a.mp4")).status, 403, "bring-your-own still off");
    assert.equal((await call("/admin/video/config", { method: "PUT", token: admin, body: { byoEnabled: true } })).status, 200);

    const ok = await link("https://cdn.example.com/a.mp4");
    assert.equal(ok.status, 201, JSON.stringify(ok.json));
    assert.equal(ok.json.asset.status, "ready");
    assert.equal(ok.json.asset.source, "link");
    const again = await link("https://cdn.example.com/a.mp4");
    assert.equal(again.json.asset.id, ok.json.asset.id, "the same video is not added twice");

    assert.equal((await link("https://www.youtube.com/watch?v=abc")).status, 400);
    assert.equal((await link("http://cdn.example.com/a.mp4")).status, 400);
    assert.equal((await link("https://169.254.169.254/a.mp4")).status, 400);
    assert.equal((await link("https://cdn.example.com/page.html")).status, 400);
    assert.equal((await call("/video/assets/import", { token: creator, body: { provider: "cloudinary", reference: "folder/clip" } })).json.error, "not_connected");
    assert.equal((await call("/video/assets/import", { token: creator, body: { provider: "mock", reference: "x" } })).status, 400, "the demo provider is never a creator choice");

    // Only the owner sees or removes a video record.
    assert.equal((await call(`/video/assets/${ok.json.asset.id}`, { token: other })).status, 404);
    assert.equal((await call(`/video/assets/${ok.json.asset.id}`, { method: "DELETE", token: other })).status, 404);
    const play = await call(`/video/assets/${ok.json.asset.id}/playback`, { token: other });
    assert.equal(play.status, 200);
    assert.equal(play.json.playback.mp4Url, "https://cdn.example.com/a.mp4");
    assert.equal(play.json.asset.externalId, undefined, "provider ids stay private to the owner");
    assert.equal((await call(`/video/assets/${ok.json.asset.id}`, { method: "DELETE", token: creator })).status, 200);
    assert.equal((await call(`/video/assets/${ok.json.asset.id}`, { token: creator })).status, 404);
  } finally {
    restore();
  }
});

test("video: daily limit and the platform upload need a configured provider", async () => {
  const { call, mkUser } = await setup();
  const restore = stubFetch();
  try {
    const creator = await mkUser("c1");
    const admin = await mkUser("a1", "admin");
    await call("/admin/video/config", { method: "PUT", token: admin, body: { enabled: true, byoEnabled: true, maxVideosPerDay: 2 } });
    const up = await call("/video/uploads", { token: creator, body: { source: "platform" } });
    assert.equal(up.status, 503);
    assert.equal(up.json.error, "no_platform_provider");
    for (const name of ["a", "b"]) assert.equal((await call("/video/assets/import", { token: creator, body: { provider: "link", reference: `https://cdn.example.com/${name}.mp4` } })).status, 201);
    assert.equal((await call("/video/assets/import", { token: creator, body: { provider: "link", reference: "https://cdn.example.com/c.mp4" } })).status, 429);
  } finally {
    restore();
  }
});

test("video: platform keys are stored encrypted and never sent back", async () => {
  const { call, mkUser, client } = await setup();
  const admin = await mkUser("a1", "admin");
  const creator = await mkUser("c1");
  const secret = "cf-token-super-secret-123";
  assert.equal((await call("/admin/video/credentials/cloudflare_stream", { method: "PUT", token: creator, body: { fields: { apiToken: secret } } })).status, 403);
  assert.equal((await call("/admin/video/credentials/cloudflare_stream", { method: "PUT", token: admin, body: { fields: { apiToken: secret, accountId: "acct123" } } })).status, 200);
  assert.equal((await call("/admin/video/credentials/cloudflare_stream", { method: "PUT", token: admin, body: { fields: { bogus: "x" } } })).status, 400);

  const view = await call("/admin/video", { token: admin });
  assert.ok(!view.text.includes(secret) && !view.text.includes("acct123"), "no saved value is returned");
  const cf = view.json.providers.find((p: Json) => p.key === "cloudflare_stream");
  assert.equal(cf.configured, true);
  assert.ok(cf.credentialFields.every((f: Json) => f.set));

  const stored = await client.execute("SELECT value FROM video_credentials");
  assert.equal(stored.rows.length, 2);
  for (const row of stored.rows) assert.ok(!String(row.value).includes(secret) && !String(row.value).includes("acct123"));

  const log = await client.execute("SELECT summary, before_json, after_json FROM admin_activity_log WHERE action = 'video.credentials.update'");
  assert.equal(log.rows.length, 1);
  assert.ok(!JSON.stringify(log.rows).includes(secret), "the activity log names fields, not values");

  const cat = await call("/video/providers", { token: creator });
  assert.ok(!cat.text.includes(secret));
});

async function adSetup() {
  const ctx = await setup();
  const restore = stubFetch();
  const admin = await ctx.mkUser("a1", "admin");
  const creator = await ctx.mkUser("creator");
  const viewerA = await ctx.mkUser("viewerA");
  await ctx.call("/admin/video/config", { method: "PUT", token: admin, body: { enabled: true, byoEnabled: true } });
  const imp = await ctx.call("/video/assets/import", { token: creator, body: { provider: "link", reference: "https://cdn.example.com/long.mp4" } });
  const assetId = imp.json.asset.id as string;
  await ctx.client.execute({ sql: "UPDATE video_assets SET duration_seconds = 120 WHERE id = ?", args: [assetId] });
  const camp = await ctx.call("/admin/ads/campaigns", { token: admin, body: { advertiserName: "Mama Rose Bakery", name: "Launch", pricingModel: "cpm", rateUgx: 20000, budgetUgx: 100 } });
  assert.equal(camp.status, 201, JSON.stringify(camp.json));
  const campaignId = camp.json.id as string;
  const cr = await ctx.call(`/admin/ads/campaigns/${campaignId}/creatives`, { token: admin, body: { mediaUrl: "https://ads.example.com/rose.mp4", clickUrl: "https://rose.example.com/", headline: "Fresh bread", durationSeconds: 15 } });
  assert.equal(cr.status, 201, JSON.stringify(cr.json));
  return { ...ctx, restore, admin, creator, viewerA, assetId, campaignId };
}

test("ads: off by default, then served, billed once, and shared with the creator", async () => {
  const t = await adSetup();
  try {
    const decide = (token?: string) => t.call(`/ads/decision?asset=${t.assetId}&slot=preroll`, { token });
    assert.equal((await decide(t.viewerA)).json.ad, null, "ads are off until enabled");
    assert.equal((await t.call(`/admin/ads/campaigns/${t.campaignId}/status`, { method: "PUT", token: t.admin, body: { status: "active" } })).status, 200);
    assert.equal((await t.call("/admin/ads/config", { method: "PUT", token: t.admin, body: { enabled: true, creatorSharePercent: 50 } })).status, 200);

    const d = await decide(t.viewerA);
    assert.equal(d.status, 200);
    const ad = d.json.ad;
    assert.ok(ad, "an ad is served");
    assert.equal(ad.creative.headline, "Fresh bread");
    assert.equal(ad.creative.skipAfterSeconds, 5);
    assert.ok(!JSON.stringify(ad).includes("rose.example.com"), "the click-through address is not exposed to the player");

    const beacon = (event: string, token = ad.token as string) => t.call(`/ads/e/${token}/${event}`, { method: "POST" });
    assert.equal((await beacon("complete")).status, 204);
    const before = await t.client.execute("SELECT COUNT(*) AS n FROM ad_events");
    assert.equal(Number(before.rows[0]!.n), 0, "nothing counts before the impression");
    assert.equal((await beacon("impression")).status, 204);
    assert.equal((await beacon("impression")).status, 204);
    assert.equal((await beacon("q50")).status, 204);
    assert.equal((await beacon("complete")).status, 204);

    const events = await t.client.execute("SELECT event, cost_milli, creator_share_milli, creator_id FROM ad_events ORDER BY created_at, event");
    assert.equal(events.rows.filter((r) => r.event === "impression").length, 1, "a repeated beacon counts once");
    const imp = events.rows.find((r) => r.event === "impression")!;
    assert.equal(Number(imp.cost_milli), 20000, "20,000 UGX per 1,000 views is 20 UGX each");
    assert.equal(Number(imp.creator_share_milli), 10000, "the creator gets the admin-set 50%");
    assert.equal(imp.creator_id, "creator");
    assert.equal(Number(events.rows.find((r) => r.event === "complete")!.cost_milli), 0, "cpm only charges on the impression");

    // A forged or tampered token counts nothing.
    await beacon("impression", `${ad.token.split(".")[0]}.AAAA`);
    assert.equal(Number((await t.client.execute("SELECT COUNT(*) AS n FROM ad_events")).rows[0]!.n), 3);

    const earnings = await t.call("/ads/earnings", { token: t.creator });
    assert.equal(earnings.json.impressions, 1);
    assert.equal(earnings.json.earnedUgx, 10);

    const report = await t.call("/admin/ads", { token: t.admin });
    const row = report.json.campaigns.find((c: Json) => c.id === t.campaignId);
    assert.equal(row.impressions, 1);
    assert.equal(row.spentUgx, 20);
  } finally {
    t.restore();
  }
});

test("ads: a click is counted once and redirects only to the approved https address", async () => {
  const t = await adSetup();
  try {
    await t.call(`/admin/ads/campaigns/${t.campaignId}/status`, { method: "PUT", token: t.admin, body: { status: "active" } });
    await t.call("/admin/ads/config", { method: "PUT", token: t.admin, body: { enabled: true } });
    const ad = (await t.call(`/ads/decision?asset=${t.assetId}&slot=preroll`, { token: t.viewerA })).json.ad;
    await t.call(`/ads/e/${ad.token}/impression`);
    const res = await app.request(`/v1/ads/click/${ad.token}`, { redirect: "manual" });
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), "https://rose.example.com/");
    const bad = await app.request(`/v1/ads/click/not-a-token`, { redirect: "manual" });
    assert.equal(bad.status, 204);
  } finally {
    t.restore();
  }
});

test("ads: caps, self-views, budget and short videos", async () => {
  const t = await adSetup();
  try {
    await t.call(`/admin/ads/campaigns/${t.campaignId}/status`, { method: "PUT", token: t.admin, body: { status: "active" } });
    await t.call("/admin/ads/config", { method: "PUT", token: t.admin, body: { enabled: true, maxAdsPerView: 1 } });
    const decide = (token: string) => t.call(`/ads/decision?asset=${t.assetId}&slot=preroll`, { token });

    // The creator watching their own video is never charged to the advertiser.
    const own = (await decide(t.creator)).json.ad;
    await t.call(`/ads/e/${own.token}/impression`);
    const ownRow = (await t.client.execute("SELECT cost_milli, creator_share_milli FROM ad_events")).rows[0]!;
    assert.equal(Number(ownRow.cost_milli), 0);
    assert.equal(Number(ownRow.creator_share_milli), 0);
    assert.equal((await decide(t.creator)).json.ad, null, "one ad per viewing");

    // Mid-roll is off, and a video under the minimum length gets nothing.
    assert.equal((await t.call(`/ads/decision?asset=${t.assetId}&slot=midroll`, { token: t.viewerA })).json.ad, null);
    await t.client.execute({ sql: "UPDATE video_assets SET duration_seconds = 10 WHERE id = ?", args: [t.assetId] });
    assert.equal((await decide(t.viewerA)).json.ad, null);
    await t.client.execute({ sql: "UPDATE video_assets SET duration_seconds = 120 WHERE id = ?", args: [t.assetId] });

    // Budget: 100 UGX at 20 UGX per view is five views; the sixth finds the campaign ended.
    await t.call("/admin/ads/config", { method: "PUT", token: t.admin, body: { maxAdsPerView: 20, viewerCapPerHour: 200 } });
    let billed = 0;
    for (let i = 0; i < 7; i++) {
      const ad = (await decide(t.viewerA)).json.ad;
      if (!ad) break;
      await t.call(`/ads/e/${ad.token}/impression`);
      billed += 1;
    }
    assert.equal(billed, 5, "five paid views fit the budget");
    const camp = (await t.client.execute({ sql: "SELECT status, spent_milli FROM ad_campaigns WHERE id = ?", args: [t.campaignId] })).rows[0]!;
    assert.equal(Number(camp.spent_milli), 100_000);
    assert.equal((await decide(t.viewerA)).json.ad, null, "no ad once the budget is spent");
  } finally {
    t.restore();
  }
});

test("ads: house ads fill the slot only when allowed, VAST works, and bad creatives are refused", async () => {
  const t = await adSetup();
  try {
    await t.call("/admin/ads/config", { method: "PUT", token: t.admin, body: { enabled: true } });
    // The only campaign is a draft, so nothing is served.
    assert.equal((await t.call(`/ads/decision?asset=${t.assetId}&slot=preroll`, { token: t.viewerA })).json.ad, null);
    const empty = await t.call(`/ads/vast?asset=${t.assetId}&slot=preroll`, { token: t.viewerA });
    assert.match(empty.text, /<VAST version="4.0"><\/VAST>/);

    const house = await t.call("/admin/ads/campaigns", { token: t.admin, body: { advertiserName: "Peebee", name: "Download the app", isHouse: true } });
    const houseId = house.json.id as string;
    assert.equal((await t.call(`/admin/ads/campaigns/${houseId}/status`, { method: "PUT", token: t.admin, body: { status: "active" } })).status, 400, "needs an approved creative first");
    const bad = await t.call(`/admin/ads/campaigns/${houseId}/creatives`, { token: t.admin, body: { mediaUrl: "http://127.0.0.1/x.mp4" } });
    assert.equal(bad.status, 400);
    const badClick = await t.call(`/admin/ads/campaigns/${houseId}/creatives`, { token: t.admin, body: { mediaUrl: "https://ads.example.com/h.mp4", clickUrl: "javascript:alert(1)" } });
    assert.equal(badClick.status, 400);
    await t.call(`/admin/ads/campaigns/${houseId}/creatives`, { token: t.admin, body: { mediaUrl: "https://ads.example.com/h.mp4", headline: "Peebee" } });
    assert.equal((await t.call(`/admin/ads/campaigns/${houseId}/status`, { method: "PUT", token: t.admin, body: { status: "active" } })).status, 200);

    const vast = await t.call(`/ads/vast?asset=${t.assetId}&slot=preroll`, { token: t.viewerA });
    assert.match(vast.text, /<MediaFile[^>]*>.*h\.mp4/s);
    assert.match(vast.headers.get("content-type") ?? "", /xml/);

    await t.call("/admin/ads/config", { method: "PUT", token: t.admin, body: { houseAdsFallback: false } });
    assert.equal((await t.call(`/ads/decision?asset=${t.assetId}&slot=preroll`, { token: t.viewerA })).json.ad, null);

    // House ads earn nothing.
    await t.call("/admin/ads/config", { method: "PUT", token: t.admin, body: { houseAdsFallback: true } });
    const ad = (await t.call(`/ads/decision?asset=${t.assetId}&slot=preroll`, { token: t.viewerA })).json.ad;
    await t.call(`/ads/e/${ad.token}/impression`);
    const row = (await t.client.execute("SELECT cost_milli, creator_share_milli FROM ad_events")).rows[0]!;
    assert.equal(Number(row.cost_milli), 0);
    assert.equal(Number(row.creator_share_milli), 0);

    // A creative must be rejected with a reason, and a rejected one is not served.
    assert.equal((await t.call(`/admin/ads/creatives/nope/status`, { method: "PUT", token: t.admin, body: { status: "rejected" } })).status, 400);
    const log = await t.client.execute("SELECT action FROM admin_activity_log WHERE action LIKE 'ads.%'");
    assert.ok(log.rows.length >= 5, "every admin ad change is in the activity log");
  } finally {
    t.restore();
  }
});
