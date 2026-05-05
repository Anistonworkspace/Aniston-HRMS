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
 * All fields stored as strings in SharedPreferences("GpsTrackingDiagnostics").
 * getDiagnosticsJson() returns the full set as JSON for the React diagnostics panel.
 *
 * Security: auth tokens are NEVER stored here — only tokenPresent=true/false.
 */
public class GpsDiagnostics {

    private static final String PREFS_NAME = "GpsTrackingDiagnostics";

    // ── Service lifecycle ─────────────────────────────────────────────────────
    public static final String KEY_SERVICE_RUNNING              = "serviceRunning";
    public static final String KEY_LAST_SERVICE_START_AT        = "lastServiceStartAt";
    public static final String KEY_LAST_SERVICE_STOP_AT         = "lastServiceStopAt";
    public static final String KEY_LAST_SERVICE_STOP_REASON     = "lastServiceStopReason";
    public static final String KEY_LAST_ON_TASK_REMOVED_AT      = "lastOnTaskRemovedAt";
    public static final String KEY_FOREGROUND_NOTIFICATION_VISIBLE = "foregroundNotificationVisible";

    // ── URL & API config ──────────────────────────────────────────────────────
    public static final String KEY_API_BASE_URL                 = "apiBaseUrl";
    public static final String KEY_HEARTBEAT_URL                = "heartbeatUrl";
    public static final String KEY_BASE_URL_VALID               = "baseUrlValid";
    public static final String KEY_BASE_URL_SOURCE              = "baseUrlSource";

    // ── Credentials ───────────────────────────────────────────────────────────
    public static final String KEY_CREDENTIALS_PRESENT          = "credentialsPresent";
    public static final String KEY_MISSING_CREDENTIAL_FIELDS    = "missingCredentialFields";
    public static final String KEY_TRACKING_ENABLED             = "trackingEnabled";

    // ── Alarm / restart chain ─────────────────────────────────────────────────
    public static final String KEY_LAST_RESTART_ALARM_AT        = "lastRestartAlarmScheduledAt";
    public static final String KEY_LAST_RECEIVER_FIRED_AT       = "lastRestartReceiverFiredAt";
    public static final String KEY_LAST_RECEIVER_ACTION         = "lastRestartReceiverAction";
    public static final String KEY_LAST_RESTART_ATTEMPT_AT      = "lastRestartAttemptAt";
    public static final String KEY_LAST_RESTART_RESULT          = "lastRestartResult";
    public static final String KEY_RESTART_CREDENTIALS_PRESENT  = "restartCredentialsPresent";
    public static final String KEY_RESTART_SERVICE_INTENT_CREATED_AT = "restartServiceIntentCreatedAt";
    public static final String KEY_RESTART_START_FG_CALLED_AT   = "restartStartForegroundServiceCalledAt";
    public static final String KEY_RESTART_EXCEPTION            = "lastRestartException";

    // ── Watchdog ──────────────────────────────────────────────────────────────
    public static final String KEY_LAST_WATCHDOG_RUN_AT         = "lastWatchdogRunAt";
    public static final String KEY_LAST_WATCHDOG_RESULT         = "lastWatchdogResult";
    public static final String KEY_WATCHDOG_CREDENTIALS_PRESENT = "watchdogCredentialsPresent";
    public static final String KEY_WATCHDOG_EXCEPTION           = "watchdogException";

    // ── GPS & heartbeat ───────────────────────────────────────────────────────
    public static final String KEY_LAST_GPS_POINT_AT            = "lastGpsPointAt";
    public static final String KEY_LAST_HEARTBEAT_AT            = "lastHeartbeatAt";
    public static final String KEY_LAST_LOCATION_REQUEST_AT     = "lastLocationRequestAt";
    public static final String KEY_LAST_LOCATION_RECEIVED_AT    = "lastLocationReceivedAt";

    // ── HTTP ──────────────────────────────────────────────────────────────────
    public static final String KEY_LAST_BACKEND_STATUS_CODE     = "lastBackendStatusCode";
    public static final String KEY_LAST_HTTP_REQUEST_AT         = "lastHttpRequestAt";
    public static final String KEY_LAST_HTTP_RESPONSE_AT        = "lastHttpResponseAt";
    public static final String KEY_LAST_HTTP_REQUEST_URL        = "lastHttpRequestUrl";
    public static final String KEY_LAST_ERROR_MESSAGE           = "lastErrorMessage";

    // ── Device info ───────────────────────────────────────────────────────────
    public static final String KEY_MANUFACTURER                 = "manufacturer";
    public static final String KEY_BRAND                        = "brand";
    public static final String KEY_MODEL                        = "model";
    public static final String KEY_SDK_INT                      = "sdkInt";

