# Android Play Store Release Guide
## Aniston HRMS — Capacitor AAB

> **Do NOT use PWABuilder / TWA for Play Store submission.** Android Doze mode
> freezes the Chrome renderer when the screen turns off, breaking background GPS.
> The Capacitor AAB uses a native Foreground Service and is Doze-exempt.

---

## Pre-requisites

| Tool | Version |
|---|---|
| Node.js | ≥ 18 |
| Java / JDK | 17 (for Gradle) |
| Android Studio | Hedgehog or later |
| Capacitor CLI | `@capacitor/cli@6.x` |
| Android SDK | API level 35 (compileSdk) / minSdk 23 |

---

## Step 1 — Generate the Android project (first time only)

```bash
cd frontend
npm run build               # Build React app into dist/
npx cap add android         # Scaffold android/ directory
npx cap sync android        # Copy dist/ + plugins to android/
```

After this, the `frontend/android/` folder is created.

---

## Step 2 — Required AndroidManifest.xml Permissions

Open `frontend/android/app/src/main/AndroidManifest.xml` and ensure these
permissions are present:

```xml
<!-- Location permissions -->
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<!-- Background GPS — required for Field shift tracking when screen is off -->
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

<!-- Foreground service for background GPS -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<!-- Android 14+: must declare foreground service type -->
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />

<!-- Notifications (Android 13+) — for "Field GPS Active" persistent notification -->
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />

<!-- Wake lock to keep CPU active during offline GPS buffering -->
<uses-permission android:name="android.permission.WAKE_LOCK" />

<!-- Network state for offline-sync detection -->
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.INTERNET" />
```

The `@capacitor-community/background-geolocation` plugin automatically adds
a Foreground Service entry to the manifest when you run `npx cap sync`.
Verify it appears as:

```xml
<service
    android:name="com.equimapper.backgroundgeolocation.BackgroundGeolocationService"
    android:foregroundServiceType="location"
    android:exported="false" />
```

---

## Step 3 — Generate a Signing Keystore (one time)

```bash
keytool -genkey -v \
  -keystore aniston-hrms-release.keystore \
  -alias aniston_hrms \
  -keyalg RSA -keysize 2048 \
  -validity 10000
```

Store the keystore file securely — losing it means you cannot update the app
on Play Store.

---

## Step 4 — Configure Signing in Gradle

Edit `frontend/android/app/build.gradle`:

```groovy
android {
    ...
    signingConfigs {
        release {
            storeFile file(System.getenv("KEYSTORE_PATH") ?: "aniston-hrms-release.keystore")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
            ...
        }
    }
}
```

---

## Step 5 — GitHub Actions Secrets

Add these 4 secrets to **GitHub → Settings → Secrets → Actions**:

| Secret name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `base64 -i aniston-hrms-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Your keystore password |
| `ANDROID_KEY_ALIAS` | `aniston_hrms` |
| `ANDROID_KEY_PASSWORD` | Your key password |

The existing `.github/workflows/deploy.yml` Android build job already reads
these secrets and produces a signed AAB artifact.

---

## Step 6 — Build the signed AAB

```bash
cd frontend/android
./gradlew bundleRelease
```

Output: `app/build/outputs/bundle/release/app-release.aab`

Or trigger via GitHub Actions — the `Build Android APK` job runs automatically
on push to `main`.

---

## Step 7 — Upload to Play Console

1. Go to [play.google.com/console](https://play.google.com/console)
2. Create new app → Android
3. **Release** → **Internal testing** → Create new release
4. Upload `app-release.aab`
5. Add release notes
6. Roll out to internal testers

### First submission checklist
- [ ] App Bundle reviewed (not APK)
- [ ] Target API level ≥ 33 (required 2024+)
- [ ] `ACCESS_BACKGROUND_LOCATION` declaration form completed (see below)
- [ ] Privacy policy URL entered
- [ ] App content rated

---

## Step 8 — Background Location Permission Declaration

Google requires a form for `ACCESS_BACKGROUND_LOCATION`.

In Play Console → **Policy** → **App content** → **Sensitive permissions**:

- Permission: **Background Location**
- Core functionality: "Field employee GPS attendance tracking"
- Explanation: "The app records GPS location during active field shifts for
  employee attendance. Tracking starts after employee consent and clock-in,
  stops when they clock out or end the field day. Location data is only visible
  to authorized HR/Managers within the organization."
- Video demo: Required — record a 2-minute screen recording:
  1. Consent dialog shown
  2. Clock-in with GPS
  3. Lock screen — verify notification "Aniston HRMS — Field GPS Active"
  4. Wait 5 minutes
  5. Unlock — verify points increased in trail
  6. Clock out — verify notification dismissed

---

## Manual QA Checklist — Android Play Store Internal Testing

### Install
- [ ] Install signed AAB via Play Console internal testing
- [ ] App opens correctly, loads login

### Field GPS — Background tracking
- [ ] Open Attendance page → Field Sales mode displayed
- [ ] Start Field Day → consent dialog shown
- [ ] Accept consent → GPS tracking starts
- [ ] Persistent notification appears: "Aniston HRMS — Field GPS Active"
- [ ] Lock screen for 10+ minutes
- [ ] Unlock — GPS points count increased
- [ ] HR can see trail on Attendance detail page
- [ ] End Field Day → notification dismissed
- [ ] End-of-day summary modal shown with correct distance and point count

### Battery optimization
- [ ] MIUI/Samsung: prompt to set battery unrestricted shown once per week
- [ ] After setting unrestricted: GPS continues through aggressive optimization

### Offline
- [ ] Enable airplane mode
- [ ] GPS points buffered locally (counter shown in UI)
- [ ] Re-enable network — pending points sync automatically

### Permissions
- [ ] Location prompt: "Allow all the time" required for background GPS
- [ ] Notification prompt: "Allow" for persistent service notification
- [ ] If denied: clear error message shown in app

---

## Remaining Limitations

- iOS background GPS requires a separate native iOS app build (see IOS_APP_STORE_RELEASE.md)
- PWABuilder / TWA packages are NOT suitable for background GPS (Doze mode issue)
- Desktop browser cannot do continuous field GPS tracking
