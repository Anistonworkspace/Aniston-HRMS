#!/usr/bin/env node
/**
 * Applies Android plugin patches after npm install.
 *
 * Patches @capacitor-community/background-geolocation to:
 *  1. Survive force-close (android:stopWithTask="false" + START_STICKY)
 *  2. Post GPS directly to backend via HTTP when app is killed (no JS bridge)
 *  3. Expose credentials API so the JS side can pass authToken + backendUrl
 */

const fs = require('fs');
const path = require('path');

const PLUGIN_DIR = path.join(
  __dirname, '..', '..', 'node_modules',
  '@capacitor-community', 'background-geolocation', 'android'
);
const PATCH_DIR = path.join(__dirname, '..', 'patches', 'android');

const FILES = [
  'src/main/AndroidManifest.xml',
  'src/main/java/com/equimaps/capacitor_background_geolocation/BackgroundGeolocationService.java',
  'src/main/java/com/equimaps/capacitor_background_geolocation/BackgroundGeolocation.java',
];

let patched = 0;
let skipped = 0;

for (const file of FILES) {
  const src = path.join(PATCH_DIR, file);
  const dest = path.join(PLUGIN_DIR, file);

  if (!fs.existsSync(src)) {
    console.warn('[apply-android-patches] WARNING: patch source missing:', src);
    skipped++;
    continue;
  }
  if (!fs.existsSync(path.dirname(dest))) {
    console.warn('[apply-android-patches] WARNING: dest directory missing:', path.dirname(dest));
    skipped++;
    continue;
  }

  fs.copyFileSync(src, dest);
  console.log('[apply-android-patches] Patched:', file);
  patched++;
}

console.log('[apply-android-patches] Done —', patched, 'files patched,', skipped, 'skipped.');
