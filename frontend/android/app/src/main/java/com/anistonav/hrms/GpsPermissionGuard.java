package com.anistonav.hrms;

import android.Manifest;
import android.app.ActivityManager;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.util.Log;

import androidx.core.content.ContextCompat;

/**
 * GpsPermissionGuard — single gate for all foreground-service-location eligibility checks.
 *
 * Called before ANY attempt to start GpsTrackingService from:
 *   - GpsTrackingPlugin.start()       (user-initiated, app visible — should always pass)
 *   - MainActivity.tryAutoRestartGps() (app resume — usually passes if user granted perms)
 *   - GpsRestartReceiver.restartIfNeeded() (alarm/boot — may fail on Android 14+ if bg)
 *   - GpsWatchdogWorker.doWork()       (WorkManager bg — may fail on Android 14+)
 *
 * On Android 14+ (API 34+), starting a ForegroundService with type=location from
 * the background requires FOREGROUND_SERVICE_LOCATION permission AND the app must be
 * in foreground OR have a valid exemption. We can't guarantee the exemption from
 * background paths, so we check and record diagnostics instead of crashing.
 *
 * Security: no tokens or credentials are stored here — diagnostics only.
 */
public class GpsPermissionGuard {

    private static final String TAG = "GpsPermissionGuard";

    public static class CheckResult {
        public final boolean canStart;
        public final String  blockReason;   // empty string if canStart=true
        public final boolean hasFineLocation;
        public final boolean hasCoarseLocation;
        public final boolean hasBackgroundLocation;
        public final boolean hasNotificationPermission;
        public final boolean hasForegroundServiceLocation;
        public final boolean isLocationEnabled;
        public final int     apiLevel;

        CheckResult(boolean canStart, String blockReason,
                    boolean hasFine, boolean hasCoarse, boolean hasBg,
                    boolean hasNotif, boolean hasFgsLoc,
                    boolean locEnabled, int apiLevel) {
            this.canStart                     = canStart;
            this.blockReason                  = blockReason;
            this.hasFineLocation              = hasFine;
            this.hasCoarseLocation            = hasCoarse;
            this.hasBackgroundLocation        = hasBg;
            this.hasNotificationPermission    = hasNotif;
            this.hasForegroundServiceLocation = hasFgsLoc;
            this.isLocationEnabled            = locEnabled;
            this.apiLevel                     = apiLevel;
        }
    }

    /**
     * Perform all eligibility checks required before starting the location FGS.
     *
     * @param ctx    any context (application context preferred for bg paths)
     * @param source caller label for diagnostics (e.g. "plugin", "watchdog", "receiver", "resume")
     * @return CheckResult — always non-null; inspect canStart before calling startForegroundService()
     */
    public static CheckResult check(Context ctx, String source) {
        int api = Build.VERSION.SDK_INT;

        // ── 1. Fine/coarse location permission ───────────────────────────────
        boolean hasFine   = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION)
                                == PackageManager.PERMISSION_GRANTED;
        boolean hasCoarse = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION)
                                == PackageManager.PERMISSION_GRANTED;

        // ── 2. Background location (Android 10 / API 29+) ────────────────────
        boolean hasBg = true; // assumed granted on older Android
        if (api >= Build.VERSION_CODES.Q) {
            hasBg = ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_BACKGROUND_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
        }

        // ── 3. POST_NOTIFICATIONS (Android 13 / API 33+) ─────────────────────
        boolean hasNotif = true;
        if (api >= 33) {
            hasNotif = ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS)
                           == PackageManager.PERMISSION_GRANTED;
        }

        // ── 4. FOREGROUND_SERVICE_LOCATION (Android 14 / API 34+) ────────────
        // This is a normal (install-time) permission, but it must be declared in the manifest.
        // We verify it's actually granted to rule out manifest misconfiguration.
        boolean hasFgsLoc = true;
        if (api >= 34) {
            hasFgsLoc = ContextCompat.checkSelfPermission(ctx,
                            "android.permission.FOREGROUND_SERVICE_LOCATION")
                            == PackageManager.PERMISSION_GRANTED;
        }

        // ── 5. Location provider enabled ──────────────────────────────────────
        boolean locEnabled = false;
        try {
            LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
            if (lm != null) {
                if (api >= Build.VERSION_CODES.P) {
                    locEnabled = lm.isLocationEnabled();
                } else {
                    locEnabled = lm.isProviderEnabled(LocationManager.GPS_PROVIDER)
                              || lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER);
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "Could not check location provider: " + e.getMessage());
            locEnabled = true; // don't block on check failure — let FusedLocation handle it
        }

        // ── Determine block reason ─────────────────────────────────────────────
        String blockReason = "";

        if (!hasFine && !hasCoarse) {
            blockReason = "missing_location_permission";
        } else if (api >= Build.VERSION_CODES.Q && !hasBg) {
            // On Android 10+, background location is required for the service to get fixes
            // while the app is not in the foreground. Without it the FGS starts but gets
            // no location updates. We still allow starting (so the notification appears)
            // but record the gap so diagnostics panel shows the real issue.
            // NOTE: We do NOT block the start — the service will still function in foreground.
            // This is intentional: let the service start, it will just lack background fixes.
            Log.w(TAG, "[" + source + "] Background location not granted — service will only track in foreground");
        } else if (api >= 34 && !hasFgsLoc) {
            blockReason = "missing_FOREGROUND_SERVICE_LOCATION_permission_api34";
        }

        boolean canStart = blockReason.isEmpty();

        // ── Write diagnostics ─────────────────────────────────────────────────
        writeDiagnostics(ctx, source, canStart, blockReason,
                         hasFine, hasCoarse, hasBg, hasNotif, hasFgsLoc, locEnabled, api);

        if (!canStart) {
            Log.e(TAG, "[" + source + "] FGS start blocked: " + blockReason);
        } else {
            Log.d(TAG, "[" + source + "] FGS start allowed (api=" + api + ", fine=" + hasFine
                    + ", bg=" + hasBg + ", fgsLoc=" + hasFgsLoc + ")");
        }

        return new CheckResult(canStart, blockReason,
                               hasFine, hasCoarse, hasBg, hasNotif, hasFgsLoc,
                               locEnabled, api);
    }

    private static void writeDiagnostics(Context ctx, String source, boolean canStart,
                                          String blockReason,
                                          boolean hasFine, boolean hasCoarse, boolean hasBg,
                                          boolean hasNotif, boolean hasFgsLoc,
                                          boolean locEnabled, int api) {
        try {
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_FGS_START_BLOCKED,
                canStart ? "false" : "true");
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_FGS_START_BLOCKED_REASON,
                blockReason.isEmpty() ? "none" : blockReason);
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_FINE_LOCATION_GRANTED,
                String.valueOf(hasFine));
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_COARSE_LOCATION_GRANTED,
                String.valueOf(hasCoarse));
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_BACKGROUND_LOCATION_GRANTED,
                String.valueOf(hasBg));
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_NOTIFICATION_PERMISSION_GRANTED,
                String.valueOf(hasNotif));
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_FGS_LOCATION_PERMISSION,
                String.valueOf(hasFgsLoc));
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LOCATION_ENABLED,
                String.valueOf(locEnabled));
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_PERMISSION_GATE_RESULT,
                canStart ? "allowed:" + source : "blocked:" + source + ":" + blockReason);
            GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_LAST_FGS_START_ATTEMPT_AT,
                GpsDiagnostics.nowIso());
        } catch (Exception e) {
            Log.w(TAG, "Could not write permission diagnostics: " + e.getMessage());
        }
    }
}
