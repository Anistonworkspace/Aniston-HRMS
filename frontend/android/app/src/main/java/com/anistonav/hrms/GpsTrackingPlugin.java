package com.anistonav.hrms;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor Plugin — bridges JavaScript to the native GpsTrackingService.
 *
 * Critical contract:
 *   All credentials are persisted to SharedPreferences BEFORE startForegroundService()
 *   is called. This guarantees the watchdog, restart receiver, and boot receiver can
 *   read valid credentials even if the service is killed before it writes its own prefs.
 */
@CapacitorPlugin(name = "GpsTracking")
public class GpsTrackingPlugin extends Plugin {

    private static final String TAG = "GpsTrackingPlugin";

    // Production backend origin — used as fallback if JS passes a relative or empty URL
    private static final String PRODUCTION_BACKEND = "https://hr.anistonav.com";

    @PluginMethod
    public void start(PluginCall call) {
        String rawUrl       = call.getString("backendUrl", PRODUCTION_BACKEND);
        String authToken    = call.getString("authToken");
        String employeeId   = call.getString("employeeId");
        String orgId        = call.getString("orgId", "");
        String attendanceId = call.getString("attendanceId", "");
        int intervalMinutes = call.getInt("trackingIntervalMinutes", 60);

        if (authToken == null || authToken.isEmpty()) {
            call.reject("authToken is required");
            return;
        }
        if (employeeId == null || employeeId.isEmpty()) {
            call.reject("employeeId is required");
            return;
        }

        // Normalise URL — same logic as GpsTrackingService.normaliseBackendUrl()
        String backendUrl = normaliseUrl(rawUrl);

        Context ctx = getContext();

        // ── Persist ALL credentials to SharedPreferences BEFORE starting service ──
        // This is the single most important step for watchdog/restart reliability.
        // The service also calls saveToPrefs() on start, but writing here first
        // means the watchdog can read valid state even if the service is killed
        // within the first few milliseconds.
        ctx.getSharedPreferences(GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(GpsTrackingService.EXTRA_BACKEND_URL,              backendUrl)
            .putString(GpsTrackingService.EXTRA_TOKEN,                    authToken)
            .putString(GpsTrackingService.EXTRA_EMPLOYEE_ID,              employeeId)
            .putString(GpsTrackingService.EXTRA_ORG_ID,                   orgId)
            .putString(GpsTrackingService.EXTRA_ATTENDANCE_ID,            attendanceId)
            .putLong  (GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS, (long) Math.max(1, Math.min(240, intervalMinutes)) * 60_000L)
            .putBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED,    true)
            .apply();

        // Record diagnostic fields immediately
        String heartbeatUrl = backendUrl + "/api/attendance/gps-heartbeat";
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_API_BASE_URL,        backendUrl);
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_HEARTBEAT_URL,       heartbeatUrl);
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_BASE_URL_VALID,      backendUrl.startsWith("http") ? "true" : "false");
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_BASE_URL_SOURCE,     "plugin_start");
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_CREDENTIALS_PRESENT, "true");
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_TRACKING_ENABLED,    "true");
        GpsDiagnostics.recordEvent(ctx, GpsDiagnostics.KEY_NATIVE_SESSION_STORED_AT, GpsDiagnostics.nowIso());
        GpsDiagnostics.markCheckedIn(ctx);

        // Build service intent with all extras (service will also call saveToPrefs()
        // but having extras in the intent ensures a clean fresh start)
        Intent intent = new Intent(ctx, GpsTrackingService.class);
        intent.putExtra(GpsTrackingService.EXTRA_BACKEND_URL,              backendUrl);
        intent.putExtra(GpsTrackingService.EXTRA_TOKEN,                    authToken);
        intent.putExtra(GpsTrackingService.EXTRA_EMPLOYEE_ID,              employeeId);
        intent.putExtra(GpsTrackingService.EXTRA_ORG_ID,                   orgId);
        intent.putExtra(GpsTrackingService.EXTRA_ATTENDANCE_ID,            attendanceId);
        intent.putExtra(GpsTrackingService.EXTRA_TRACKING_INTERVAL_MINUTES, intervalMinutes);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start GPS service", e);
            call.reject("Failed to start GPS tracking: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_STOP);
        try {
            ctx.startService(intent);
        } catch (Exception e) {
            Log.w(TAG, "Stop service intent failed (already stopped?): " + e.getMessage());
        }
        GpsDiagnostics.markCheckedOut(ctx);
        // Flip tracking_enabled=false in prefs so watchdog/receiver know to stay idle
        ctx.getSharedPreferences(GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false)
            .apply();
        GpsWatchdogWorker.cancel(ctx);
        call.resolve();
    }

    @PluginMethod
    public void updateToken(PluginCall call) {
        String newToken = call.getString("token");
        if (newToken == null || newToken.isEmpty()) {
            call.reject("token is required");
            return;
        }
        Context ctx = getContext();
        ctx.getSharedPreferences(GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(GpsTrackingService.EXTRA_TOKEN, newToken)
            .apply();
        Intent intent = new Intent(ctx, GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_UPDATE_TOKEN);
        intent.putExtra(GpsTrackingService.EXTRA_TOKEN, newToken);
        try {
            ctx.startService(intent);
        } catch (Exception e) {
            Log.w(TAG, "updateToken intent failed: " + e.getMessage());
        }
        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", GpsTrackingService.sIsRunning);
        call.resolve(result);
    }

    @PluginMethod
    public void requestBatteryOptimizationExemption(PluginCall call) {
        Context ctx = getContext();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null && !pm.isIgnoringBatteryOptimizations(ctx.getPackageName())) {
                try {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + ctx.getPackageName()));
                    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    ctx.startActivity(intent);
                    JSObject r = new JSObject();
                    r.put("prompted", true);
                    call.resolve(r);
                } catch (Exception e) {
                    JSObject r = new JSObject();
                    r.put("prompted", false);
                    r.put("error", e.getMessage());
                    call.resolve(r);
                }
            } else {
                JSObject r = new JSObject();
                r.put("prompted", false);
                r.put("alreadyExempted", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
                call.resolve(r);
            }
        } else {
            JSObject r = new JSObject();
            r.put("prompted", false);
            r.put("reason", "API level < 23");
            call.resolve(r);
        }
    }

    @PluginMethod
    public void isBatteryOptimizationExempted(PluginCall call) {
        Context ctx = getContext();
        boolean exempted = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            exempted = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        } else {
            exempted = true;
        }
        JSObject result = new JSObject();
        result.put("exempted", exempted);
        call.resolve(result);
    }

    @PluginMethod
    public void getDiagnostics(PluginCall call) {
        String json = GpsDiagnostics.getDiagnosticsJson(getContext());
        try {
            JSObject result = new JSObject(json);
            call.resolve(result);
        } catch (Exception e) {
            JSObject r = new JSObject();
            r.put("raw", json);
            call.resolve(r);
        }
    }

    @PluginMethod
    public void updateInterval(PluginCall call) {
        int minutes = call.getInt("minutes", 60);
        Context ctx = getContext();
        Intent intent = new Intent(ctx, GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_UPDATE_INTERVAL);
        intent.putExtra(GpsTrackingService.EXTRA_TRACKING_INTERVAL_MINUTES, minutes);
        try {
            ctx.startService(intent);
        } catch (Exception e) {
            Log.w(TAG, "updateInterval intent failed: " + e.getMessage());
        }
        call.resolve();
    }

    // ── URL normalisation (mirrors GpsTrackingService.normaliseBackendUrl) ────

    private static String normaliseUrl(String raw) {
        if (raw == null || raw.trim().isEmpty()) return PRODUCTION_BACKEND;
        raw = raw.trim();
        while (raw.endsWith("/")) raw = raw.substring(0, raw.length() - 1);
        if (raw.startsWith("https://") || raw.startsWith("http://")) {
            if (raw.endsWith("/api")) raw = raw.substring(0, raw.length() - 4);
            return raw;
        }
        Log.e(TAG, "Relative backendUrl detected in plugin: '" + raw + "' — using production default");
        return PRODUCTION_BACKEND;
    }

}
