// Renders apps/desktop/build/icon.svg into the PNG/ICO assets used by electron-builder,
// the Linux window icon and the renderer favicon. Outputs are committed; re-run after
// changing the SVG:  node scripts/generate-icons.mjs

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';

const buildDir = join('apps', 'desktop', 'build');
const iconsDir = join(buildDir, 'icons');
const uiPublic = join('apps', 'ui', 'public');
const svg = readFileSync(join(buildDir, 'icon.svg'));

const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function render(size) {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

/** ICO container with embedded PNG images (supported since Windows Vista). */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);

  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 = 256)
    entry.writeUInt8(size >= 256 ? 0 : size, 1); // height
    entry.writeUInt8(0, 2); // palette size
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += png.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

mkdirSync(iconsDir, { recursive: true });
const rendered = new Map(SIZES.map((size) => [size, render(size)]));
for (const [size, png] of rendered) {
  writeFileSync(join(iconsDir, `${size}x${size}.png`), png);
}
writeFileSync(join(buildDir, 'icon.png'), rendered.get(512));
const ico = encodeIco(ICO_SIZES.map((size) => ({ size, png: rendered.get(size) })));
writeFileSync(join(buildDir, 'icon.ico'), ico);

writeFileSync(
  join(uiPublic, 'favicon.ico'),
  encodeIco([16, 32, 48].map((size) => ({ size, png: rendered.get(size) }))),
);
copyFileSync(join(buildDir, 'icon.svg'), join(uiPublic, 'icon.svg'));

console.log(`Generated ${SIZES.length} PNG sizes, icon.ico and the UI favicon/icon.svg.`);
