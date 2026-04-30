# Aniston HRMS — Store Publishing Checklist

App ID: `com.anistonav.hrms`
App Name: `Aniston HRMS`

---

## Folder Structure

```
store-releases/
├── .gitignore                    ← gitignores all keystores, certs, .aab, .ipa
├── PUBLISH_CHECKLIST.md          ← this file
├── android/
│   ├── build-android.ps1         ← PowerShell build script (run to build .aab)
│   ├── .keystore-env.template    ← copy → .keystore-env and fill in passwords
│   ├── signing.keystore          ← GITIGNORED — copy here from PWABuilder files
│   ├── .keystore-env             ← GITIGNORED — your actual passwords
│   └── app-release.aab           ← GITIGNORED — output of build script
└── ios/
    ├── ExportOptions.plist        ← iOS archive export config (fill teamID)
    ├── Distribution.p12           ← GITIGNORED — Apple distribution certificate
    ├── Distribution.mobileprovision ← GITIGNORED — Apple provisioning profile
    └── app.ipa                    ← GITIGNORED — downloaded from Codemagic
```

---

## Android — Build .aab Locally

### Prerequisites (one-time)

- [ ] Install Android Studio: https://developer.android.com/studio
  - Let it install Android SDK (API 35) and JDK 17
  - Open Android Studio once so it completes SDK setup
- [ ] Copy `signing.keystore` from your PWABuilder download to:
  `store-releases/android/signing.keystore`
- [ ] Copy `.keystore-env.template` → `.keystore-env` and fill in your passwords
  (the alias is `key0` for PWABuilder keystores; password is what you set when creating the PWABuilder package)

### Build command

Open PowerShell and run:
```powershell
cd "C:\Users\aniston user\Desktop\Aniston-hrms\store-releases\android"
.\build-android.ps1
```

Output: `store-releases/android/app-release.aab`

### Upload to Play Console

1. Go to https://play.google.com/console
2. Select Aniston HRMS → **Production** (or Internal testing first)
3. **Releases** → **Create new release**
4. Upload `app-release.aab`
5. Write release notes (what changed)
6. **Review release** → **Roll out**

### Background Location Declaration (Play Console — one-time)

Go to: Play Console → Policy → App content → Sensitive permissions → Background Location

Fill in:
> The app records GPS location during active field employee shifts for HR attendance tracking.
> Tracking only starts after explicit employee consent at clock-in and stops at clock-out.
> Location data is visible only to authorized HR personnel within the same organization.
> No location data is shared with third parties.

---

## iOS — Build .ipa via Codemagic

iOS requires macOS and Xcode — use Codemagic (cloud Mac).

### Prerequisites (one-time)

#### Apple Developer Account
- [ ] Enroll at https://developer.apple.com ($99/year)
- [ ] Create App ID: `com.anistonav.hrms` at developer.apple.com → Identifiers
- [ ] Create App in App Store Connect: https://appstoreconnect.apple.com
  - New App → iOS → Bundle ID: `com.anistonav.hrms` → Name: `Aniston HRMS`

#### Certificates & Profiles
- [ ] Create iOS Distribution Certificate at developer.apple.com → Certificates
  - Download + export as .p12 with password
  - Save to `store-releases/ios/Distribution.p12` (gitignored)
- [ ] Create App Store Provisioning Profile
  - developer.apple.com → Profiles → App Store → Bundle: `com.anistonav.hrms`
  - Download → save to `store-releases/ios/Distribution.mobileprovision` (gitignored)
- [ ] Fill your Team ID into `store-releases/ios/ExportOptions.plist`
  (Team ID is at developer.apple.com → Account — looks like `A1B2C3D4E5`)

#### Codemagic Setup
1. Sign up at https://codemagic.io (free tier: 500 min/month)
2. **Add app** → GitHub → `Anistonworkspace/Aniston-HRMS`
3. Codemagic detects `codemagic.yaml` automatically
4. Go to **Teams** → **Integrations** → **App Store Connect**
   - Add App Store Connect API Key (generate at appstoreconnect.apple.com → Keys)
