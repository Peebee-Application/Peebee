// Mechanical raster exports of the supplied SVG. Pass a real sharp module path
// when the workspace uses its deployment-only sharp stub.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const source = fs.readFileSync(path.join(__dirname, 'logo.svg'), 'utf8');
async function main() {
  for (const [theme, ink] of [['light', '#0b0b0b'], ['dark', '#ffffff']]) {
    // Raster SVG renderers do not implement browser CSS custom properties.
    // Resolve only the supplied default gold palette and ink; preserve geometry.
    const svg = source.replace(/<style>[\s\S]*?<\/style>/, '')
      .replace(/class="ink-stroke"/g, `stroke="${ink}" fill="none" stroke-linecap="round" stroke-linejoin="round"`)
      .replace(/class="ink-fill"/g, `fill="${ink}"`)
      .replace(/var\(--accent-1, #FFDF5E\)/g, '#FFDF5E')
      .replace(/var\(--accent-2, #E4A323\)/g, '#E4A323')
      .replace(/var\(--accent-3, #B96C05\)/g, '#B96C05');
    await sharp(Buffer.from(svg)).png().toFile(path.join(__dirname, `logo-${theme}.png`));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
