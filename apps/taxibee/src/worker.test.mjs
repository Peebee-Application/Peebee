import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from './worker.mjs';

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
