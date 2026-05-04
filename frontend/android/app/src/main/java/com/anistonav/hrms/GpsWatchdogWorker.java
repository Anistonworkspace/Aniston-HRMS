package com.anistonav.hrms;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import androidx.annotation.NonNull;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

/**
 * WorkManager periodic watchdog — runs every 15 minutes via JobScheduler/AlarmManager
 * depending on Android version. WorkManager is Doze-aware and survives aggressive OEMs
 * that kill AlarmManager-based restarts (Samsung/Xiaomi/Oppo/OnePlus).
 *
 * Logic: if prefs have active credentials but the service is not running → restart it.
 * This is a safety net on top of AlarmManager + START_STICKY — not a replacement.
 */
public class GpsWatchdogWorker extends Worker {

    private static final String TAG = "GpsWatchdogWorker";
    public static final String WORK_NAME = "aniston_gps_watchdog";

    public GpsWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();

        SharedPreferences prefs = ctx.getSharedPreferences(
                GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE);

        String token = prefs.getString(GpsTrackingService.EXTRA_TOKEN, null);
        String employeeId = prefs.getString(GpsTrackingService.EXTRA_EMPLOYEE_ID, null);

        // No active tracking credentials → nothing to watch
        if (token == null || employeeId == null) {
            Log.d(TAG, "No active GPS session — watchdog idle");
            return Result.success();
        }

        // Service is already alive (static volatile flag) → nothing to do
        if (GpsTrackingService.sIsRunning) {
            Log.d(TAG, "GPS service is running — watchdog idle");
            return Result.success();
        }

        // Service is dead but credentials exist → restart
        Log.w(TAG, "GPS service not running but credentials found — restarting for employee: " + employeeId);
        try {
            Intent serviceIntent = new Intent(ctx, GpsTrackingService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(serviceIntent);
            } else {
                ctx.startService(serviceIntent);
            }
        } catch (Exception e) {
            Log.e(TAG, "Watchdog failed to restart GPS service: " + e.getMessage());
            return Result.retry();
        }

        return Result.success();
    }

    /**
     * Enqueue the periodic watchdog. Safe to call multiple times — KEEP policy
     * means it won't create duplicates if one is already enqueued.
     * Call this from MainActivity.onCreate() so it's always scheduled.
     */
    public static void schedule(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
                GpsWatchdogWorker.class,
                15, TimeUnit.MINUTES   // minimum interval WorkManager allows
        ).build();

        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
                WORK_NAME,
                ExistingPeriodicWorkPolicy.KEEP,
                request
        );
        Log.d(TAG, "GPS watchdog scheduled (15 min interval)");
    }

    /** Cancel the watchdog — call when the employee explicitly ends their field shift. */
    public static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
        Log.d(TAG, "GPS watchdog cancelled");
    }
}
