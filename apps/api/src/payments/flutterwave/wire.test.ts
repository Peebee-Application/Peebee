import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { createClient, type Client, type InArgs } from "@libsql/client/node";
import { setD1Binding, type D1Database } from "../../db/client.js";
import { splitSqlStatements } from "../../db/split-sql.js";
import { setFlutterwaveDirect } from "../../lib/settings.js";
import { cardSchema } from "../card.js";
import { credentialLengthError } from "../credentials.js";
import { tripleDesEcbEncrypt } from "./des.js";
import { encryptCardPayload, flutterwaveAdapter } from "./wire.js";

function bindDatabase(client: Client) {
  const prepare = (sql: string) => ({
    sql, args: [] as unknown[],
    bind(...args: unknown[]) { this.args = args; return this; },
    async all() {
      const result = await client.execute({ sql: this.sql, args: this.args as InArgs });
      return { results: result.rows, success: true, meta: { changes: result.rowsAffected, last_row_id: Number(result.lastInsertRowid ?? 0) } };
    },
  });
  setD1Binding({ prepare } as unknown as D1Database);
}

const KEY = "abcdefghijklmnopqrstuvwx";
const card = { number: "4242424242424242", cvv: "123", expiryMonth: "12", expiryYear: "2099" };
const base = { referenceId: "pay_1", amount: 5000, currency: "UGX", narrative: "test", name: "Test User" };

type Call = { url: string; body: Record<string, unknown> };

function decrypt(encrypted: string): Record<string, unknown> {
  const decipher = createDecipheriv("des-ede3", Buffer.from(KEY), null);
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(encrypted, "base64")), decipher.final()]).toString("utf8"));
}