5. Go to app → **Code signing** → **iOS**
   - Upload `Distribution.p12` + password
   - Upload `Distribution.mobileprovision`

### Trigger a build

1. Codemagic dashboard → Aniston HRMS → **Start new build**
2. Select workflow: **Aniston HRMS iOS**
3. Wait ~20 minutes
4. Download `app.ipa` from Artifacts tab
5. Save to `store-releases/ios/app.ipa`

### Upload to App Store Connect

Option A — Codemagic auto-uploads (if `submit_to_testflight: true` in `codemagic.yaml`):
- Check App Store Connect → TestFlight after build completes

Option B — Manual upload with Transporter:
1. Download Transporter from Mac App Store (free)
2. Sign in with your Apple ID
3. Drag `app.ipa` into Transporter
4. Click **Deliver**

### App Store Review

1. App Store Connect → Aniston HRMS → **+** version
2. Add screenshots (required: 6.7" iPhone)
3. Fill description, keywords, privacy policy URL
4. **Submit for Review** (takes 1–3 days)

---

## Store Assets Checklist

### Android (Play Store)

| Asset | Size | Status |
|---|---|---|
| App Icon | 512×512 PNG | Exists: `frontend/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` |
| Feature Graphic | 1024×500 PNG | Need to create |
| Phone screenshots | Min 2, 16:9 or 9:16 | Exist: `frontend/src/main/assets/public/screenshots/` |
| Short description | Max 80 chars | Fill below |
| Full description | Max 4000 chars | Fill below |

Short description:
```
AI-powered HRMS: attendance, payroll, leaves & KYC for Indian teams.
```

Full description:
```
Aniston HRMS is an enterprise-grade Human Resource Management System built for Indian companies.

Key features:
• Smart Attendance — office geofence, field GPS trail, and project site photo check-in
• Indian Payroll — EPF, ESI, Professional Tax, TDS compliance with salary slips
• Leave Management — apply, approve, leave balances with team calendar
• KYC & Onboarding — Aadhaar / PAN / passport OCR verification with AI
• Recruitment — AI-powered job applications, interview scheduling, offer letters
• Performance — OKR goals, review cycles, manager dashboards
• Employee Portal — pay slips, documents, apply for leave, update profile

Background location is used during active field shifts for GPS attendance tracking.
Tracking only runs while an employee is clocked in for a field shift.

Built for Aniston Technologies LLP internal use.
```

### iOS (App Store)

| Asset | Size | Status |
|---|---|---|
| App Icon | 1024×1024 PNG (no alpha) | Need to export |
| 6.7" iPhone screenshots | 1290×2796 | Exist in `apple-splash/` (need actual app screens) |
| Privacy Policy URL | — | https://hr.anistonav.com/privacy |

---

## Version Numbers

Current version: check `frontend/android/app/build.gradle` → `versionName` / `versionCode`

Rule:
- **versionCode**: increment by 1 on every Play Store upload (must always increase)
- **versionName**: semantic version shown to users (e.g., `1.2.0`)

To update before building:
Edit `frontend/android/variables.gradle`:
```groovy
ext {
    minSdkVersion = 23
    compileSdkVersion = 35
    targetSdkVersion = 35
    versionCode = 2        ← increment this
    versionName = "1.1.0"  ← update this
}
```

---

## Keystore Safety

**The signing.keystore is the most critical file.** If you lose it:
- You CANNOT update the app on Play Store (must publish as a new app)
- Google Play App Signing (opt-in) can protect against this

Backup locations to keep `signing.keystore` + `signing-key-info.txt` (with passwords):
- [ ] Google Drive (personal, access-restricted folder)
- [ ] USB drive stored offline
- [ ] Password manager (Bitwarden, 1Password) as secure note attachment
