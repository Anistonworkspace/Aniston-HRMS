# iOS App Store Release Guide
## Aniston HRMS — Capacitor iOS

> **iOS PWA / Safari cannot do background GPS after the screen locks.**
> Apple suspends JavaScript execution on screen lock, so `watchPosition`
> stops firing. The only correct solution is a native Capacitor iOS app
> with `UIBackgroundModes: ["location"]` and "Always" location permission.

---

## Pre-requisites

| Tool | Requirement |
|---|---|
| Mac | macOS 13 Ventura or later |
| Xcode | 15+ |
| Apple Developer Account | USD 99/year at developer.apple.com |
| Bundle ID | `com.anistonav.hrms` (register at developer.apple.com → Identifiers) |
| Provisioning Profile | App Store Distribution |
| Capacitor iOS | `@capacitor/ios@6.x` (already in package.json) |

---

## Step 1 — Add iOS platform (first time only)

```bash
cd frontend
npm run build               # Build React app into dist/
npx cap add ios             # Scaffold ios/ directory
npx cap sync ios            # Copy dist/ + plugins to ios/
```

After this, `frontend/ios/` contains an Xcode project.

---

## Step 2 — Configure Info.plist

Open `frontend/ios/App/App/Info.plist` and add:

```xml
<!-- Why location is needed -->
<key>NSLocationWhenInUseUsageDescription</key>
<string>Aniston HRMS uses your location to mark attendance at your office or project site.</string>

<key>NSLocationAlwaysAndWhenInUseUsageDescription</key>
<string>Aniston HRMS records your GPS location during active field shifts even when the app is in the background. This is used for field employee attendance tracking.</string>

<key>NSLocationAlwaysUsageDescription</key>
<string>Aniston HRMS needs "Always" location access to continue recording your field GPS trail when the screen is locked during a field shift.</string>

<!-- Background modes — location is required for background GPS -->
<key>UIBackgroundModes</key>
<array>
    <string>location</string>
    <string>fetch</string>
    <string>remote-notification</string>
</array>
```

---

## Step 3 — Request "Always" Location Permission (FIELD users only)

The app should request "Always" location permission only when:
- The employee's shift type is FIELD
- They tap "Start Field Day"

Do NOT request "Always" on app launch — Apple may reject the app.

The `@capacitor-community/background-geolocation` plugin handles the
permission flow. In `capacitorGPS.ts` the `requestNativePermissions()`
call triggers the system prompt.

### iOS Permission Escalation Flow
1. First prompt: "When In Use"
2. After employee starts field day: system automatically offers "Always" as an
   upgrade (iOS 13+) when the app requests `AUTHORIZATION_ALWAYS`
3. If denied: show in-app guidance to go to Settings → Privacy → Location

---

## Step 4 — Xcode Configuration

1. Open `frontend/ios/App/App.xcworkspace` in Xcode
2. Select target `App` → **Signing & Capabilities**
3. Set Team to your Apple Developer account
4. Enable **Background Modes** capability:
   - [x] Location updates
   - [x] Background fetch
   - [x] Remote notifications
5. Set Bundle Identifier: `com.anistonav.hrms`

---

## Step 5 — Archive and Upload to App Store Connect

```bash
# Build for release (or use Xcode Product → Archive)
cd frontend
npx cap sync ios

# Then in Xcode:
# Product → Scheme → Edit Scheme → Run → Release
# Product → Archive
# Organizer → Distribute App → App Store Connect → Upload
```

Or via GitHub Actions (requires Mac runner — GitHub-hosted runners are Linux;
you need either a self-hosted Mac runner or use a service like Codemagic/Bitrise).

---

## Step 6 — App Store Connect Submission

1. Login to [appstoreconnect.apple.com](https://appstoreconnect.apple.com)
2. Create new App (iOS, Bundle ID: `com.anistonav.hrms`)
3. Fill App Information:
   - Name: Aniston HRMS
   - Category: Business
   - Privacy Policy URL: `https://hr.anistonav.com/privacy-policy`
4. Upload build via Xcode Organizer
5. Add screenshots (required: iPhone 6.7", iPad 12.9")
6. Submit for Review

### Privacy Nutrition Labels
In App Store Connect → App Privacy, declare:

| Data Type | Collected | Used For |
|---|---|---|
| Precise Location | Yes | App Functionality (attendance) |
| Approximate Location | No | — |
| Name | Yes | App Functionality |
| Email Address | Yes | App Functionality |
| Usage Data | No | — |

Add a note in "App Review Notes":
> "Location tracking is only active during an active field attendance shift,
> after explicit employee consent. The app never tracks in background without
> the employee initiating a 'Start Field Day' action. Location data is stored
> server-side and only accessible to authorized HR within the employee's
> organization."

---

## Step 7 — TestFlight Beta Testing

1. In App Store Connect → TestFlight
2. Add internal testers (up to 25)
3. QA checklist (see below)
4. Fix issues, re-archive, re-upload
5. Submit for external testing or App Store review

---

## Manual QA Checklist — iOS TestFlight

### Location Permission
- [ ] On first "Start Field Day" tap: system prompt appears asking for location
- [ ] Grant "While Using App" first, then system offers "Always" upgrade
- [ ] If "Always" granted: background GPS works when screen locks
- [ ] If only "When In Use": warning shown "Keep screen on for uninterrupted tracking"
- [ ] If denied: error shown with link to Settings

### Field GPS — Background tracking
- [ ] Start Field Day → consent dialog → accept
- [ ] GPS tracking starts, points counter increments
- [ ] Lock screen for 5+ minutes
- [ ] Unlock — if "Always" granted, points should have increased
- [ ] End Field Day → tracking stops, end-of-day summary shown
- [ ] HR can see trail on Attendance management page

### PWA / Safari Fallback
- [ ] When accessing via Safari (not native app): iOS banner shown in FieldSalesView
  advising to install native iOS app for uninterrupted background GPS
- [ ] Web PWA clearly states "GPS paused while screen was locked"

---

## Current Status

The `ios/` directory is **not yet generated** in this repository. To set it up:

```bash
cd frontend
npx cap add ios
npx cap sync ios
open ios/App/App.xcworkspace
```

This requires a Mac with Xcode installed.

---

## Remaining Limitations

- iOS build requires Mac hardware (Apple Silicon or Intel Mac with Xcode 15+)
- GitHub Actions default runners are Linux — cannot build iOS natively
- Apple Developer Program membership required ($99/year)
- App Store review takes 1–7 business days
- Background location review may add additional delay (Apple scrutinizes this)
