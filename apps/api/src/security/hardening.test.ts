import test from "node:test";
import assert from "node:assert/strict";
import { freshDatabase, addUser, addMerchantStore, anonymous, app, addAdmin } from "../test-support/db.js";
import { makeChallenge } from "../lib/phone-proof.js";
import { createAndSendOtp } from "../verify/service.js";
import { signFileLink } from "../marketplace/digital-sales.js";
import { setR2Binding } from "../storage/r2.js";
import { requiredPermission } from "../lib/guards.js";
import { fetchTrustedFile, trustedFileUrl } from "../marketplace/file-proxy.js";

test("unconfigured OTP delivery fails closed outside explicit development", async () => {
  const client = await freshDatabase();
  const saved = { ...process.env };
  const originalLog = console.log;
  const logs: unknown[][] = [];
  console.log = (...args) => { logs.push(args); };
  try {
    delete process.env.RESEND_API_KEY;
    delete process.env.AFRICASTALKING_USERNAME;
    delete process.env.AFRICASTALKING_API_KEY;
    await addUser(client, "otp-victim");
    await client.execute("UPDATE users SET email='victim@example.invalid' WHERE id='otp-victim'");
    for (const environment of ["production", "staging", undefined]) {
      if (environment) process.env.ENVIRONMENT = environment;
      else delete process.env.ENVIRONMENT;
      for (const channel of ["sms", "email"] as const) {
        await assert.rejects(createAndSendOtp("otp-victim", channel, channel === "email" ? "victim@example.invalid" : "+256700123456", "reset"), /not configured/);
      }
      const reset = await anonymous("/auth/password/reset/request", "POST", { identifier: "victim@example.invalid" });
      assert.equal(reset.status, 200);
      assert.deepEqual(await reset.json(), { sent: true });
    }
    assert.equal((await client.execute("SELECT COUNT(*) AS n FROM otp_codes")).rows[0].n, 0);
    assert.equal(logs.length, 0, "no OTP or target logged");
    process.env.ENVIRONMENT = "development";
    const dev = await createAndSendOtp("otp-victim", "email", "victim@example.invalid", "reset");
    assert.match(dev.devCode!, /^\d{6}$/);
  } finally {
    console.log = originalLog;
    for (const key of ["ENVIRONMENT", "RESEND_API_KEY", "AFRICASTALKING_USERNAME", "AFRICASTALKING_API_KEY"]) {
      if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
    }
  }
});

test("equivalent phone challenges share the attempt limit, including concurrent guesses", async () => {
  await freshDatabase();
  const { challenge } = await makeChallenge("+256700123456", "merchant_portal", "654321");
  const data = JSON.parse(Buffer.from(challenge, "base64url").toString());
  const variants = [challenge, Buffer.from(JSON.stringify(data, null, 1)).toString("base64url"), Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(data).reverse()))).toString("base64url")];
  const verify = (value: string, code = "000000") => anonymous("/public/phone-proof/verify", "POST", { challenge: value, code });
  await Promise.all(Array.from({ length: 5 }, (_, i) => verify(variants[i % variants.length])));
  for (const variant of variants) assert.equal((await verify(variant, "654321")).status, 429);
  const fresh = await makeChallenge("+256700123456", "merchant_portal", "654321");
  assert.equal((await verify(fresh.challenge, "654321")).status, 200);
  assert.equal((await verify(Buffer.from('{}').toString('base64url'))).status, 400);
});

