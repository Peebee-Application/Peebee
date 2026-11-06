import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../apps/customer/public/sw.js', import.meta.url), 'utf8');
function environment() {
  const stored = new Map();
  const fetched = [];
  const css = '/_next/static/css/home.css';
  stored.set(css, new Response('a{background:url(../media/book.webp)} b{background:url("https://other.test/image.webp")} c{background:url(../media/missing.webp)} d{background:url(../media/note.webp)}', { headers: { 'content-type': 'text/css' } }));
  const context = vm.createContext({ URL, Response, console, setTimeout,
    self: { location: new URL('https://app.peebee.online'), addEventListener() {} },
    caches: { open: async () => ({ match: async url => stored.get(String(url))?.clone(), put: async (url, response) => stored.set(String(url), response) }) },
    fetch: async url => { fetched.push(String(url)); if (String(url).includes('missing')) throw Error('offline'); return new Response('image'); },
  });
  vm.runInContext(source, context);
  return { context, stored, fetched, css };
}
test('cached CSS warms same-origin artwork and tolerates individual failures', async () => {
  const env = environment();
  await vm.runInContext(`precacheAssets(['${env.css}'])`, env.context);
  assert.ok(env.stored.has('https://app.peebee.online/_next/static/media/book.webp'));
  assert.ok(env.stored.has('https://app.peebee.online/_next/static/media/note.webp'));
  assert.ok(!env.fetched.some(url => url.includes('other.test')));
  const before = env.fetched.filter(url => url.includes('book.webp')).length;
  await vm.runInContext(`precacheAssets(['${env.css}'])`, env.context);
  assert.equal(env.fetched.filter(url => url.includes('book.webp')).length, before, 'cached image is not downloaded twice');
});

test('page response does not wait for background artwork downloads', async () => {
  const env = environment();
  let finish;
  const download = new Promise(resolve => { finish = resolve; });
  env.context.fetch = async () => { await download; return new Response('image'); };
  const background = [];
  env.context.pageResponse = new Response(`<link href="${env.css}">`, { headers: { 'content-type': 'text/html' } });
  env.context.pageEvent = { waitUntil: promise => background.push(promise) };
  try {
    await Promise.race([
      vm.runInContext("storePage('/', pageResponse, pageEvent)", env.context),
      new Promise((_, reject) => setTimeout(() => reject(Error('page blocked on images')), 1000)),
    ]);
    assert.equal(background.length, 1);
    assert.ok(env.stored.has('/'));
  } finally {
    finish();
    await Promise.all(background);
  }
});
