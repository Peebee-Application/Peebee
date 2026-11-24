import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { buildHeader } from './build-header.mjs';
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
// Reuse the Customer app's actual account styling and existing assets.
await cp('../customer/app/account-auth.css', 'dist/customer-auth.css');
await mkdir('dist/brand', { recursive: true });
for (const name of ['peebee-logo-light.svg', 'peebee-logo-dark.svg', 'auth-illustration.webp']) {
  await cp(`../customer/public/brand/${name}`, `dist/brand/${name}`);
}
const require = createRequire(import.meta.url);
await mkdir('dist/vendor', { recursive: true });
const leafletRoot = new URL('./', pathToFileURL(require.resolve('leaflet/package.json')));
await cp(new URL('dist/images/', leafletRoot), 'dist/images', { recursive: true });
await cp(new URL('dist/images/', leafletRoot), 'dist/vendor/images', { recursive: true });
for (const [pkg, file, out] of [
  ['lucide', 'dist/umd/lucide.js', 'lucide.js'],
  ['leaflet', 'dist/leaflet.js', 'leaflet.js'],
  ['jsbarcode', 'dist/JsBarcode.all.min.js', 'barcode.js'],
]) {
  const root = new URL('./', pathToFileURL(require.resolve(`${pkg}/package.json`)));
  await cp(new URL(file, root), `dist/vendor/${out}`);
}
let html = await readFile('dist/index.html', 'utf8');
html = html.replace(/<script defer src="https:\/\/unpkg.com\/lucide[^>]*><\/script>/, '<script defer src="vendor/lucide.js"></script>')
  .replace(/<script defer src="https:\/\/unpkg.com\/leaflet[^>]*><\/script>/, '<script defer src="vendor/leaflet.js"></script>')
  .replace(/<script defer src="https:\/\/cdn.jsdelivr.net\/npm\/qrcodejs[^>]*><\/script>/, '')
  .replace(/<script defer src="https:\/\/cdn.jsdelivr.net\/npm\/jsbarcode[^>]*><\/script>/, '<script defer src="vendor/barcode.js"></script>');
await writeFile('dist/index.html', html);
await build({ entryPoints: ['src/live.ts'], bundle: true, outfile: 'dist/live.js', format: 'iife', target: 'es2022', sourcemap: false, minify: true });
await buildHeader();
console.log('Taxibee built: Fly Express interface, Peebee API adapter, independent Worker.');