test("flutterwave routes each payment to the flow the admin switched on", async (t) => {
  const client = createClient({ url: "file::memory:" });
  for (const file of readdirSync(join(process.cwd(), "src/db/migrations")).filter((f) => f.endsWith(".sql")).sort()) {
    for (const sql of splitSqlStatements(readFileSync(join(process.cwd(), "src/db/migrations", file), "utf8"))) await client.execute(sql);
  }
  bindDatabase(client);
  const env = { secret: process.env.FLUTTERWAVE_SECRET_KEY, key: process.env.FLUTTERWAVE_ENCRYPTION_KEY };
  process.env.FLUTTERWAVE_SECRET_KEY = "FLWSECK_TEST";
  delete process.env.FLUTTERWAVE_ENCRYPTION_KEY;
  const realFetch = globalThis.fetch;
  const calls: Call[] = [];
  let chargeResponse: unknown = { status: "success", data: { id: 1, flw_ref: "FLW-1", status: "pending" }, meta: { authorization: { mode: "pin" } } };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url: url.replace("https://api.flutterwave.com/v3", ""), body: JSON.parse(String(init?.body ?? "{}")) });
    const hosted = url.endsWith("/payments");
    return new Response(JSON.stringify(hosted ? { status: "success", data: { link: "https://checkout.flutterwave.com/x" } } : chargeResponse), { status: 200 });
  }) as typeof fetch;
  t.after(() => {
    globalThis.fetch = realFetch;
    if (env.secret === undefined) delete process.env.FLUTTERWAVE_SECRET_KEY; else process.env.FLUTTERWAVE_SECRET_KEY = env.secret;
    if (env.key === undefined) delete process.env.FLUTTERWAVE_ENCRYPTION_KEY; else process.env.FLUTTERWAVE_ENCRYPTION_KEY = env.key;
  });

  await t.test("mobile money is direct by default: prompt on the phone, no page to open", async () => {
    calls.length = 0;
    chargeResponse = { status: "success", data: { id: 7, status: "pending" } };
    const result = await flutterwaveAdapter.depositFunds({ ...base, method: "mobile_money", msisdn: "0772123456" });
    assert.equal(calls[0].url, "/charges?type=mobile_money_uganda");
    assert.equal(calls[0].body.network, "MTN");
    assert.equal(calls[0].body.phone_number, "256772123456");
    assert.equal(result.redirectUrl, undefined);
    assert.equal(result.status, "PENDING");
  });

  await t.test("if Flutterwave asks for a step on its own page, the customer is sent there", async () => {
    calls.length = 0;
    chargeResponse = { status: "success", data: { id: 8, status: "pending" }, meta: { authorization: { mode: "redirect", redirect: "https://checkout.flutterwave.com/mm-step" } } };
    const result = await flutterwaveAdapter.depositFunds({ ...base, method: "mobile_money", msisdn: "0772123456" });
    assert.equal(result.status, "PENDING");
    assert.equal(result.redirectUrl, "https://checkout.flutterwave.com/mm-step");
    assert.equal(result.nextAction?.type, "redirect");
    chargeResponse = { status: "success", data: { id: 7, status: "pending" } };
  });

  await t.test("airtel numbers go to Airtel", async () => {
    calls.length = 0;
    await flutterwaveAdapter.depositFunds({ ...base, method: "mobile_money", msisdn: "0752123456" });
    assert.equal(calls[0].body.network, "AIRTEL");
  });

  await t.test("with direct mobile money off, mobile money uses the hosted page limited to mobile money", async () => {
    await setFlutterwaveDirect("mobile_money", false);
    calls.length = 0;
    const result = await flutterwaveAdapter.depositFunds({ ...base, method: "mobile_money", msisdn: "0772123456" });
    assert.equal(calls[0].url, "/payments");
    assert.equal(calls[0].body.payment_options, "mobilemoneyuganda");
    assert.ok(result.redirectUrl);
    await setFlutterwaveDirect("mobile_money", true);
  });

  await t.test("a number on neither network falls back to the hosted page", async () => {
    calls.length = 0;
    await flutterwaveAdapter.depositFunds({ ...base, method: "mobile_money", msisdn: "0711000000" });
    assert.equal(calls[0].url, "/payments");
  });

  await t.test("cards use the hosted card page while direct card is off (the default)", async () => {
    calls.length = 0;
    const result = await flutterwaveAdapter.depositFunds({ ...base, method: "card", card });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/payments");
    assert.equal(calls[0].body.payment_options, "card");
    assert.ok(result.redirectUrl);
    assert.ok(!JSON.stringify(calls[0].body).includes(card.number), "card number must never reach the hosted call");
    const branding = calls[0].body.customizations as Record<string, string>;
    assert.equal(branding.title, "Peebee");
    assert.equal(branding.description, "test");
    assert.match(branding.logo, /^https?:\/\/.+\/icons\/icon-512\.png$/);
  });

  await t.test("direct card on but no encryption key still falls back to the hosted page", async () => {
    await setFlutterwaveDirect("card", true);
    calls.length = 0;
    await flutterwaveAdapter.depositFunds({ ...base, method: "card", card });
    assert.equal(calls[0].url, "/payments");
  });

  await t.test("a wrong-length encryption key is treated as missing and cards use the hosted page", async () => {
    process.env.FLUTTERWAVE_ENCRYPTION_KEY = "too-short";
    calls.length = 0;
    await flutterwaveAdapter.depositFunds({ ...base, method: "card", card });
    assert.equal(calls[0].url, "/payments");
  });

  await t.test("direct card sends the card encrypted and surfaces the PIN step", async () => {
    process.env.FLUTTERWAVE_ENCRYPTION_KEY = KEY;
    calls.length = 0;
    chargeResponse = { status: "success", data: { id: 1, flw_ref: "FLW-1", status: "pending" }, meta: { authorization: { mode: "pin" } } };
    const result = await flutterwaveAdapter.depositFunds({ ...base, method: "card", card, email: "a@b.co" });
    assert.equal(calls[0].url, "/charges?type=card");
    const raw = JSON.stringify(calls[0].body);
    assert.ok(!raw.includes(card.number), "card number must be encrypted on the wire");
    const payload = decrypt(String(calls[0].body.client));
    assert.equal(payload.card_number, card.number);
    assert.equal(payload.expiry_year, "99");
    assert.equal(payload.tx_ref, "pay_1");
    assert.deepEqual(result.nextAction, { type: "pin" });
    assert.equal(result.status, "PENDING");
  });

  await t.test("the PIN is sent as authorization on the second attempt", async () => {
    calls.length = 0;
    await flutterwaveAdapter.depositFunds({ ...base, method: "card", card, cardAuthorization: { mode: "pin", pin: "1234" } });
    assert.deepEqual(decrypt(String(calls[0].body.client)).authorization, { mode: "pin", pin: "1234" });
  });

  await t.test("a one-time code step carries the flow reference, and 3-D Secure becomes a redirect", async () => {
    chargeResponse = { status: "success", data: { flw_ref: "FLW-9", status: "pending" }, meta: { authorization: { mode: "otp", validate_instructions: "Enter the code" } } };
    const otp = await flutterwaveAdapter.depositFunds({ ...base, method: "card", card });
    assert.deepEqual(otp.nextAction, { type: "otp", flowRef: "FLW-9", message: "Enter the code" });

    calls.length = 0;
    await flutterwaveAdapter.submitCardOtp!({ flowRef: "FLW-9", otp: "123456", referenceId: "pay_1", createdAt: "" });
    assert.equal(calls[0].url, "/validate-charge");
    assert.deepEqual(calls[0].body, { otp: "123456", flw_ref: "FLW-9", type: "card" });

    chargeResponse = { status: "success", data: { flw_ref: "FLW-9", status: "pending" }, meta: { authorization: { mode: "redirect", redirect: "https://bank.example/3ds" } } };
    const redirect = await flutterwaveAdapter.depositFunds({ ...base, method: "card", card });
    assert.equal(redirect.redirectUrl, "https://bank.example/3ds");
    assert.equal(redirect.nextAction?.type, "redirect");
  });

  await t.test("turning direct card off again reverts to the hosted page immediately", async () => {
    await setFlutterwaveDirect("card", false);
    calls.length = 0;
    await flutterwaveAdapter.depositFunds({ ...base, method: "card", card });
    assert.equal(calls[0].url, "/payments");
  });
});

