import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.mjs';
import { SESSION_MARKER, COOKIE_NAME, markerFor } from './session.mjs';

test('gateway preserves the Peebee token and response but drops cookies and caching', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.peebee.online/v1/taxipress/bookings/mine?fresh=1');
    assert.equal(init.headers.get('authorization'), 'Bearer test-customer-token');
    assert.equal(init.headers.get('cookie'), null);
    assert.equal(init.headers.get('x-untrusted'), null);
    return new Response(JSON.stringify({ bookings: [{ id: 'shared-booking' }] }), { status: 200, headers: { 'Set-Cookie': 'never-forward=this', 'Cache-Control': 'public' } });
  };
  try {
    const r = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/taxipress/bookings/mine?fresh=1', { headers: { Authorization: 'Bearer test-customer-token', Cookie: 'private-cookie', 'X-Untrusted': 'https://other.invalid' } }), {});
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { bookings: [{ id: 'shared-booking' }] });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.headers.get('set-cookie'), null);
  } finally { globalThis.fetch = oldFetch; }
});

test('booking writes retain method and body; upstream auth failures remain failures', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init.method, 'POST');
    assert.equal(await new Response(init.body).text(), '{"queueId":"q1","adults":2}');
    return new Response('{"error":"unauthorized"}', { status: 401 });
  };
  try {
    const r = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/taxipress/bookings', { method: 'POST', body: '{"queueId":"q1","adults":2}' }), {});
    assert.equal(r.status, 401);
    assert.deepEqual(await r.json(), { error: 'unauthorized' });
  } finally { globalThis.fetch = oldFetch; }
});

test('non-API requests use assets and cannot turn the gateway into an open proxy', async () => {
  let requested;
  const r = await handleRequest(new Request('https://taxibee.peebee.online/https://other.invalid'), { ASSETS: { fetch: async request => { requested = request.url; return new Response('asset', { status: 404 }); } } });
  assert.equal(requested, 'https://taxibee.peebee.online/https://other.invalid');
  assert.equal(r.status, 404);
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
});

test('upstream network errors produce a non-cacheable API error without internals', async () => {
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('private network details'); };
  try {
    const r = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/auth/me'), {});
    assert.equal(r.status, 502);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.doesNotMatch(await r.text(), /private network/);
  } finally { globalThis.fetch = oldFetch; }
});

test('support capability is forwarded only to the fixed support-chat endpoint', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => { seen.push({ url: String(url), secret: init.headers.get('x-chat-secret'), cookie: init.headers.get('cookie') }); return Response.json({ ok: true }); };
  try {
    for (const path of ['/api/v1/support-chat/session/messages', '/api/v1/wallet']) {
      await handleRequest(new Request('https://taxibee.peebee.online' + path, { headers: { 'X-Chat-Secret': 'support-test-capability', Cookie: 'private=1' } }), {});
    }
    assert.deepEqual(seen, [
      { url: 'https://api.peebee.online/v1/support-chat/session/messages', secret: 'support-test-capability', cookie: null },
      { url: 'https://api.peebee.online/v1/wallet', secret: null, cookie: null },
    ]);
  } finally { globalThis.fetch = original; }
});

test('sign-in conceals the backend token in a host-only Secure HttpOnly cookie', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ token: 'test.backend.secret', user: { id: 'customer-a' } });
  try {
    const r = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/auth/login', { method: 'POST', headers: { Origin: 'https://taxibee.peebee.online' } }), {});
    assert.equal((await r.json()).token, await markerFor('test.backend.secret'));
    const cookie = r.headers.get('set-cookie');
    assert.match(cookie, new RegExp(`^${COOKIE_NAME}=`));
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Strict', 'Path=/']) assert.ok(cookie.includes(flag));
    assert.doesNotMatch(cookie, /Domain=/i);
  } finally { globalThis.fetch = old; }
});

