# iOS IPA Publish Checklist — Aniston HRMS v1.6.0

## Prerequisites (one-time setup)
- [ ] macOS machine with Xcode 15 or newer installed
- [ ] Apple Developer Program membership (paid, $99/year)
- [ ] Distribution certificate in Keychain (download from developer.apple.com)
- [ ] Provisioning profile created: **"Aniston HRMS App Store Distribution"**
  - App ID: `com.anistonav.hr.twa`
  - Type: App Store Distribution
  - Download and double-click to install in Xcode
- [ ] Fill in `APPLE_TEAM_ID` — 10-character alphanumeric, found at developer.apple.com → Account → Membership
- [ ] Update `ExportOptions.plist` — replace `YOUR_TEAM_ID_HERE` with your actual Team ID
- [ ] Install CocoaPods: `sudo gem install cocoapods`
- [ ] Install xcpretty (optional, nicer output): `gem install xcpretty`

## Build Steps (macOS only)
```bash
# Clone / pull repo on your Mac
git pull origin main

# Set your Apple Team ID
export APPLE_TEAM_ID=ABCDE12345   # replace with your real Team ID

# Run the build script
cd store-releases/ios
chmod +x build-ios.sh
./build-ios.sh
```

Output: `store-releases/ios/aniston-hrms-v1.6.0.ipa`

## App Store Connect Submission
- [ ] Log in at https://appstoreconnect.apple.com
- [ ] Create or update the app listing (Bundle ID: `com.anistonav.hr.twa`)
- [ ] Upload IPA using one of:
  - **Transporter app** (macOS App Store — easiest)
  - **Xcode Organizer** → Distribute App → App Store Connect
  - **Command line**: `xcrun altool --upload-app -f aniston-hrms-v1.6.0.ipa -u YOUR_APPLE_ID -p YOUR_APP_SPECIFIC_PASSWORD`
- [ ] Fill in release notes / What's New
- [ ] Submit for App Review

## Version Info
| Field | Value |
|---|---|
| App Name | Aniston HRMS |
| Bundle ID | com.anistonav.hr.twa |
| Version | 1.6.0 |
| Build | 23 |
| Min iOS | 14.0 |

## Why iOS Builds Cannot Run on Windows
iOS apps must be compiled by Apple's toolchain (Xcode + Swift/ObjC compilers) which only runs on macOS. This is an Apple hardware restriction — it cannot be worked around.

**Workflow**: Develop on Windows → push to git → pull on Mac → run `build-ios.sh` → upload IPA.