test("card payload encryption is Triple-DES ECB and rejects a wrong-size key", () => {
  assert.deepEqual(decrypt(encryptCardPayload({ a: 1 }, KEY)), { a: 1 });
  assert.throws(() => encryptCardPayload({}, "short"));
});

test("card validation catches typos before Flutterwave sees them", () => {
  assert.ok(cardSchema.safeParse(card).success);
  assert.ok(cardSchema.safeParse({ ...card, number: "4242 4242 4242 4242" }).success, "spaces are fine");
  assert.ok(!cardSchema.safeParse({ ...card, number: "4242424242424241" }).success, "bad checksum");
  assert.ok(!cardSchema.safeParse({ ...card, expiryYear: "2020" }).success, "expired");
  assert.ok(!cardSchema.safeParse({ ...card, cvv: "12" }).success, "short cvv");
});

test("pure-JS Triple-DES matches OpenSSL byte for byte (the Workers runtime has no des-ede3)", () => {
  for (const length of [0, 1, 7, 8, 9, 63, 200, 513]) {
    const key = randomBytes(24);
    const plain = randomBytes(length);
    const cipher = createCipheriv("des-ede3", key, null);
    const expected = Buffer.concat([cipher.update(plain), cipher.final()]);
    assert.equal(Buffer.from(tripleDesEcbEncrypt(plain, key)).toString("hex"), expected.toString("hex"), `length ${length}`);
  }
});

test("the encryption key must be exactly 24 characters when an admin saves it", () => {
  assert.match(credentialLengthError("flutterwave", { encryptionKey: "short" }) ?? "", /exactly 24 characters \(you entered 5\)/);
  assert.equal(credentialLengthError("flutterwave", { encryptionKey: KEY }), null);
  assert.equal(credentialLengthError("flutterwave", { encryptionKey: "  " }), null, "blank is left untouched, not rejected");
  assert.equal(credentialLengthError("flutterwave", { secretKey: "any length is fine" }), null);
});
