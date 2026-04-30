# Build Signed Native `.aab` — Aniston HRMS

## What's already done
- `frontend/android/` directory created via `npx cap add android`
- `AndroidManifest.xml` — all background GPS permissions added
- `build.gradle` — release signing config wired to env vars
- Web assets synced into `android/app/src/main/assets/public/`

## Step 1 — Install Android Studio (one-time)

Download from: https://developer.android.com/studio

During installation, let it install:
- Android SDK (API 35 / compileSdkVersion)
- JDK 17 (bundled with Android Studio)

After installation, open Android Studio once so it finishes SDK setup.

## Step 2 — Copy your existing PWABuilder keystore

You already have `signing.keystore` from the PWABuilder files.
Copy it into the android project:

```
Copy signing.keystore → frontend/android/app/signing.keystore
```

Or set its full path in the env var below.

## Step 3 — Set environment variables then build

Open a terminal (PowerShell or cmd) and run:

### PowerShell:
```powershell
$env:KEYSTORE_PATH     = "signing.keystore"   # relative to frontend/android/app/
$env:ANDROID_KEYSTORE_PASSWORD = "YOUR_KEYSTORE_PASSWORD"
$env:ANDROID_KEY_ALIAS = "key0"               # default PWABuilder alias
$env:ANDROID_KEY_PASSWORD      = "YOUR_KEY_PASSWORD"

cd "C:\Users\aniston user\Desktop\Aniston-hrms\frontend\android"
.\gradlew.bat bundleRelease
```

### Cmd:
```cmd
set KEYSTORE_PATH=signing.keystore
set ANDROID_KEYSTORE_PASSWORD=YOUR_KEYSTORE_PASSWORD
set ANDROID_KEY_ALIAS=key0
set ANDROID_KEY_PASSWORD=YOUR_KEY_PASSWORD

cd "C:\Users\aniston user\Desktop\Aniston-hrms\frontend\android"
gradlew.bat bundleRelease
```

## Step 4 — Find your signed AAB

```
frontend/android/app/build/outputs/bundle/release/app-release.aab
```

Upload this to Play Console → Release → Internal testing.

## PWABuilder Keystore Compatibility

Your PWABuilder keystore was used to sign the first AAB you uploaded to Play Store.
Play Store locks to the first signing fingerprint — so you MUST use the same keystore for all future uploads.

If you don't remember the keystore password, check:
- The `signing-key-info` file that came with the PWABuilder download
  (it contains the alias and passwords you set when generating it)

## Checking the key alias

If unsure of the alias name inside your keystore:
```bash
keytool -list -keystore signing.keystore
```
It will prompt for the keystore password and list all aliases.

## After uploading to Play Console

The new Capacitor AAB uses a native `@capacitor-community/background-geolocation`
Foreground Service — it is Doze-exempt, meaning GPS continues when the screen locks.

You will need to complete the Background Location Declaration form in:
Play Console → Policy → App content → Sensitive permissions → Background Location

Use this explanation:
> "The app records GPS location during active field shifts for employee attendance.
> Tracking starts after explicit employee consent at clock-in, stops at clock-out.
> Location data is only visible to authorized HR within the organization."
