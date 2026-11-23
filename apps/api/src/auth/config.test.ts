import test from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { authRoutes } from './routes.js';

test('public sign-in configuration exposes only the OAuth client ID', async () => {
  const previous = process.env.GOOGLE_CLIENT_ID;
  try {
    process.env.GOOGLE_CLIENT_ID = 'public-test-client';
    const app = new Hono().route('/v1/auth', authRoutes);
    const response = await app.request('/v1/auth/config');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { googleClientId: 'public-test-client' });
    delete process.env.GOOGLE_CLIENT_ID;
    assert.deepEqual(await (await app.request('/v1/auth/config')).json(), { googleClientId: null });
  } finally { if (previous == null) delete process.env.GOOGLE_CLIENT_ID; else process.env.GOOGLE_CLIENT_ID = previous; }
});
