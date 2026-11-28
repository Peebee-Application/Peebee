import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { handleRequest } from '../src/worker.mjs';
import { COOKIE_NAME, SESSION_MARKER } from '../src/session.mjs';

// A browser talks to the real gateway, with only the upstream API stubbed.
const originalFetch = globalThis.fetch;
const secret = 'test.backend.credential';
globalThis.fetch = async (url, init) => {
  if (url.pathname === '/v1/auth/login') return Response.json({ token: secret, user: { id: 'test-customer' } });
  if (url.pathname === '/v1/auth/logout') return Response.json({ ok: true });
  return init.headers.get('authorization') === `Bearer ${secret}`
    ? Response.json({ authenticated: true }) : Response.json({ error: 'unauthorized' }, { status: 401 });
};
const server = createServer(async (req, res) => {
  try {
    const request = new Request(`http://localhost:${server.address().port}${req.url}`, { method: req.method, headers: req.headers });
    const response = await handleRequest(request, { ASSETS: { fetch: async () => new Response('<!doctype html><title>Session boundary test</title>', { headers: { 'Content-Type': 'text/html' } }) } });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('test gateway failed'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'] });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`http://localhost:${server.address().port}`);
  const login = await page.evaluate(async () => (await fetch('/api/v1/auth/login', { method: 'POST' })).json());
  assert.ok(login.token.startsWith(SESSION_MARKER + ':'));
  assert.doesNotMatch(JSON.stringify(login), /test.backend.credential/);
  assert.equal(await page.evaluate(() => document.cookie), '');
  const cookie = (await context.cookies()).find(c => c.name === COOKIE_NAME);
  assert.ok(cookie?.httpOnly && cookie?.secure);
  assert.equal(cookie.sameSite, 'Strict');
  const authenticated = await page.evaluate(async marker => (await fetch('/api/v1/wallet', { headers: { Authorization: `Bearer ${marker}` } })).json(), login.token);
  assert.equal(authenticated.authenticated, true);
  await page.evaluate(async marker => fetch('/api/v1/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${marker}` } }), login.token);
  assert.equal((await context.cookies()).filter(c => c.name === COOKIE_NAME).length, 0);
  const status = await page.evaluate(async marker => (await fetch('/api/v1/wallet', { headers: { Authorization: `Bearer ${marker}` } })).status, login.token);
  assert.equal(status, 401);
  console.log('PASS: real browser HttpOnly/Secure session, token redaction, cookie authentication and logout');
} finally {
  await browser.close(); server.close(); globalThis.fetch = originalFetch;
}