test('cookie credential is substituted only for the public marker; missing cookie cannot authenticate', async () => {
  const old = globalThis.fetch, seen = [];
  globalThis.fetch = async (_u, init) => { seen.push(init.headers.get('authorization')); return Response.json({ ok: true }); };
  try {
    for (const headers of [
      { Authorization: `Bearer ${await markerFor("test.backend.secret")}`, Cookie: `${COOKIE_NAME}=test.backend.secret` },
      { Authorization: `Bearer ${await markerFor("test.backend.secret")}` },
      { Cookie: `${COOKIE_NAME}=test.backend.secret` },
    ]) await handleRequest(new Request('https://taxibee.peebee.online/api/v1/wallet', { headers }), {});
    assert.deepEqual(seen, ['Bearer test.backend.secret', null, null]);
  } finally { globalThis.fetch = old; }
});

test('cross-origin and missing-origin cookie writes never reach Peebee', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Upstream must not be called'); };
  try {
    for (const origin of [null, 'https://attacker.invalid', 'https://evil.peebee.online']) {
      const headers = { Cookie: `${COOKIE_NAME}=test.backend.secret`, Authorization: `Bearer ${await markerFor("test.backend.secret")}` };
      if (origin) headers.Origin = origin;
      const r = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/wallet/transfer', { method: 'POST', headers }), {});
      assert.equal(r.status, 403);
    }
  } finally { globalThis.fetch = old; }
});

test('logout clears cookie; authenticated legacy sessions can migrate; upstream origins are restricted', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ user: { id: 'a' } });
  try {
    const migrated = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/auth/me', { headers: { Authorization: 'Bearer legacy.jwt.token' } }), {});
    assert.match(migrated.headers.get('set-cookie'), /legacy.jwt.token/);
    const logout = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/auth/logout', { method: 'POST' }), {});
    assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
    const invalid = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/wallet'), { API_ORIGIN: 'https://attacker.invalid' });
    assert.equal(invalid.status, 503);
    assert.equal(migrated.headers.get('strict-transport-security'), 'max-age=31536000');
  } finally { globalThis.fetch = old; }
});

test('abuse attribution uses the Cloudflare edge field, not a supplied forwarding chain', async () => {
  const old = globalThis.fetch, seen = [];
  globalThis.fetch = async (_url, init) => { seen.push(init.headers.get('x-real-ip')); return Response.json({ ok: true }); };
  try {
    for (const headers of [
      { 'CF-Connecting-IP': '2001:db8::1', 'X-Real-IP': '203.0.113.99' },
      { 'X-Real-IP': '203.0.113.99', 'X-Forwarded-For': '203.0.113.98' },
    ]) await handleRequest(new Request('https://taxibee.peebee.online/api/v1/auth/me', { headers }), {});
    assert.deepEqual(seen, ['2001:db8::1', null]);
  } finally { globalThis.fetch = old; }
});

test('a stale session marker cannot authorize a write using a newer account cookie', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('Must reject before forwarding'); };
  try {
    const r = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/wallet/transfer', { method: 'POST', headers: {
      Origin: 'https://taxibee.peebee.online', Cookie: `${COOKIE_NAME}=new.account.token`, Authorization: `Bearer ${await markerFor('old.account.token')}`,
    } }), {});
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null, 'Do not erase the newer session');
  } finally { globalThis.fetch = old; }
});

test('a GET without the session marker cannot erase a valid browser session', async () => {
  const old = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ error: 'unauthorized' }, { status: 401 });
  try {
    const r = await handleRequest(new Request('https://taxibee.peebee.online/api/v1/wallet', { headers: { Cookie: `${COOKIE_NAME}=existing.jwt.token` } }), {});
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null);
  } finally { globalThis.fetch = old; }
});

test('non-local HTTP traffic redirects to TLS before serving assets or forwarding credentials', async () => {
  const r = await handleRequest(new Request('http://taxibee.peebee.online/api/v1/auth/login', { method: 'POST' }), {});
  assert.equal(r.status, 308);
  assert.equal(r.headers.get('location'), 'https://taxibee.peebee.online/api/v1/auth/login');
});