test("digital subroutes enforce merchant permissions without blocking owners or allowed roles", async () => {
  const client = await freshDatabase();
  const seller = await addMerchantStore(client, "file-owner");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const token = await addUser(client, "file-cashier");
  await client.execute({ sql: "INSERT INTO merchant_members (merchant_id,user_id,role,status) VALUES (?,'file-cashier','cashier','active')", args: [seller.merchantId] });
  await client.execute({ sql: "INSERT INTO store_digital_products (id,store_id,title) VALUES ('file-product',?,'File product')", args: [seller.storeId] });
  const call = (path: string, method = "POST", body = "{}") => app.request(`/v1/merchants/me/${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Content-Length": String(body.length) }, body: method === "GET" ? undefined : body });
  let uploads = 0;
  setR2Binding({ put: async () => { uploads++; }, get: async () => null, delete: async () => {} });
  try {
    for (const [method, path] of [["PUT", "digital-products/file-product/file"], ["GET", "digital-products/file-product/license-pool"], ["POST", "digital-fulfillments/missing/refund"], ["POST", "digital-fulfillments/missing/license"], ["POST", "digital-fulfillments/missing/resend"], ["POST", "lms/courses/missing/publish-to-learn"]]) {
      assert.equal((await call(path, method)).status, 403, `${method} ${path}`);
    }
    assert.equal(uploads, 0);
    assert.equal((await call("digital-products", "GET")).status, 403);
    const owner = await app.request('/v1/merchants/me/digital-products/file-product/file', {method:'PUT',headers:{Authorization:`Bearer ${seller.token}`,'Content-Type':'text/plain','Content-Length':'4','x-file-name':'guide.txt'},body:'test'});
    assert.equal(owner.status,201,await owner.text());
    assert.equal(uploads,1);
    const admin = await addAdmin(client);
    await admin.setOptions({member_roles_manage_digital:["owner","manager","cashier"]});
    assert.equal((await call("digital-products/file-product/license-pool","GET")).status,200);
  } finally { setR2Binding(undefined); }
  assert.equal(requiredPermission("POST", "/v1/merchants/me/future-sensitive-write"), "manage_store_settings");
  assert.equal(requiredPermission("POST", "/v1/merchants/me/pos-sales"), null);
});

test("download proxy requires explicit host trust and checks every redirect destination", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      calls.push(String(input));
      assert.equal(init?.redirect, "manual");
      return new Response(null, {status:302,headers:{Location:"https://127.0.0.1/private"}});
    };
    for (const url of ["https://127.0.0.1/x", "https://2130706433/x", "https://[::1]/x", "https://localhost/x", "https://files.example:444/x", "https://user:pass@files.example/x", "https://files.example.attacker.com/x"]) {
      assert.equal(await fetchTrustedFile(url, ["files.example", "127.0.0.1"]), null);
    }
    assert.equal(await fetchTrustedFile("https://files.example/x", []), null);
    assert.equal(calls.length, 0);
    assert.equal(await fetchTrustedFile("https://files.example/x", ["files.example"]), null);
    assert.equal(calls.length, 1, "private redirect never fetched");
    globalThis.fetch = async input => new Response(null,{status:302,headers:{Location:"https://untrusted.example/x"}});
    assert.equal(await fetchTrustedFile("https://files.example/x", ["files.example"]), null);
    globalThis.fetch = async input => String(input).endsWith('/start') ? new Response(null,{status:302,headers:{Location:"/file"}}) : new Response("trusted file");
    assert.equal(await (await fetchTrustedFile("https://files.example/start", ["files.example"]))!.text(), "trusted file");
    assert.ok(trustedFileUrl("https://files.example/file", ["files.example"]));
  } finally { globalThis.fetch = original; }
});

test("untrusted external download refuses before counting, including direct file-link access", async () => {
  const client = await freshDatabase();
  const seller = await addMerchantStore(client, "proxy-owner");
  assert.equal((await seller.call("/merchants/me/store/tier", "POST", {tier: "elite"})).status, 200);
  const {sha256Hex} = await import('../marketplace/digital-sales.js');
  await client.execute({ sql: "INSERT INTO store_digital_products (id,store_id,title,file_url) VALUES ('proxy-product',?,'File','https://127.0.0.1/private')", args: [seller.storeId] });
  await client.execute({ sql: "INSERT INTO store_digital_fulfillments (id,store_id,digital_product_id,customer_phone,access_token) VALUES ('proxy-sale',?,'proxy-product','+256700123456',?)", args: [seller.storeId,await sha256Hex('proxy-token')] });
  const original = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; return new Response('private'); };
  try {
    assert.equal((await anonymous('/marketplace/digital-fulfillments/proxy-token/download','POST',{})).status,409);
    assert.equal((await client.execute("SELECT download_count FROM store_digital_fulfillments WHERE id='proxy-sale'")).rows[0].download_count,0);
    const link = await signFileLink('proxy-sale',60);
    assert.equal((await anonymous(`/marketplace/digital-files/${link}`)).status,502);
    assert.equal(requests,0);
  } finally {globalThis.fetch=original;}
});
