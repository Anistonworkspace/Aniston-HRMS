package com.anistonav.hrms;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONObject;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * GpsDiagnostics — static utility for writing/reading GPS service diagnostic events.
 *
 * All fields are stored as strings in SharedPreferences under "GpsTrackingDiagnostics".
 * getDiagnosticsJson() returns the full set as a JSON object for display in the
 * React native diagnostics panel.
 */
public class GpsDiagnostics {

    private static final String PREFS_NAME = "GpsTrackingDiagnostics";

    // ── Field keys ────────────────────────────────────────────────────────────

    public static final String KEY_SERVICE_RUNNING              = "serviceRunning";
    public static final String KEY_LAST_SERVICE_START_AT        = "lastServiceStartAt";
    public static final String KEY_LAST_SERVICE_STOP_AT         = "lastServiceStopAt";
    public static final String KEY_LAST_SERVICE_STOP_REASON     = "lastServiceStopReason";
    public static final String KEY_LAST_ON_TASK_REMOVED_AT      = "lastOnTaskRemovedAt";
    public static final String KEY_LAST_RESTART_ALARM_AT        = "lastRestartAlarmScheduledAt";
    public static final String KEY_LAST_RECEIVER_FIRED_AT       = "lastRestartReceiverFiredAt";
    public static final String KEY_LAST_RECEIVER_ACTION         = "lastRestartReceiverAction";
    public static final String KEY_LAST_RESTART_ATTEMPT_AT      = "lastRestartAttemptAt";
    public static final String KEY_LAST_RESTART_RESULT          = "lastRestartResult";
    public static final String KEY_LAST_WATCHDOG_RUN_AT         = "lastWatchdogRunAt";
    public static final String KEY_LAST_WATCHDOG_RESULT         = "lastWatchdogResult";
    public static final String KEY_LAST_GPS_POINT_AT            = "lastGpsPointAt";
    public static final String KEY_LAST_HEARTBEAT_AT            = "lastHeartbeatAt";
    public static final String KEY_LAST_BACKEND_STATUS_CODE     = "lastBackendStatusCode";
    public static final String KEY_LAST_ERROR_MESSAGE           = "lastErrorMessage";
    public static final String KEY_MANUFACTURER                 = "manufacturer";
    public static final String KEY_BRAND                        = "brand";
    public static final String KEY_MODEL                        = "model";
    public static final String KEY_SDK_INT                      = "sdkInt";
    public static final String KEY_SESSION_STATE                = "sessionState";

    // ── Core write/read ───────────────────────────────────────────────────────

    public static void recordEvent(Context ctx, String key, String value) {
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(key, value != null ? value : "")
            .apply();
    }

    public static void recordError(Context ctx, String message) {
        recordEvent(ctx, KEY_LAST_ERROR_MESSAGE, message != null ? message : "unknown error");
    }

    public static void recordDeviceInfo(Context ctx) {
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        ed.putString(KEY_MANUFACTURER, Build.MANUFACTURER != null ? Build.MANUFACTURER.toLowerCase(Locale.US) : "");
        ed.putString(KEY_BRAND,        Build.BRAND        != null ? Build.BRAND.toLowerCase(Locale.US)        : "");
        ed.putString(KEY_MODEL,        Build.MODEL        != null ? Build.MODEL                                : "");
        ed.putString(KEY_SDK_INT,      String.valueOf(Build.VERSION.SDK_INT));
        ed.apply();
    }

    // ── Session helpers ───────────────────────────────────────────────────────

    public static void markCheckedIn(Context ctx) {
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        ed.putString(KEY_SESSION_STATE,         "checked_in");
        ed.putString(KEY_LAST_SERVICE_START_AT, nowIso());
        ed.apply();
    }

    public static void markCheckedOut(Context ctx) {
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        ed.putString(KEY_SESSION_STATE,          "checked_out");
        ed.putString(KEY_LAST_SERVICE_STOP_AT,   nowIso());
        ed.putString(KEY_LAST_SERVICE_STOP_REASON, "employee_checkout");
        ed.apply();
    }

    // ── Timestamp helper ──────────────────────────────────────────────────────

    public static String nowIso() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }

    // ── JSON export ───────────────────────────────────────────────────────────

    public static String getDiagnosticsJson(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONObject obj = new JSONObject();
        try {
            obj.put(KEY_SERVICE_RUNNING,          prefs.getString(KEY_SERVICE_RUNNING,          ""));
            obj.put(KEY_LAST_SERVICE_START_AT,    prefs.getString(KEY_LAST_SERVICE_START_AT,    ""));
            obj.put(KEY_LAST_SERVICE_STOP_AT,     prefs.getString(KEY_LAST_SERVICE_STOP_AT,     ""));
            obj.put(KEY_LAST_SERVICE_STOP_REASON, prefs.getString(KEY_LAST_SERVICE_STOP_REASON, ""));
            obj.put(KEY_LAST_ON_TASK_REMOVED_AT,  prefs.getString(KEY_LAST_ON_TASK_REMOVED_AT,  ""));
            obj.put(KEY_LAST_RESTART_ALARM_AT,    prefs.getString(KEY_LAST_RESTART_ALARM_AT,    ""));
            obj.put(KEY_LAST_RECEIVER_FIRED_AT,   prefs.getString(KEY_LAST_RECEIVER_FIRED_AT,   ""));
            obj.put(KEY_LAST_RECEIVER_ACTION,     prefs.getString(KEY_LAST_RECEIVER_ACTION,     ""));
            obj.put(KEY_LAST_RESTART_ATTEMPT_AT,  prefs.getString(KEY_LAST_RESTART_ATTEMPT_AT,  ""));
            obj.put(KEY_LAST_RESTART_RESULT,      prefs.getString(KEY_LAST_RESTART_RESULT,      ""));
            obj.put(KEY_LAST_WATCHDOG_RUN_AT,     prefs.getString(KEY_LAST_WATCHDOG_RUN_AT,     ""));
            obj.put(KEY_LAST_WATCHDOG_RESULT,     prefs.getString(KEY_LAST_WATCHDOG_RESULT,     ""));
            obj.put(KEY_LAST_GPS_POINT_AT,        prefs.getString(KEY_LAST_GPS_POINT_AT,        ""));
            obj.put(KEY_LAST_HEARTBEAT_AT,        prefs.getString(KEY_LAST_HEARTBEAT_AT,        ""));
            obj.put(KEY_LAST_BACKEND_STATUS_CODE, prefs.getString(KEY_LAST_BACKEND_STATUS_CODE, ""));
            obj.put(KEY_LAST_ERROR_MESSAGE,       prefs.getString(KEY_LAST_ERROR_MESSAGE,       ""));
            obj.put(KEY_MANUFACTURER,             prefs.getString(KEY_MANUFACTURER,             ""));
            obj.put(KEY_BRAND,                    prefs.getString(KEY_BRAND,                    ""));
            obj.put(KEY_MODEL,                    prefs.getString(KEY_MODEL,                    ""));
            obj.put(KEY_SDK_INT,                  prefs.getString(KEY_SDK_INT,                  ""));
            obj.put(KEY_SESSION_STATE,            prefs.getString(KEY_SESSION_STATE,            "unknown"));
        } catch (Exception e) {
            try { obj.put("_error", e.getMessage()); } catch (Exception ignored) {}
        }
        return obj.toString();
    }
}
