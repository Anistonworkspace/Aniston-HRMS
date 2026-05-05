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
 * WorkManager periodic watchdog — runs every 15 minutes.
 *
 * If prefs have valid tracking credentials but the service is not running → restart it.
 * Writes precise diagnostic output so "no_credentials" is replaced by the exact
 * missing field (missing_token, missing_employee_id, missing_backend_url, tracking_disabled).
 */
public class GpsWatchdogWorker extends Worker {

    private static final String TAG       = "GpsWatchdogWorker";
    public static final  String WORK_NAME = "aniston_gps_watchdog";

    public GpsWatchdogWorker(@NonNull Context context, @NonNull WorkerParameters params) {
        super(context, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_WATCHDOG_RUN_AT, GpsDiagnostics.nowIso());

        SharedPreferences prefs = ctx.getSharedPreferences(
            GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE);

        // ── Validate each credential field individually ────────────────────────
        boolean trackingEnabled = prefs.getBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false);
        String  token           = prefs.getString(GpsTrackingService.EXTRA_TOKEN,       null);
        String  employeeId      = prefs.getString(GpsTrackingService.EXTRA_EMPLOYEE_ID, null);
        String  backendUrl      = prefs.getString(GpsTrackingService.EXTRA_BACKEND_URL, null);

        // Build precise missing-fields string for diagnostics
        StringBuilder missing = new StringBuilder();
        if (!trackingEnabled)                             missing.append("tracking_disabled,");
        if (token      == null || token.isEmpty())        missing.append("auth_token,");
        if (employeeId == null || employeeId.isEmpty())   missing.append("employee_id,");
        if (backendUrl == null || backendUrl.isEmpty())   missing.append("backend_url,");

        boolean credentialsOk = trackingEnabled
            && token      != null && !token.isEmpty()
            && employeeId != null && !employeeId.isEmpty();

        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_WATCHDOG_CREDENTIALS_PRESENT,
            credentialsOk ? "true" : "false");

        if (!credentialsOk) {
            String reason = missing.length() > 0
                ? missing.toString().replaceAll(",$", "")
                : "unknown";
            Log.d(TAG, "No active GPS session (" + reason + ") — watchdog idle");
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_WATCHDOG_RESULT,
                "no_credentials:" + reason);
            return Result.success();
        }

        // ── Service already alive in this process ──────────────────────────────
        if (GpsTrackingService.sIsRunning) {
            Log.d(TAG, "GPS service is running — watchdog idle");
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_WATCHDOG_RESULT, "service_already_running");
            return Result.success();
        }

        // ── Restart service ────────────────────────────────────────────────────
        Log.w(TAG, "GPS service not running but credentials found — restarting for: " + employeeId);
        try {
            Intent serviceIntent = new Intent(ctx, GpsTrackingService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(serviceIntent);
            } else {
                ctx.startService(serviceIntent);
            }
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_WATCHDOG_RESULT, "restarted_service");
        } catch (Exception e) {
            Log.e(TAG, "Watchdog failed to restart GPS service: " + e.getMessage());
            String reason = e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName();
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_WATCHDOG_RESULT, "failed:" + reason);
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_WATCHDOG_EXCEPTION,   reason);
            return Result.retry();
        }
        return Result.success();
    }

    /** Enqueue periodic watchdog. KEEP policy prevents duplicates. */
    public static void schedule(Context context) {
        PeriodicWorkRequest request = new PeriodicWorkRequest.Builder(
            GpsWatchdogWorker.class, 15, TimeUnit.MINUTES
        ).build();
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, request);
        Log.d(TAG, "GPS watchdog scheduled (15 min interval)");
    }

    /** Cancel watchdog when employee explicitly ends their field shift. */
    public static void cancel(Context context) {
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME);
        Log.d(TAG, "GPS watchdog cancelled");
    }
}
