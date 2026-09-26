// Renders the Lumen app icon and splash (a red record dot inside a ring of dots, on black)
// into assets/, the sources that `npx capacitor-assets generate` turns into the Android and
// iOS icon and splash sets.
//   node scripts/make-icon-sources.mjs && npx capacitor-assets generate --android
import { mkdirSync } from 'node:fs';
import sharp from 'sharp';

const RED = '#D71921';

/** The mark, centred; scale 1 keeps it inside the adaptive-icon safe zone (66%). */
function mark(size, scale = 1) {
  const c = size / 2;
  const ring = size * 0.245 * scale;
  const dot = size * 0.012 * scale;
  const dots = Array.from({ length: 36 }, (_, i) => {
    const a = (i / 36) * Math.PI * 2;
    const x = (c + ring * Math.cos(a)).toFixed(1);
    const y = (c + ring * Math.sin(a)).toFixed(1);
    return `<circle cx="${x}" cy="${y}" r="${dot}" fill="#fff" fill-opacity="0.9"/>`;
  }).join('');
  return `${dots}<circle cx="${c}" cy="${c}" r="${size * 0.14 * scale}" fill="${RED}"/>`;
}

function svg(size, { background = true, scale = 1 } = {}) {
  const fill = background ? '<rect width="100%" height="100%" fill="#000"/>' : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${fill}${mark(size, scale)}</svg>`
  );
}

mkdirSync('assets', { recursive: true });
await sharp(svg(1024)).png().toFile('assets/icon-only.png');
await sharp(svg(1024, { background: false })).png().toFile('assets/icon-foreground.png');
await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#000000' } })
  .png()
  .toFile('assets/icon-background.png');
for (const name of ['splash', 'splash-dark']) {
  await sharp(svg(2732, { scale: 0.42 })).png().toFile(`assets/${name}.png`);
}
console.log('assets/: icon-only, icon-foreground, icon-background, splash, splash-dark');
