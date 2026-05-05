package com.anistonav.hrms;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

/**
 * Restarts GpsTrackingService after:
 *   1. Device reboot  (BOOT_COMPLETED / LOCKED_BOOT_COMPLETED)
 *   2. App removed from recents (ACTION_TASK_REMOVED via onTaskRemoved → dual alarm)
 *
 * Dual-alarm strategy: a fast alarm at 500ms catches normal task removal; a second
 * alarm at 8s is a safety net for OEMs that delay process death (Xiaomi/Samsung/Oppo).
 *
 * Only restarts if prefs still contain valid credentials (employee is actively tracking).
 * Force Stop clears SharedPreferences AND kills this receiver, so it correctly stays dead.
 */
public class GpsRestartReceiver extends BroadcastReceiver {

    private static final String TAG = "GpsRestartReceiver";
    public static final String ACTION_RESTART_GPS = "com.anistonav.hrms.RESTART_GPS";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;

        Log.d(TAG, "onReceive: " + action);

        switch (action) {
            case Intent.ACTION_BOOT_COMPLETED:
            case "android.intent.action.LOCKED_BOOT_COMPLETED":
            case ACTION_RESTART_GPS:
                restartIfNeeded(context);
                break;
        }
    }

    private void restartIfNeeded(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(
                GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE);

        String token      = prefs.getString(GpsTrackingService.EXTRA_TOKEN, null);
        String employeeId = prefs.getString(GpsTrackingService.EXTRA_EMPLOYEE_ID, null);

        if (token == null || employeeId == null) {
            Log.d(TAG, "No credentials in prefs — not restarting GPS service");
            return;
        }

        // If service is already alive (e.g. Strategy-1 immediate restart succeeded), skip.
        if (GpsTrackingService.sIsRunning) {
            Log.d(TAG, "GPS service already running — skipping alarm restart");
            return;
        }

        Log.i(TAG, "Restarting GPS service for employee: " + employeeId);

        Intent serviceIntent = new Intent(context, GpsTrackingService.class);
        // null extras → service calls restoreFromPrefs() to recover credentials
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(serviceIntent);
            } else {
                context.startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Failed to restart GPS service: " + e.getMessage());
        }
    }

    /**
     * Schedules TWO alarms to restart the service after task removal.
     *   Alarm 1 — 500 ms: catches normal swipe-from-recents (process still alive)
     *   Alarm 2 — 8 s:    safety net for OEMs that delay killing the process
     * AlarmManager fires even when the app process is fully dead.
     * Called from GpsTrackingService.onTaskRemoved().
     */
    public static void scheduleRestart(Context context) {
        scheduleAlarm(context, 500L,   100); // fast alarm  — request code 100
        scheduleAlarm(context, 8_000L, 101); // backup alarm — request code 101
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
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+: prefer canScheduleExactAlarms(); USE_EXACT_ALARM (API 33)
                // does not require the user-facing permission dialog.
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
            Log.d(TAG, "Scheduled GPS restart in " + delayMs + "ms (requestCode=" + requestCode + ")");
        } catch (SecurityException e) {
            Log.w(TAG, "Exact alarm permission denied, falling back to inexact: " + e.getMessage());
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } catch (Exception ex) {
                Log.e(TAG, "Failed to schedule inexact alarm: " + ex.getMessage());
            }
        }
    }
}
