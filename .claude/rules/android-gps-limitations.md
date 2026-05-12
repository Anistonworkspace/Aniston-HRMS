---
name: android-gps-limitations
type: rule
applies_to: ["android", "gps", "capacitor", "mobile", "background-service"]
---

# Android GPS Limitations — Aniston HRMS

## Force Stop — Honest Statement
**Force Stop CANNOT be survived by any Android application.**

This is an absolute OS-level constraint, not a limitation of our implementation:
- When a user Force Stops an app, the OS kills ALL associated processes, services, alarms, and WorkManager jobs
- No code can execute after Force Stop until the user manually reopens the app
- This behavior is intentional by Google to give users complete control over app behavior
- It CANNOT be worked around by any technical means

**What to tell users**: "GPS tracking requires the app to be running in the background. If you Force Stop the app, tracking will pause until you reopen it."

**Never promise**: "GPS tracking works 100% of the time even if you Force Stop the app."

## Maximum Effort Approach
While Force Stop cannot be survived, we implement maximum effort to maintain GPS tracking:

1. **Foreground Service**: Persistent notification keeps service alive in normal background
2. **WorkManager watchdog**: Restarts GPS service every 15 minutes if crashed (not Force Stopped)
3. **AlarmManager**: Backup restart mechanism for AlarmManager-killed services
4. **BOOT_COMPLETED**: Restarts GPS tracking after device reboot (not Force Stop)
5. **App re-open**: GPS automatically resumes when user opens app after any interruption

## OEM Battery Optimization — Real Constraints

### Xiaomi / POCO / Redmi (MIUI / HyperOS)
**Constraint**: MIUI aggressively kills background apps even WITH foreground service running.
**Required user action**: 
1. Open MIUI Security app → Battery → "No restrictions" for Aniston HRMS
2. Enable "Autostart" permission in MIUI App Settings
**Cannot be done programmatically**: user must enable these manually.
**Our responsibility**: Show clear one-time setup guide in app onboarding.

### Samsung One UI
**Constraint**: "Sleeping apps" and "Deep sleeping apps" suspend background activity.
**Required user action**: 
1. Settings → Battery → Background usage limits → remove app from sleeping apps
2. Or: App Info → Battery → "Unrestricted"
**Cannot be done programmatically**: system dialog can be opened with intent, user must confirm.

### General Android 12+ (API 31+)
**Constraint**: Exact alarms require user permission `SCHEDULE_EXACT_ALARM`.
**Impact**: WorkManager watchdog may fire up to 15 min late without exact alarm permission.
**Our approach**: Use `setAndAllowWhileIdle` as fallback (less precise but no permission needed).

## Backend Anomaly Detection Requirement
Since GPS tracking can be interrupted, the backend MUST detect and handle gaps:

1. **Gap detection**: If GPS trail has no points for > 20 min during a shift, flag as `GPS_TRAIL_GAP`
2. **HR visibility**: Dashboard shows field employees with GPS gaps
3. **Employee self-report**: Employee can submit reason for gap via regularization
4. **No silent failure**: A gap in GPS trail must never result in incorrect attendance marking

## Accuracy vs Battery Trade-off
Document these design decisions:
- Field Sales tracking: `HIGH_ACCURACY` mode (GPS + network, ~5m accuracy, higher battery drain)
- Office geofence: `BALANCED_POWER_ACCURACY` on clock-in button press only (not continuous)
- Project Site: One GPS point on check-in (no continuous tracking)
- Battery saver mode detected: automatically switch to `BALANCED_POWER_ACCURACY`

## What We NEVER Promise
- Tracking will work 100% of the time on all Android devices
- GPS will work after Force Stop
- GPS will work if OEM battery optimization is enabled and aggressive
- GPS will work in airplane mode or areas with no GPS signal

## What We DO Promise
- Best-effort GPS tracking using foreground service
- Automatic restart after normal OS-initiated service kills
- Offline buffering and sync when connectivity returns
- Clear user communication when tracking is interrupted
- HR visibility into tracking gaps with reason collection