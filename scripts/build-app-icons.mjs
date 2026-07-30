// Build the site's icons from the one drawn mark: the browser favicon and the
// Workshop's home-screen app icons (docs/admin.md §1, docs/plans/09 Piece 4).
//
// The mark is defined ONCE, in src/lib/star-mark.ts, and this script reads the
// path out of that file rather than keeping a second copy — so if the star is
// ever redrawn, re-run this and every icon follows. (Read-and-regex rather than
// `import`, to avoid needing a TypeScript loader for one string constant.)
//
// Until 2026-07-30 all of these were Astro's default logo, shipped untouched
// since the project was scaffolded.
//
// Why the app icons can't just BE the favicon: an app icon is composited by the
// OS onto a home screen, so it must be OPAQUE and carry its own surface, and
// Android masks it to a circle/squircle, so the mark must sit inside the central
// safe zone. Both are handled here — the dusk surface is baked in and the star
// is scaled to ~62% of the canvas, which clears the 80% safe zone, so one
// artwork serves `purpose: "any maskable"` instead of needing two.
//
//   node scripts/build-app-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = new URL('..', import.meta.url).pathname;
const PUBLIC = path.join(ROOT, 'public');

// app.css owns the source of truth for colour; these are its oklch() tokens
// converted to sRGB (oklch is fine in CSS, but a manifest and a rasterizer both
// want plain hex).
const SURFACE = { r: 26, g: 21, b: 17, alpha: 1 }; //  #1a1511  dusk  --color-base-100
const LAMPLIGHT = '#e1a35c'; //                                dusk  --color-primary
const LAMPLIGHT_ON_PAPER = '#a26425'; //                       paper --color-primary
const MARK_SCALE = 0.62; // share of an app-icon canvas the star occupies

const src = fs.readFileSync(path.join(ROOT, 'src/lib/star-mark.ts'), 'utf8');
const d = src.match(/STAR_PATH = '([^']+)'/)?.[1];
const viewBox = src.match(/STAR_VIEWBOX = '([^']+)'/)?.[1];
if (!d || !viewBox) throw new Error('Could not read STAR_PATH/STAR_VIEWBOX from src/lib/star-mark.ts');

const star = (fill, px) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${px}" height="${px}" fill="none"><path d="${d}" fill="${fill}"/></svg>`;

// ---- the favicon: the mark itself, taking each theme's lamplight ------------
// Same technique as the file it replaces: one SVG that answers the BROWSER's
// colour scheme (a tab strip is chrome, not our page, so it can't inherit our
// theme). Each scheme gets that theme's own --color-primary, which is why the
// light one is deeper — amber that reads on white.
fs.writeFileSync(
  path.join(PUBLIC, 'favicon.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none">
    <path d="${d}" />
    <style>
        path { fill: ${LAMPLIGHT_ON_PAPER}; }
        @media (prefers-color-scheme: dark) {
            path { fill: ${LAMPLIGHT}; }
        }
    </style>
</svg>
`,
);
console.log('✓ public/favicon.svg');

// ---- favicon.ico: for anything that probes /favicon.ico by convention ------
// A single 32×32 PNG in an ICO container — valid, and what every current
// browser reads. Written by hand because sharp has no .ico encoder.
const ico32 = await sharp(Buffer.from(star(LAMPLIGHT, 32))).png({ compressionLevel: 9 }).toBuffer();
const dir = Buffer.alloc(22);
dir.writeUInt16LE(0, 0); // reserved
dir.writeUInt16LE(1, 2); // type: icon
dir.writeUInt16LE(1, 4); // one image
dir.writeUInt8(32, 6); // width
dir.writeUInt8(32, 7); // height
dir.writeUInt8(0, 8); // palette: not indexed
dir.writeUInt8(0, 9); // reserved
dir.writeUInt16LE(1, 10); // colour planes
dir.writeUInt16LE(32, 12); // bits per pixel
dir.writeUInt32LE(ico32.length, 14);
dir.writeUInt32LE(22, 18); // payload offset
fs.writeFileSync(path.join(PUBLIC, 'favicon.ico'), Buffer.concat([dir, ico32]));
console.log('✓ public/favicon.ico');

// ---- the Workshop's app icons ----------------------------------------------
// Rendered large then TRIMMED to the mark's true bounding box before centring:
// the star's reach is deliberately uneven, so centring its viewBox would leave
// it visibly off-centre inside the OS mask.
const glyph = await sharp(Buffer.from(star(LAMPLIGHT, 1024))).trim({ threshold: 1 }).png().toBuffer();

const icons = [
  { file: 'icons/workshop-192.png', size: 192 },
  { file: 'icons/workshop-512.png', size: 512 },
  // iOS takes its home-screen icon from <link rel="apple-touch-icon">, never
  // the manifest, and adds no padding of its own — same artwork, its own size.
  { file: 'icons/apple-touch-icon.png', size: 180 },
];

fs.mkdirSync(path.join(PUBLIC, 'icons'), { recursive: true });
for (const { file, size } of icons) {
  const inner = Math.round(size * MARK_SCALE);
  const fitted = await sharp(glyph)
    .resize({ width: inner, height: inner, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  await sharp({ create: { width: size, height: size, channels: 4, background: SURFACE } })
    .composite([{ input: fitted, gravity: 'center' }])
    .png({ compressionLevel: 9 })
    .toFile(path.join(PUBLIC, file));
  console.log(`✓ public/${file}  ${size}×${size}`);
}
