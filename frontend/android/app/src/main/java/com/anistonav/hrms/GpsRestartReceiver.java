package com.anistonav.hrms;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.os.Build;
import android.util.Log;

/**
 * Restarts GpsTrackingService after:
 *   1. Device reboot  (BOOT_COMPLETED / LOCKED_BOOT_COMPLETED)
 *   2. App removed from recents (ACTION_RESTART_GPS via dual AlarmManager)
 *
 * Diagnostic guarantee: lastRestartAttemptAt is ALWAYS written as the very first
 * action in restartIfNeeded(), regardless of whether the service is already running
 * or credentials are missing. This means a blank lastRestartAttemptAt after the
 * receiver fires indicates a JVM-level crash before the method ran.
 */
public class GpsRestartReceiver extends BroadcastReceiver {

    private static final String TAG = "GpsRestartReceiver";
    public static final String ACTION_RESTART_GPS = "com.anistonav.hrms.RESTART_GPS";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        Log.d(TAG, "onReceive: " + action);
        // Record that the receiver fired — BEFORE any guards
        GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RECEIVER_FIRED_AT, GpsDiagnostics.nowIso());
        GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RECEIVER_ACTION,   action);

        switch (action) {
            case Intent.ACTION_BOOT_COMPLETED:
            case ACTION_RESTART_GPS:
                restartIfNeeded(context);
                break;

            case "android.intent.action.LOCKED_BOOT_COMPLETED":
                // Device just powered on but user has NOT unlocked yet.
                // KeyStore (and therefore EncryptedSharedPreferences) is unavailable
                // until the first unlock — GpsSessionStore.getSession() will return
                // empty credentials. Defer the restart to ACTION_USER_UNLOCKED.
                GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_RESULT,
                    "deferred_to_user_unlocked");
                GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_DIRECT_BOOT_LOCKED, "true");
                GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_RESTART_DEFERRED_UNTIL_UNLOCK, GpsDiagnostics.nowIso());
                registerUserUnlockedReceiver(context);
                break;

            case Intent.ACTION_USER_UNLOCKED:
                // First unlock after boot — KeyStore is now available; retry the start.
                GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RECEIVER_ACTION,
                    "USER_UNLOCKED_retry");
                restartIfNeeded(context);
                break;
        }
    }

    private void restartIfNeeded(Context context) {
        // ── Step 1: Record attempt timestamp IMMEDIATELY — before ANY return path ──
        // A blank lastRestartAttemptAt after the receiver fires = JVM crash before here.
        GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_ATTEMPT_AT, GpsDiagnostics.nowIso());

        // ── Step 2: Use GpsSessionStore for canonical credential check ────────────
        boolean hasSession   = GpsSessionStore.hasValidSession(context);
        String  missingFields = GpsSessionStore.getMissingFields(context);
        boolean shouldTrack  = GpsSessionStore.shouldTrack(context);

        GpsSessionStore.Session session = GpsSessionStore.getSession(context);
        GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_RESTART_CREDENTIALS_PRESENT,
            hasSession ? "true" : "false");
        GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_RECEIVER_CRED_SNAPSHOT_AT, GpsDiagnostics.nowIso());

        // ── Step 3: Guard — employee checked out or no active session ─────────────
        if (!shouldTrack) {
            Log.d(TAG, "tracking_enabled=false — not restarting GPS service");
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_RESULT, "skipped_not_checked_in");
            return;
        }
        if (!hasSession) {
            String reason = !missingFields.isEmpty() ? missingFields : "unknown";
            Log.d(TAG, "Missing credentials (" + reason + ") — not restarting");
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_RESULT,
                "missing_credentials:" + reason);
            return;
        }

        // ── Step 4: Guard — service already alive in this process ─────────────────
        // sIsRunning is only true if the SERVICE is running IN THIS PROCESS.
        // After a full process kill (swipe-from-recents on Xiaomi), a new process is started
        // by the alarm, so sIsRunning defaults to false — we will proceed to restart.
        if (GpsTrackingService.sIsRunning) {
            Log.d(TAG, "GPS service already running in this process — skipping alarm restart");
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_RESULT, "skipped_already_running");
            return;
        }

        // ── Step 5: Permission gate — must pass before starting FGS ──────────────
        // Background receivers (alarm/boot) can hit Android 14+ SecurityException when
        // starting a type=location FGS without FOREGROUND_SERVICE_LOCATION permission
        // or when the app lacks a valid foreground exemption.
        GpsPermissionGuard.CheckResult perm = GpsPermissionGuard.check(context, "receiver");
        if (!perm.canStart) {
            Log.w(TAG, "Permission gate blocked restart: " + perm.blockReason);
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_RESULT,
                "blocked_permission:" + perm.blockReason);
            return;
        }

        // ── Step 6: Build and start service intent ────────────────────────────────
        // No extras in intent — GpsTrackingService.restoreFromPrefs() reads from GpsSessionStore.
        Log.i(TAG, "Restarting GPS service for employee: " + session.employeeId);
        Intent serviceIntent = new Intent(context, GpsTrackingService.class);

        GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_RESTART_SERVICE_INTENT_CREATED_AT, GpsDiagnostics.nowIso());

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_RESTART_START_FG_CALLED_AT, GpsDiagnostics.nowIso());
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_RESULT, "started");
            Log.i(TAG, "startForegroundService dispatched successfully");

        } catch (SecurityException e) {
            Log.e(TAG, "startForegroundService SecurityException: " + e.getMessage());
            String reason = e.getMessage() != null ? e.getMessage() : "SecurityException";
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_RESULT,  "failed_security:" + reason);
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_RESTART_EXCEPTION,    reason);
            GpsDiagnostics.recordError(context, "restart_security_exception: " + reason);
        } catch (Exception e) {
            Log.e(TAG, "Failed to restart GPS service: " + e.getMessage());
            String reason = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_RESULT,  "failed:" + reason);
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_RESTART_EXCEPTION,    reason);
            GpsDiagnostics.recordError(context, "restart_exception: " + reason);
        }
    }

    /**
     * Registers a one-shot runtime receiver for ACTION_USER_UNLOCKED so the GPS
     * service can start once the KeyStore (and encrypted prefs) becomes available
     * after the first post-boot unlock. The receiver unregisters itself after firing.
     */
    private static void registerUserUnlockedReceiver(Context context) {
        BroadcastReceiver unlockReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context ctx, Intent intent) {
                try { ctx.getApplicationContext().unregisterReceiver(this); } catch (Exception ignored) {}
                Log.d(TAG, "USER_UNLOCKED received — retrying GPS start");
                GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_RECEIVER_ACTION,
                    "USER_UNLOCKED_inline");
                new GpsRestartReceiver().restartIfNeeded(ctx);
            }
        };
        IntentFilter filter = new IntentFilter(Intent.ACTION_USER_UNLOCKED);
        try {
            context.getApplicationContext().registerReceiver(unlockReceiver, filter);
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_USER_UNLOCKED_RECEIVER_REGISTERED, GpsDiagnostics.nowIso());
        } catch (Exception e) {
            Log.e(TAG, "Failed to register USER_UNLOCKED receiver: " + e.getMessage());
        }
    }

    /**
     * Schedules TWO AlarmManager alarms to restart the service after task removal.
     *   Alarm 1 — 500 ms:  catches normal swipe (process still alive or recently killed)
     *   Alarm 2 — 8 s:     safety net for OEMs that delay killing the process
     * Both alarms fire ACTION_RESTART_GPS → this receiver → restartIfNeeded().
     */
    public static void scheduleRestart(Context context) {
        scheduleAlarm(context, 500L,   100);
        scheduleAlarm(context, 8_000L, 101);
    }

    private static void scheduleAlarm(Context context, long delayMs, int requestCode) {
        Intent intent = new Intent(context, GpsRestartReceiver.class);
        intent.setAction(ACTION_RESTART_GPS);
        PendingIntent pi = PendingIntent.getBroadcast(
            context, requestCode, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        long triggerAt = System.currentTimeMillis() + delayMs;
        boolean canExact = Build.VERSION.SDK_INT < Build.VERSION_CODES.S
            || am.canScheduleExactAlarms();

        GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_EXACT_ALARM_GRANTED,
            String.valueOf(canExact));

        try {
            if (canExact) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
                GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_ALARM_TYPE, "exact");
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_ALARM_TYPE, "inexact");
            }
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_ALARM_SCHEDULE_RESULT, "ok");
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_RESTART_ALARM_AT, GpsDiagnostics.nowIso());
            Log.d(TAG, "Scheduled " + (canExact ? "exact" : "inexact") + " restart in " + delayMs + "ms (requestCode=" + requestCode + ")");
        } catch (SecurityException e) {
            // SCHEDULE_EXACT_ALARM revoked at runtime — fall back to inexact
            Log.w(TAG, "Exact alarm SecurityException, falling back to inexact: " + e.getMessage());
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_ALARM_TYPE,   "inexact_fallback");
            GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_ALARM_SCHEDULE_ERROR,
                "SecurityException:" + e.getMessage());
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_ALARM_SCHEDULE_RESULT, "ok_inexact_fallback");
            } catch (Exception ex) {
                Log.e(TAG, "Inexact alarm also failed: " + ex.getMessage());
                GpsDiagnostics.recordEvent(context, GpsDiagnostics.KEY_LAST_ALARM_SCHEDULE_RESULT,
                    "failed:" + ex.getMessage());
            }
        }
    }
}