    // ── Session state ─────────────────────────────────────────────────────────
    public static final String KEY_SESSION_STATE                = "sessionState";
    public static final String KEY_NATIVE_SESSION_STORED_AT     = "nativeSessionStoredAt";
    public static final String KEY_NATIVE_SESSION_CLEARED_AT    = "nativeSessionClearedAt";

    // ── Core write ────────────────────────────────────────────────────────────

    public static void recordEvent(Context ctx, String key, String value) {
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(key, value != null ? value : "")
            .apply();
    }

    public static void recordError(Context ctx, String message) {
        recordEvent(ctx, KEY_LAST_ERROR_MESSAGE, message != null ? message : "unknown_error");
    }

    public static void recordDeviceInfo(Context ctx) {
        SharedPreferences.Editor ed = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit();
        ed.putString(KEY_MANUFACTURER, Build.MANUFACTURER != null ? Build.MANUFACTURER.toLowerCase(Locale.US) : "");
        ed.putString(KEY_BRAND,        Build.BRAND        != null ? Build.BRAND.toLowerCase(Locale.US)        : "");
        ed.putString(KEY_MODEL,        Build.MODEL        != null ? Build.MODEL                               : "");
        ed.putString(KEY_SDK_INT,      String.valueOf(Build.VERSION.SDK_INT));
        ed.apply();
    }

    // ── Session helpers ───────────────────────────────────────────────────────

    public static void markCheckedIn(Context ctx) {
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(KEY_SESSION_STATE,         "checked_in")
            .putString(KEY_LAST_SERVICE_START_AT, nowIso())
            .apply();
    }

