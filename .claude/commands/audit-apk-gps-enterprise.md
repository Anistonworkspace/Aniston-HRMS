---
name: audit-apk-gps-enterprise
description: "Audit Android APK background GPS tracking, OEM constraints, foreground service survival, AAB signing safety, and Force Stop behavior"
---

# APK & GPS Enterprise Audit — Aniston HRMS

Use `android-gps-enterprise-agent` with `android-gps-limitations.md` rule.

## Files to Audit
- `frontend/capacitor.config.ts` — Capacitor configuration
- `frontend/android/app/src/main/AndroidManifest.xml` — permissions and service declarations
- `frontend/android/app/build.gradle` — SDK versions, signing config
- `frontend/android/gradle/wrapper/gradle-wrapper.properties` — Gradle version
- `.github/workflows/deploy.yml` — Android build job
- `frontend/src/features/attendance/FieldSalesView.tsx` — GPS UI
- `backend/src/modules/attendance/attendance.service.ts` — GPS trail backend

## Audit Sections

### Section 1: Foreground Service
Read `AndroidManifest.xml` and verify:
- [ ] `<service android:name=".GpsTrackingService" android:foregroundServiceType="location" />`
- [ ] `<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />`
- [ ] `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />`
- [ ] `<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />`
- [ ] `<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />`
- [ ] `<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />`

### Section 2: WorkManager Watchdog
Check if WorkManager or AlarmManager restart is implemented:
- Look for `PeriodicWorkRequest` in Capacitor plugin or Android source
- Look for `AlarmManager.setExactAndAllowWhileIdle()` usage
- Look for `BOOT_COMPLETED` BroadcastReceiver

### Section 3: OEM Guidance in App
Check `frontend/src/features/attendance/` or onboarding files:
- [ ] One-time prompt for Xiaomi/POCO users to enable "No restrictions"
- [ ] One-time prompt for Samsung users to disable sleeping apps
- [ ] Clear messaging that Force Stop pauses tracking

### Section 4: Force Stop Documentation
Check for Force Stop honesty:
- [ ] No code claims to survive Force Stop
- [ ] User-facing messaging is accurate about tracking limitations
- [ ] Backend gap detection implemented

### Section 5: Token Storage
Check `capacitor.config.ts` and any Capacitor plugin config:
- [ ] JWT/refresh token NOT stored in WebView localStorage
- [ ] Token stored in native `EncryptedSharedPreferences` or Capacitor Preferences plugin
- [ ] Capacitor Preferences plugin used (encrypts on Android via EncryptedSharedPreferences)

### Section 6: AAB Signing Safety
Check `.github/workflows/deploy.yml` Android build job:
- [ ] Keystore loaded from `${{ secrets.ANDROID_KEYSTORE_BASE64 }}`
- [ ] Temp keystore cleaned up after build: `rm -f keystore.jks`
- [ ] No keystore files in git (check `.gitignore`)
- [ ] Release build flag: `-Pandroid.injected.signing.store.file=...`
- [ ] APK artifact uploaded to EC2, not stored in repo

### Section 7: Build Configuration
Check `frontend/android/app/build.gradle`:
- [ ] `minSdkVersion 23`
- [ ] `compileSdkVersion 35`
- [ ] `targetSdkVersion 35`
- [ ] `minifyEnabled true` for release
- [ ] `shrinkResources true` for release

### Section 8: GPS Trail Backend
Check `backend/src/modules/attendance/attendance.service.ts`:
- [ ] GPS batch upload endpoint accepts array of points
- [ ] Gap detection: > 20 min gap during shift → `GPS_TRAIL_GAP` anomaly flagged
- [ ] Offline sync: batch upload accepts out-of-order timestamps
- [ ] Deduplication: same lat/lng within 10m in 30s = skip
- [ ] HR dashboard: anomalies visible

## Output
Produce findings using GPS-AUDIT format from `android-gps-enterprise-agent`.
State clearly: what IS implemented, what is MISSING, what is IMPOSSIBLE by design (Force Stop).
Give an overall GPS reliability score: X/10 and explain what effort level was achieved.