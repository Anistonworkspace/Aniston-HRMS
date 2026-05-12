---
name: android-background-gps-production
description: "Skill for Android background GPS analysis: foreground service, WorkManager, OEM constraints, Force Stop honesty, token storage, AAB safety"
type: skill
---

# Android Background GPS Production Skill — Aniston HRMS

## When to Use
Use when asked to:
- Audit Android GPS tracking reliability
- Debug GPS stopping on certain OEM devices
- Review APK/AAB signing safety
- Evaluate battery optimization impact
- Write honest GPS reliability documentation

## GPS Architecture Understanding

### Capacitor Context
Aniston HRMS is a Capacitor app — it's a WebView wrapping a web app.
The GPS tracking logic runs in JavaScript (field sales mode) via Capacitor's Geolocation plugin.
For background tracking, a native Android foreground service is needed — the WebView alone cannot maintain background GPS.

### GPS Modes
1. **OFFICE**: geofence check on clock-in button → one GPS query, not continuous
2. **FIELD_SALES**: continuous 60s trail → requires foreground service
3. **PROJECT_SITE**: one GPS point on check-in → no continuous tracking

## Foreground Service Implementation Pattern
```java
// Native Android (if custom plugin)
public class GpsTrackingService extends Service {
    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createNotificationChannel();
        Notification notification = buildNotification();
        startForeground(NOTIFICATION_ID, notification);
        startLocationUpdates();
        return START_STICKY; // Restart if killed (not Force Stopped)
    }
}
```

Key flags:
- `START_STICKY`: service restarts after OOM kill (NOT Force Stop)
- `startForeground()`: required to prevent aggressive OS kill
- `android:foregroundServiceType="location"`: required for API 29+

## WorkManager Watchdog Pattern
```kotlin
class GpsWatchdogWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        if (!isGpsServiceRunning()) {
            startGpsService()
        }
        return Result.success()
    }
}

// Registration (do once on app start):
val watchdogRequest = PeriodicWorkRequestBuilder<GpsWatchdogWorker>(15, TimeUnit.MINUTES)
    .setConstraints(Constraints.NONE)
    .build()
WorkManager.getInstance(context).enqueueUniquePeriodicWork(
    "gps_watchdog",
    ExistingPeriodicWorkPolicy.KEEP,
    watchdogRequest
)
```

Note: WorkManager minimum interval is 15 minutes. Cannot do shorter intervals.

## Force Stop — Technical Explanation
When Force Stop occurs:
1. OS sends SIGKILL to all app processes (uncatchable)
2. All services are killed
3. All WorkManager jobs are cancelled
4. All AlarmManager alarms are cancelled
5. App is removed from running apps list

There is NO API in Android to detect Force Stop before it happens.
There is NO API to run code after Force Stop.
`BOOT_COMPLETED` broadcast is NOT sent after Force Stop (only after device reboot).

**The honest message to users**: "Force stopping the app will pause GPS tracking until you reopen it."

## OEM-Specific Detection
```kotlin
// Detect OEM for targeted guidance
fun getOemName(): String = Build.MANUFACTURER.lowercase()

fun showOemSpecificGuidance(context: Context) {
    val oem = getOemName()
    when {
        oem.contains("xiaomi") || oem.contains("poco") || oem.contains("redmi") ->
            showDialog("For Xiaomi/POCO: Open Security app → Battery → Set 'No restrictions' for ${context.packageName}")
        oem.contains("samsung") ->
            showDialog("For Samsung: Settings → Battery → Background usage limits → Remove ${context.packageName}")
        else ->
            showDialog("For best GPS tracking: Settings → Battery → App Info → Set to 'Unrestricted'")
    }
}
```

## Token Storage in Capacitor
```typescript
// CORRECT: Use Capacitor Preferences (encrypts on Android)
import { Preferences } from '@capacitor/preferences';
await Preferences.set({ key: 'refreshToken', value: token }); // Encrypted on Android

// WRONG: localStorage (accessible via Chrome DevTools, not encrypted)
localStorage.setItem('refreshToken', token);
```

Capacitor's `@capacitor/preferences` uses `EncryptedSharedPreferences` on Android — this is the correct approach.

## AAB Signing Safety Checklist
```yaml
# In GitHub Actions:
- name: Decode keystore
  run: echo "${{ secrets.ANDROID_KEYSTORE_BASE64 }}" | base64 -d > /tmp/release.jks

- name: Build AAB
  run: ./gradlew bundleRelease
        -Pandroid.injected.signing.store.file=/tmp/release.jks
        -Pandroid.injected.signing.store.password=${{ secrets.ANDROID_STORE_PASSWORD }}
        -Pandroid.injected.signing.key.alias=${{ secrets.ANDROID_KEY_ALIAS }}
        -Pandroid.injected.signing.key.password=${{ secrets.ANDROID_KEY_PASSWORD }}

- name: Cleanup keystore
  if: always()  # Run even if build fails
  run: rm -f /tmp/release.jks
```

## GPS Gap Detection (Backend)
```typescript
// backend/src/modules/attendance/attendance.service.ts
async detectGpsGaps(employeeId: string, date: Date): Promise<GpsGap[]> {
  const points = await prisma.locationVisit.findMany({
    where: { employeeId, createdAt: { gte: startOfDay(date), lte: endOfDay(date) } },
    orderBy: { createdAt: 'asc' }
  });
  
  const gaps: GpsGap[] = [];
  for (let i = 1; i < points.length; i++) {
    const gapMinutes = differenceInMinutes(points[i].createdAt, points[i-1].createdAt);
    if (gapMinutes > 20) {
      gaps.push({ start: points[i-1].createdAt, end: points[i].createdAt, minutes: gapMinutes });
    }
  }
  return gaps;
}
```

## Output Format for GPS Audits
```
GPS-AUDIT-[ID]: [SHORT TITLE]
Severity: CRITICAL / HIGH / MEDIUM / LOW
Category: SERVICE_SURVIVAL / OEM_COMPAT / PERMISSIONS / SIGNING / PRIVACY / FORCE_STOP_HONESTY
Finding: [specific issue]
OEM Affected: [Xiaomi / Samsung / Generic / All]
Play Store Risk: yes/no
Fix: [specific action]
Effort: [low/medium/high]
```