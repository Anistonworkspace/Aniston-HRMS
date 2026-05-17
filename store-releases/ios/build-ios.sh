#!/usr/bin/env bash
#
# Build Aniston HRMS -> signed .ipa for App Store submission
# Run this script on macOS with Xcode installed.
#
# Prerequisites:
#   1. macOS with Xcode 15+ installed
#   2. Apple Developer account with App Store Connect access
#   3. Provisioning profile "Aniston HRMS App Store Distribution" installed in Xcode
#   4. Distribution certificate installed in Keychain
#   5. Fill in TEAM_ID below (or set APPLE_TEAM_ID env var)
#   6. Run: npm install (in repo root) before first build
#
# Output:
#   store-releases/ios/aniston-hrms-v1.6.0.ipa   (App Store submission)
#
# Usage:
#   cd store-releases/ios
#   chmod +x build-ios.sh
#   ./build-ios.sh
#   # or with team ID inline:
#   APPLE_TEAM_ID=ABCDE12345 ./build-ios.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
FRONTEND_DIR="$ROOT/frontend"
IOS_DIR="$FRONTEND_DIR/ios"
SCHEME="App"
WORKSPACE="$IOS_DIR/App/App.xcworkspace"
ARCHIVE_PATH="$SCRIPT_DIR/Aniston-HRMS.xcarchive"
EXPORT_PATH="$SCRIPT_DIR/ipa-export"
EXPORT_OPTIONS="$SCRIPT_DIR/ExportOptions.plist"
VERSION="1.6.0"
DEST_IPA="$SCRIPT_DIR/aniston-hrms-v${VERSION}.ipa"

# ── Team ID ──────────────────────────────────────────────────────────────────
TEAM_ID="${APPLE_TEAM_ID:-}"
if [ -z "$TEAM_ID" ]; then
    echo "ERROR: Set APPLE_TEAM_ID environment variable or edit this script."
    echo "       Find your Team ID at https://developer.apple.com/account -> Membership"
    exit 1
fi

echo ""
echo "================================================="
echo "  Aniston HRMS  --  iOS IPA Build"
echo "================================================="

# ── Step 1: Set JAVA_HOME (needed by Capacitor CLI) ──────────────────────────
# On macOS, use Homebrew OpenJDK or Android Studio's bundled JDK
if [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
elif command -v java &>/dev/null; then
    export JAVA_HOME="$(/usr/libexec/java_home 2>/dev/null || echo '')"
fi
echo "[prereq] JAVA_HOME = ${JAVA_HOME:-not set}"

# ── Step 2: Ensure iOS platform is initialised ───────────────────────────────
if [ ! -d "$IOS_DIR" ]; then
    echo "[1/5] Initialising Capacitor iOS project (first time only)..."
    cd "$FRONTEND_DIR"
    npx cap add ios
else
    echo "[1/5] iOS project already initialised — skipping cap add ios"
fi

# ── Step 3: Build frontend ───────────────────────────────────────────────────
echo ""
echo "[2/5] Building frontend..."
cd "$ROOT"
npm run build --workspace=frontend

# ── Step 4: Sync Capacitor assets to iOS ─────────────────────────────────────
echo ""
echo "[3/5] Syncing Capacitor assets to ios..."
cd "$FRONTEND_DIR"
npx cap sync ios

# ── Step 5: Install CocoaPods dependencies ───────────────────────────────────
echo ""
echo "[4/5] Installing CocoaPods..."
cd "$IOS_DIR/App"
pod install --repo-update

# ── Step 6: Archive (code-sign with Distribution cert) ───────────────────────
echo ""
echo "[5/5] Archiving with xcodebuild..."
cd "$IOS_DIR"

# Patch ExportOptions.plist with the actual team ID
sed "s/YOUR_TEAM_ID_HERE/$TEAM_ID/g" "$EXPORT_OPTIONS" > /tmp/ExportOptions-patched.plist

xcodebuild archive \
    -workspace "$WORKSPACE" \
    -scheme "$SCHEME" \
    -configuration Release \
    -archivePath "$ARCHIVE_PATH" \
    -destination "generic/platform=iOS" \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE="Manual" \
    PROVISIONING_PROFILE_SPECIFIER="Aniston HRMS App Store Distribution" \
    | xcpretty --color || true   # xcpretty is optional — falls back to raw output

# ── Step 7: Export IPA ───────────────────────────────────────────────────────
xcodebuild -exportArchive \
    -archivePath "$ARCHIVE_PATH" \
    -exportOptionsPlist /tmp/ExportOptions-patched.plist \
    -exportPath "$EXPORT_PATH"

# ── Step 8: Copy IPA to store-releases/ios/ ──────────────────────────────────
IPA_BUILT=$(find "$EXPORT_PATH" -name "*.ipa" | head -1)
if [ -z "$IPA_BUILT" ]; then
    echo "ERROR: IPA not found in export path: $EXPORT_PATH"
    exit 1
fi

cp "$IPA_BUILT" "$DEST_IPA"
IPA_MB=$(du -m "$DEST_IPA" | cut -f1)
echo ""
echo "  IPA: $DEST_IPA (${IPA_MB} MB)"

# ── Cleanup ───────────────────────────────────────────────────────────────────
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH" /tmp/ExportOptions-patched.plist

echo ""
echo "================================================="
echo "  BUILD SUCCESSFUL  --  v${VERSION}"
echo "================================================="
echo ""
echo "  Upload IPA to App Store Connect:"
echo "  https://appstoreconnect.apple.com"
echo "  Use Transporter app or: xcrun altool --upload-app -f $DEST_IPA"
echo ""
