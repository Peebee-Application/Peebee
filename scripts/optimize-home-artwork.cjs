// Run with SHARP_MODULE pointing to an installed sharp module.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.env.SHARP_MODULE || 'sharp');
const root = path.resolve(__dirname, '..');
const dir = path.join(root, 'packages/shared/home-artwork-assets');
const sources = process.env.ARTWORK_SOURCE_DIR || dir;
const used = ['address-book-tinted','book','clipboard','connector-full-v2','diary','fold-bands-only','note-gold','note-white','poster-bands-only','sorter-full','ticket-route','ticket'];
(async () => {
  const report = [];
  for (const name of used) {
    const input = path.join(sources, name + '.png');
    const output = path.join(dir, name + '.webp');
    const metadata = await sharp(input).metadata();
    // Up to 3x a 390px home viewport; never crop, stretch, or enlarge a source.
    const width = name.startsWith('note-') || name === 'ticket-route' ? 780 : 1170;
    await sharp(input).resize({ width, withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100, effort: 6 }).toFile(output);
    const result = await sharp(output).metadata();
    const before = await sharp(input).resize({ width, withoutEnlargement: true }).ensureAlpha().raw().toBuffer();
    const after = await sharp(output).ensureAlpha().raw().toBuffer();
    if (before.length !== after.length) throw new Error('Dimensions mismatch: ' + name);
    for (let pixel = 3; pixel < before.length; pixel += 4) if (before[pixel] !== after[pixel]) throw new Error('Alpha mismatch: ' + name);
    report.push({ name, sourceWidth: metadata.width, sourceHeight: metadata.height, width: result.width, height: result.height, pngBytes: fs.statSync(input).size, webpBytes: fs.statSync(output).size, alphaPreserved: true, quality: 90 });
  }
  fs.writeFileSync(path.join(root, 'docs/home-artwork-optimization.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
})().catch(error => { console.error(error); process.exitCode = 1; });
