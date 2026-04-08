/**
 * Generates placeholder PWA assets:
 *   - frontend/public/screenshots/*.png  (1080x1920 mobile, 1280x800 desktop)
 *   - frontend/public/apple-splash/*.png (all iOS/iPadOS sizes)
 *
 * These are PLACEHOLDER files — replace them with real app screenshots
 * before submitting to Play Store / App Store.
 *
 * Usage: node frontend/scripts/generate-pwa-assets.mjs
 * Requires: Node.js 18+ (uses built-in Buffer + zlib)
 */

import { createWriteStream, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Brand colors
const BG_COLOR   = [248, 250, 252]; // #f8fafc
const LOGO_COLOR = [79, 70, 229];   // #4F46E5 (indigo-600)
const TEXT_COLOR = [100, 116, 139]; // #64748b

// ──────────────────────────────────────────────────────────────────────────────
// Minimal PNG writer (pure Node.js, no deps)
// ──────────────────────────────────────────────────────────────────────────────

function uint32BE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n, 0);
  return b;
}

function chunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = uint32BE(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = uint32BE(crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crc]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPNG(width, height, label) {
  const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width,  0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8;  // bit depth
  ihdrData[9] = 2;  // color type RGB
  const IHDR = chunk('IHDR', ihdrData);

  // Build raw scanlines: filter byte (0) + RGB pixels
  const scanlineSize = 1 + width * 3;
  const raw = Buffer.alloc(height * scanlineSize, 0);

  for (let y = 0; y < height; y++) {
    const base = y * scanlineSize;
    raw[base] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const px = base + 1 + x * 3;

      // Gradient background: top #eef2ff → bottom #f8fafc
      const t = y / height;
      const r = Math.round(238 + (BG_COLOR[0] - 238) * t);
      const g = Math.round(242 + (BG_COLOR[1] - 242) * t);
      const b_val = Math.round(255 + (BG_COLOR[2] - 255) * t);

      // Center square logo block
      const cx = width  / 2;
      const cy = height / 2;
      const boxW = Math.min(width, height) * 0.25;
      const boxH = boxW;

      if (
        x >= cx - boxW / 2 && x < cx + boxW / 2 &&
        y >= cy - boxH / 2 && y < cy + boxH / 2
      ) {
        // Logo block
        const innerPad = boxW * 0.12;
        if (
          x >= cx - boxW / 2 + innerPad && x < cx + boxW / 2 - innerPad &&
          y >= cy - boxH / 2 + innerPad && y < cy + boxH / 2 - innerPad
        ) {
          raw[px]     = LOGO_COLOR[0];
          raw[px + 1] = LOGO_COLOR[1];
          raw[px + 2] = LOGO_COLOR[2];
        } else {
          // Rounded border tint
          raw[px]     = 224;
          raw[px + 1] = 231;
          raw[px + 2] = 255; // indigo-100
        }
      } else {
        raw[px]     = r;
        raw[px + 1] = g;
        raw[px + 2] = b_val;
      }
    }
  }

  const compressed = zlib.deflateSync(raw, { level: 6 });
  const IDAT = chunk('IDAT', compressed);
  const IEND = chunk('IEND', Buffer.alloc(0));

  return Buffer.concat([PNG_SIG, IHDR, IDAT, IEND]);
}

function writePNG(filePath, width, height, label) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const data = buildPNG(width, height, label);
  const ws = createWriteStream(filePath);
  ws.write(data);
  ws.end();
  console.log(`  ✓ ${filePath.replace(ROOT, '.')}  (${width}×${height})`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Screenshots
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n📸  Generating screenshots…');
const screenshotsDir = join(ROOT, 'public', 'screenshots');

const screenshots = [
  ['mobile-dashboard.png',  1080, 1920, 'Dashboard'],
  ['mobile-attendance.png', 1080, 1920, 'Attendance'],
  ['mobile-leave.png',      1080, 1920, 'Leave'],
  ['desktop-dashboard.png', 1280,  800, 'Desktop Dashboard'],
  ['desktop-payroll.png',   1280,  800, 'Desktop Payroll'],
];

for (const [name, w, h, label] of screenshots) {
  writePNG(join(screenshotsDir, name), w, h, label);
}

// ──────────────────────────────────────────────────────────────────────────────
// Apple Splash Screens
// ──────────────────────────────────────────────────────────────────────────────
console.log('\n🍎  Generating Apple splash screens…');
const splashDir = join(ROOT, 'public', 'apple-splash');

const splashes = [
  ['splash-640x1136.png',   640,  1136],
  ['splash-750x1334.png',   750,  1334],
  ['splash-1242x2208.png', 1242,  2208],
  ['splash-1125x2436.png', 1125,  2436],
  ['splash-828x1792.png',   828,  1792],
  ['splash-1242x2688.png', 1242,  2688],
  ['splash-1170x2532.png', 1170,  2532],
  ['splash-1284x2778.png', 1284,  2778],
  ['splash-1179x2556.png', 1179,  2556],
  ['splash-1290x2796.png', 1290,  2796],
  ['splash-1488x2266.png', 1488,  2266],
  ['splash-1640x2360.png', 1640,  2360],
  ['splash-1668x2388.png', 1668,  2388],
  ['splash-2048x2732.png', 2048,  2732],
];

for (const [name, w, h] of splashes) {
  writePNG(join(splashDir, name), w, h, 'Splash');
}

console.log(`\n✅  Done! Replace placeholder files with real app screenshots before store submission.\n`);
