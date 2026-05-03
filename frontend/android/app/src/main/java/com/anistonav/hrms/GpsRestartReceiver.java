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
 *   2. App removed from recents (ACTION_TASK_REMOVED via onTaskRemoved → alarm)
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

        // No credentials = employee never started tracking or Force Stop was used → do nothing
        if (token == null || employeeId == null) {
            Log.d(TAG, "No credentials in prefs — not restarting GPS service");
            return;
        }

        Log.i(TAG, "Restarting GPS service for employee: " + employeeId);

        Intent serviceIntent = new Intent(context, GpsTrackingService.class);
        // No extras needed — service will call restoreFromPrefs() when intent is null
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
     * Schedule a one-shot alarm to restart the service 3 seconds after task removal.
     * Called from GpsTrackingService.onTaskRemoved().
     * AlarmManager fires even when the app process is dead.
     */
    public static void scheduleRestart(Context context) {
        Intent intent = new Intent(context, GpsRestartReceiver.class);
        intent.setAction(ACTION_RESTART_GPS);
        PendingIntent pi = PendingIntent.getBroadcast(
                context, 101, intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        long triggerAt = System.currentTimeMillis() + 3_000L; // 3 seconds after removal
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                // Android 12+: SCHEDULE_EXACT_ALARM requires runtime permission grant
                if (am.canScheduleExactAlarms()) {
                    am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                } else {
                    // Permission not granted — fall back to inexact (fires within ~15s)
                    am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.setExact(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } catch (SecurityException e) {
            Log.w(TAG, "Exact alarm permission denied, falling back to inexact: " + e.getMessage());
            try {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } catch (Exception ex) {
                Log.e(TAG, "Failed to schedule inexact alarm: " + ex.getMessage());
            }
        }
        Log.d(TAG, "Scheduled GPS restart in 3s via AlarmManager");
    }
}
