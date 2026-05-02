#!/usr/bin/env node
/**
 * Generates Android mipmap icons from the existing PWA icon-512.png
 * Uses sharp (already a devDependency) — no extra installs needed.
 */
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const SOURCE = path.join(__dirname, '../public/icon-512.png');
const ANDROID_RES = path.join(__dirname, '../android/app/src/main/res');

const SIZES = [
  { folder: 'mipmap-mdpi',    size: 48  },
  { folder: 'mipmap-hdpi',    size: 72  },
  { folder: 'mipmap-xhdpi',   size: 96  },
  { folder: 'mipmap-xxhdpi',  size: 144 },
  { folder: 'mipmap-xxxhdpi', size: 192 },
];

const FOREGROUND_SIZES = [
  { folder: 'mipmap-mdpi',    size: 81  },
  { folder: 'mipmap-hdpi',    size: 108 },
  { folder: 'mipmap-xhdpi',   size: 162 },
  { folder: 'mipmap-xxhdpi',  size: 243 },
  { folder: 'mipmap-xxxhdpi', size: 324 },
];

async function run() {
  if (!fs.existsSync(SOURCE)) {
    console.error('❌ Source icon not found:', SOURCE);
    process.exit(1);
  }
  console.log('📱 Generating Android icons from', SOURCE);

  for (const { folder, size } of SIZES) {
    const dir = path.join(ANDROID_RES, folder);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    // ic_launcher.png — square icon
    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(path.join(dir, 'ic_launcher.png'));

    // ic_launcher_round.png — same but circular clip
    await sharp(SOURCE)
      .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .png()
      .toFile(path.join(dir, 'ic_launcher_round.png'));

    console.log(`  ✅ ${folder}: ${size}x${size}`);
  }

  // ic_launcher_foreground.png for adaptive icons (anydpi-v26)
  for (const { folder, size } of FOREGROUND_SIZES) {
    const dir = path.join(ANDROID_RES, folder);
    const iconSize = Math.round(size * 0.67); // icon takes center 67% of foreground
    const padding = Math.round((size - iconSize) / 2);

    await sharp(SOURCE)
      .resize(iconSize, iconSize, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .extend({ top: padding, bottom: padding, left: padding, right: padding, background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
  console.log('  ✅ ic_launcher_foreground.png generated for all densities');

  console.log('\n🎉 All Android icons generated successfully!');
  console.log('   Now rebuild the APK/AAB to include the new icons.');
}

run().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
