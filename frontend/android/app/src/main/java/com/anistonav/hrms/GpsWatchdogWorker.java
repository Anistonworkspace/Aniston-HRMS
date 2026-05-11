package com.anistonav.hrms;

import android.content.Context;
import android.content.Intent;
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
        String runAt = GpsDiagnostics.nowIso();
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_WATCHDOG_RUN_AT, runAt);

        // ── Use GpsSessionStore for canonical credential check ────────────────
        // This is the fix for the root bug: watchdog was reading prefs independently
        // with slightly different timing, causing false "no_credentials" results even
        // when the service was running with valid credentials.
        String missingFields = GpsSessionStore.getMissingFields(ctx);
        boolean hasSession   = GpsSessionStore.hasValidSession(ctx);

        // Record diagnostics from the same source the service uses
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_WATCHDOG_CREDENTIALS_PRESENT,
            hasSession ? "true" : "false");

        // Always record the exact missing fields for diagnostics panel
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_WATCHDOG_MISSING_FIELDS,
            missingFields.isEmpty() ? "" : missingFields);
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_WATCHDOG_CRED_SNAPSHOT_AT, GpsDiagnostics.nowIso());

        if (!hasSession) {
            // Distinguish "employee checked out" from "credentials missing"
            String reason = !missingFields.isEmpty() ? missingFields : "unknown";
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

        // ── Restart service — credentials confirmed via GpsSessionStore ────────
        GpsSessionStore.Session session = GpsSessionStore.getSession(ctx);
        Log.w(TAG, "GPS service not running but session found — restarting for: " + session.employeeId);
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_WATCHDOG_RESULT,       "attempting_restart");
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_WATCHDOG_RESTART_ATTEMPT_AT, GpsDiagnostics.nowIso());
        try {
            Intent serviceIntent = new Intent(ctx, GpsTrackingService.class);
            // No extras needed — GpsTrackingService.restoreFromPrefs() reads from GpsSessionStore
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
