import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import app from "./app.js";

test("production CORS accepts configured Peebee apps and rejects unrelated origins", async () => {
  const previousEnvironment = process.env.ENVIRONMENT;
  const previousOrigins = process.env.CORS_ORIGINS;
  const config = JSON.parse(readFileSync("wrangler.jsonc", "utf8").replace(/^\s*\/\/.*$/gm, ""));
  process.env.ENVIRONMENT = "production";
  process.env.CORS_ORIGINS = config.vars.CORS_ORIGINS;
  try {
    for (const origin of config.vars.CORS_ORIGINS.split(",")) {
      const response = await app.request("/health", { headers: { Origin: origin } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("access-control-allow-origin"), origin);
      const preflight = await app.request("/v1/auth/login", {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "Content-Type, Authorization",
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get("access-control-allow-origin"), origin);
    }
    for (const origin of [
      "https://customer.tumaffe.online",
      "https://tuma-customer.doxalight-inc.workers.dev",
      "https://customer.peebee.online.attacker.example",
      "https://unconfigured.peebee.online",
      "http://localhost:3000",
    ]) {
      const response = await app.request("/health", { headers: { Origin: origin } });
      assert.equal(response.headers.get("access-control-allow-origin"), null, origin);
    }
    process.env.CORS_ORIGINS = "http://localhost:3000";
    const production = await app.request("/health", { headers: { Origin: "http://localhost:3000" } });
    assert.equal(production.headers.get("access-control-allow-origin"), null);
    process.env.ENVIRONMENT = "development";
    const development = await app.request("/health", { headers: { Origin: "http://localhost:3000" } });
    assert.equal(development.headers.get("access-control-allow-origin"), "http://localhost:3000");
  } finally {
    if (previousEnvironment === undefined) delete process.env.ENVIRONMENT;
    else process.env.ENVIRONMENT = previousEnvironment;
    if (previousOrigins === undefined) delete process.env.CORS_ORIGINS;
    else process.env.CORS_ORIGINS = previousOrigins;
  }
});