    public static void markCheckedOut(Context ctx) {
        ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE).edit()
            .putString(KEY_SESSION_STATE,            "checked_out")
            .putString(KEY_LAST_SERVICE_STOP_AT,     nowIso())
            .putString(KEY_LAST_SERVICE_STOP_REASON, "employee_checkout")
            .putString(KEY_TRACKING_ENABLED,         "false")
            .apply();
    }

    // ── Timestamp ─────────────────────────────────────────────────────────────

    public static String nowIso() {
        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        return sdf.format(new Date());
    }

    // ── JSON export (all fields, tokens never exposed) ────────────────────────

    public static String getDiagnosticsJson(Context ctx) {
        SharedPreferences p = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        JSONObject obj = new JSONObject();
        try {
            // Service lifecycle
            obj.put(KEY_SERVICE_RUNNING,              p.getString(KEY_SERVICE_RUNNING,              ""));
            obj.put(KEY_LAST_SERVICE_START_AT,        p.getString(KEY_LAST_SERVICE_START_AT,        ""));
            obj.put(KEY_LAST_SERVICE_STOP_AT,         p.getString(KEY_LAST_SERVICE_STOP_AT,         ""));
            obj.put(KEY_LAST_SERVICE_STOP_REASON,     p.getString(KEY_LAST_SERVICE_STOP_REASON,     ""));
            obj.put(KEY_LAST_ON_TASK_REMOVED_AT,      p.getString(KEY_LAST_ON_TASK_REMOVED_AT,      ""));
            obj.put(KEY_FOREGROUND_NOTIFICATION_VISIBLE, p.getString(KEY_FOREGROUND_NOTIFICATION_VISIBLE, ""));

            // URL & API config
            obj.put(KEY_API_BASE_URL,                 p.getString(KEY_API_BASE_URL,                 ""));
            obj.put(KEY_HEARTBEAT_URL,                p.getString(KEY_HEARTBEAT_URL,                ""));
            obj.put(KEY_BASE_URL_VALID,               p.getString(KEY_BASE_URL_VALID,               ""));
            obj.put(KEY_BASE_URL_SOURCE,              p.getString(KEY_BASE_URL_SOURCE,              ""));

            // Credentials (no token value — only presence flag)
            obj.put(KEY_CREDENTIALS_PRESENT,          p.getString(KEY_CREDENTIALS_PRESENT,          ""));
            obj.put(KEY_MISSING_CREDENTIAL_FIELDS,    p.getString(KEY_MISSING_CREDENTIAL_FIELDS,    ""));
            obj.put(KEY_TRACKING_ENABLED,             p.getString(KEY_TRACKING_ENABLED,             ""));

            // Alarm / restart chain
            obj.put(KEY_LAST_RESTART_ALARM_AT,        p.getString(KEY_LAST_RESTART_ALARM_AT,        ""));
            obj.put(KEY_LAST_RECEIVER_FIRED_AT,       p.getString(KEY_LAST_RECEIVER_FIRED_AT,       ""));
            obj.put(KEY_LAST_RECEIVER_ACTION,         p.getString(KEY_LAST_RECEIVER_ACTION,         ""));
            obj.put(KEY_LAST_RESTART_ATTEMPT_AT,      p.getString(KEY_LAST_RESTART_ATTEMPT_AT,      ""));
            obj.put(KEY_LAST_RESTART_RESULT,          p.getString(KEY_LAST_RESTART_RESULT,          ""));
            obj.put(KEY_RESTART_CREDENTIALS_PRESENT,  p.getString(KEY_RESTART_CREDENTIALS_PRESENT,  ""));
            obj.put(KEY_RESTART_SERVICE_INTENT_CREATED_AT, p.getString(KEY_RESTART_SERVICE_INTENT_CREATED_AT, ""));
            obj.put(KEY_RESTART_START_FG_CALLED_AT,   p.getString(KEY_RESTART_START_FG_CALLED_AT,   ""));
            obj.put(KEY_RESTART_EXCEPTION,            p.getString(KEY_RESTART_EXCEPTION,            ""));

            // Watchdog
            obj.put(KEY_LAST_WATCHDOG_RUN_AT,         p.getString(KEY_LAST_WATCHDOG_RUN_AT,         ""));
            obj.put(KEY_LAST_WATCHDOG_RESULT,         p.getString(KEY_LAST_WATCHDOG_RESULT,         ""));
            obj.put(KEY_WATCHDOG_CREDENTIALS_PRESENT, p.getString(KEY_WATCHDOG_CREDENTIALS_PRESENT, ""));
            obj.put(KEY_WATCHDOG_EXCEPTION,           p.getString(KEY_WATCHDOG_EXCEPTION,           ""));

            // GPS & heartbeat
            obj.put(KEY_LAST_GPS_POINT_AT,            p.getString(KEY_LAST_GPS_POINT_AT,            ""));
            obj.put(KEY_LAST_HEARTBEAT_AT,            p.getString(KEY_LAST_HEARTBEAT_AT,            ""));
            obj.put(KEY_LAST_LOCATION_REQUEST_AT,     p.getString(KEY_LAST_LOCATION_REQUEST_AT,     ""));
            obj.put(KEY_LAST_LOCATION_RECEIVED_AT,    p.getString(KEY_LAST_LOCATION_RECEIVED_AT,    ""));

            // HTTP
            obj.put(KEY_LAST_BACKEND_STATUS_CODE,     p.getString(KEY_LAST_BACKEND_STATUS_CODE,     ""));
            obj.put(KEY_LAST_HTTP_REQUEST_AT,         p.getString(KEY_LAST_HTTP_REQUEST_AT,         ""));
            obj.put(KEY_LAST_HTTP_RESPONSE_AT,        p.getString(KEY_LAST_HTTP_RESPONSE_AT,        ""));
            obj.put(KEY_LAST_HTTP_REQUEST_URL,        p.getString(KEY_LAST_HTTP_REQUEST_URL,        ""));
            obj.put(KEY_LAST_ERROR_MESSAGE,           p.getString(KEY_LAST_ERROR_MESSAGE,           ""));

            // Device
            obj.put(KEY_MANUFACTURER,                 p.getString(KEY_MANUFACTURER,                 ""));
            obj.put(KEY_BRAND,                        p.getString(KEY_BRAND,                        ""));
            obj.put(KEY_MODEL,                        p.getString(KEY_MODEL,                        ""));
            obj.put(KEY_SDK_INT,                      p.getString(KEY_SDK_INT,                      ""));

            // Session
            obj.put(KEY_SESSION_STATE,                p.getString(KEY_SESSION_STATE,                "unknown"));
            obj.put(KEY_NATIVE_SESSION_STORED_AT,     p.getString(KEY_NATIVE_SESSION_STORED_AT,     ""));
            obj.put(KEY_NATIVE_SESSION_CLEARED_AT,    p.getString(KEY_NATIVE_SESSION_CLEARED_AT,    ""));

            // Token presence flag — never expose the actual token
            SharedPreferences trackPrefs = ctx.getSharedPreferences(
                GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE);
            String token = trackPrefs.getString(GpsTrackingService.EXTRA_TOKEN, null);
            obj.put("tokenPresent", token != null && !token.isEmpty());

        } catch (Exception e) {
            try { obj.put("_error", e.getMessage()); } catch (Exception ignored) {}
        }
        return obj.toString();
    }
}
