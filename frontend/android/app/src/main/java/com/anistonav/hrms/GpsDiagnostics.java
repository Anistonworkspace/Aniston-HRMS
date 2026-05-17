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
    public static final String KEY_WATCHDOG_MISSING_FIELDS      = "watchdogMissingFields";
    public static final String KEY_WATCHDOG_RESTART_ATTEMPT_AT  = "watchdogRestartAttemptAt";
    public static final String KEY_WATCHDOG_EXCEPTION           = "watchdogException";

    // ── GPS & heartbeat ───────────────────────────────────────────────────────
    public static final String KEY_LAST_GPS_POINT_AT            = "lastGpsPointAt";
    public static final String KEY_LAST_HEARTBEAT_AT            = "lastHeartbeatAt";
    public static final String KEY_LAST_LOCATION_REQUEST_AT     = "lastLocationRequestAt";
    public static final String KEY_LAST_LOCATION_RECEIVED_AT    = "lastLocationReceivedAt";

    // ── GPS interval ──────────────────────────────────────────────────────────
    public static final String KEY_GPS_INTERVAL_MS              = "gpsIntervalMs";
    public static final String KEY_GPS_INTERVAL_LABEL           = "gpsIntervalLabel";
    public static final String KEY_GPS_INTERVAL_SOURCE          = "gpsIntervalSource";
    public static final String KEY_LAST_INTERVAL_UPDATED_AT     = "lastIntervalUpdatedAt";
    public static final String KEY_NEXT_LOCATION_DUE_AT         = "nextLocationDueAt";

    // ── Permissions ───────────────────────────────────────────────────────────
    public static final String KEY_LOCATION_PERM_FINE           = "locationPermissionFine";
    public static final String KEY_LOCATION_PERM_BACKGROUND     = "locationPermissionBackground";
    public static final String KEY_BATTERY_OPT_IGNORED          = "batteryOptimizationIgnored";

    // ── HTTP ──────────────────────────────────────────────────────────────────
    public static final String KEY_LAST_BACKEND_STATUS_CODE     = "lastBackendStatusCode";
    public static final String KEY_LAST_HTTP_REQUEST_AT         = "lastHttpRequestAt";
    public static final String KEY_LAST_HTTP_RESPONSE_AT        = "lastHttpResponseAt";
    public static final String KEY_LAST_HTTP_REQUEST_URL        = "lastHttpRequestUrl";
    public static final String KEY_LAST_ERROR_MESSAGE           = "lastErrorMessage";
    public static final String KEY_CONSECUTIVE_403_COUNT        = "consecutive403Count";
    public static final String KEY_LAST_403_AT                  = "last403At";
    public static final String KEY_TOKEN_RETRY_SOURCE           = "tokenRetrySource";
    public static final String KEY_TOKEN_RETRY_ATTEMPTED_AT     = "tokenRetryAttemptedAt";
    public static final String KEY_GPS_CONSENT_REQUIRED         = "gpsConsentRequired";

    // ── FGS start / permission gate ───────────────────────────────────────────
    public static final String KEY_LAST_FGS_START_ATTEMPT_AT        = "lastFgsStartAttemptAt";
    public static final String KEY_LAST_FGS_START_RESULT            = "lastFgsStartResult";
    public static final String KEY_LAST_FGS_START_EXCEPTION         = "lastFgsStartException";
    public static final String KEY_FGS_START_BLOCKED                = "fgsStartBlocked";
    public static final String KEY_FGS_START_BLOCKED_REASON         = "fgsStartBlockedReason";
    public static final String KEY_FINE_LOCATION_GRANTED            = "fineLocationGranted";
    public static final String KEY_COARSE_LOCATION_GRANTED          = "coarseLocationGranted";
    public static final String KEY_BACKGROUND_LOCATION_GRANTED      = "backgroundLocationGranted";
    public static final String KEY_NOTIFICATION_PERMISSION_GRANTED  = "notificationPermissionGranted";
    public static final String KEY_FGS_LOCATION_PERMISSION          = "foregroundServiceLocationPermission";
    public static final String KEY_LOCATION_ENABLED                 = "locationEnabled";
    public static final String KEY_PERMISSION_GATE_RESULT           = "permissionGateResult";

    // ── Trail POST diagnostics ─────────────────────────────────────────────────
    public static final String KEY_LAST_TRAIL_POST_RESULT       = "lastTrailPostResult";
    public static final String KEY_LAST_TRAIL_POST_STATUS_CODE  = "lastTrailPostStatusCode";
    public static final String KEY_LAST_TRAIL_POST_ACCEPTED     = "lastTrailPostAccepted";

    // ── Device info ───────────────────────────────────────────────────────────
    public static final String KEY_MANUFACTURER                 = "manufacturer";
    public static final String KEY_BRAND                        = "brand";
    public static final String KEY_MODEL                        = "model";
    public static final String KEY_SDK_INT                      = "sdkInt";

    // ── Session state ─────────────────────────────────────────────────────────
    public static final String KEY_SESSION_STATE                = "sessionState";
    public static final String KEY_NATIVE_SESSION_STORED_AT     = "nativeSessionStoredAt";
    public static final String KEY_NATIVE_SESSION_CLEARED_AT    = "nativeSessionClearedAt";

    // ── Force-stop / OEM kill detection ──────────────────────────────────────
    public static final String KEY_SUSPECTED_FORCE_STOP         = "suspectedForceStop";
    public static final String KEY_SUSPECTED_FORCE_STOP_AT      = "suspectedForceStopAt";
    public static final String KEY_OEM_AUTO_START_NOT_FOUND     = "oemAutoStartNotFound";
    public static final String KEY_GPS_STOP_REASON              = "gpsStopReason";

    // ── Boot / DirectBoot / unlock chain ──────────────────────────────────────
    public static final String KEY_DIRECT_BOOT_LOCKED                = "directBootLocked";
    public static final String KEY_USER_UNLOCKED_RECEIVER_REGISTERED = "userUnlockedReceiverRegistered";
    public static final String KEY_RESTART_DEFERRED_UNTIL_UNLOCK     = "restartDeferredUntilUnlock";

    // ── Point skip diagnostics ────────────────────────────────────────────────
    public static final String KEY_LAST_POINT_SKIP_REASON       = "lastPointSkipReason";
    public static final String KEY_LAST_POINT_SKIP_AT           = "lastPointSkipAt";
    public static final String KEY_NEXT_GPS_CAPTURE_AT          = "nextGpsCaptureAt";

    // ── Alarm diagnostics ─────────────────────────────────────────────────────
    public static final String KEY_EXACT_ALARM_GRANTED          = "exactAlarmGranted";
    public static final String KEY_LAST_ALARM_TYPE              = "lastAlarmType";
    public static final String KEY_LAST_ALARM_SCHEDULE_RESULT   = "lastAlarmScheduleResult";
    public static final String KEY_LAST_ALARM_SCHEDULE_ERROR    = "lastAlarmScheduleError";

    // ── Per-component credential snapshot ─────────────────────────────────────
    // Each component writes its view of credentials so we can compare them.
    // Only presence flags (true/false/length) — never actual values.
    public static final String KEY_ATTENDANCE_ID_PRESENT        = "attendanceIdPresent";
    public static final String KEY_ATTENDANCE_ID_FIRST8         = "attendanceIdFirst8";
    public static final String KEY_PLUGIN_CRED_SNAPSHOT_AT      = "pluginCredSnapshotAt";
    public static final String KEY_SERVICE_CRED_SNAPSHOT_AT     = "serviceCredSnapshotAt";
    public static final String KEY_RECEIVER_CRED_SNAPSHOT_AT    = "receiverCredSnapshotAt";
    public static final String KEY_WATCHDOG_CRED_SNAPSHOT_AT    = "watchdogCredSnapshotAt";

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

    // ── Interval label helper ─────────────────────────────────────────────────

    public static String intervalMsToLabel(long ms) {
        if (ms <= 0) return "";
        long mins = ms / 60000;
        if (mins < 1)  return ms + "ms";
        if (mins == 1) return "Every 1 min";
        if (mins < 60) return "Every " + mins + " mins";
        long hrs = mins / 60;
        return hrs == 1 ? "Every 1 hr" : "Every " + hrs + " hrs";
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
            obj.put(KEY_WATCHDOG_MISSING_FIELDS,      p.getString(KEY_WATCHDOG_MISSING_FIELDS,      ""));
            obj.put(KEY_WATCHDOG_RESTART_ATTEMPT_AT,  p.getString(KEY_WATCHDOG_RESTART_ATTEMPT_AT,  ""));
            obj.put(KEY_WATCHDOG_EXCEPTION,           p.getString(KEY_WATCHDOG_EXCEPTION,           ""));

            // GPS & heartbeat
            obj.put(KEY_LAST_GPS_POINT_AT,            p.getString(KEY_LAST_GPS_POINT_AT,            ""));
            obj.put(KEY_LAST_HEARTBEAT_AT,            p.getString(KEY_LAST_HEARTBEAT_AT,            ""));
            obj.put(KEY_LAST_LOCATION_REQUEST_AT,     p.getString(KEY_LAST_LOCATION_REQUEST_AT,     ""));
            obj.put(KEY_LAST_LOCATION_RECEIVED_AT,    p.getString(KEY_LAST_LOCATION_RECEIVED_AT,    ""));

            // GPS interval — read from GpsSessionStore (encrypted prefs); plain prefs
            // no longer holds this key after migrateFromPlain().
            GpsSessionStore.Session sess = GpsSessionStore.getSession(ctx);
            long intervalMs = (sess != null && sess.gpsIntervalMs > 0) ? sess.gpsIntervalMs : -1;
            obj.put(KEY_GPS_INTERVAL_MS, intervalMs > 0 ? String.valueOf(intervalMs) : "");
            obj.put(KEY_GPS_INTERVAL_LABEL, intervalMsToLabel(intervalMs));
            obj.put(KEY_GPS_INTERVAL_SOURCE,          p.getString(KEY_GPS_INTERVAL_SOURCE,          ""));
            obj.put(KEY_LAST_INTERVAL_UPDATED_AT,     p.getString(KEY_LAST_INTERVAL_UPDATED_AT,     ""));
            obj.put(KEY_NEXT_LOCATION_DUE_AT,         p.getString(KEY_NEXT_LOCATION_DUE_AT,         ""));

            // Permissions
            // KEY_LOCATION_PERM_FINE and KEY_LOCATION_PERM_BACKGROUND are never written
            // (GpsPermissionGuard writes to KEY_FINE_LOCATION_GRANTED and KEY_BACKGROUND_LOCATION_GRANTED
            // instead). Removed from output to avoid emitting stale empty strings.
            obj.put(KEY_BATTERY_OPT_IGNORED,          p.getString(KEY_BATTERY_OPT_IGNORED,          ""));

            // HTTP
            obj.put(KEY_LAST_BACKEND_STATUS_CODE,     p.getString(KEY_LAST_BACKEND_STATUS_CODE,     ""));
            obj.put(KEY_LAST_HTTP_REQUEST_AT,         p.getString(KEY_LAST_HTTP_REQUEST_AT,         ""));
            obj.put(KEY_LAST_HTTP_RESPONSE_AT,        p.getString(KEY_LAST_HTTP_RESPONSE_AT,        ""));
            obj.put(KEY_LAST_HTTP_REQUEST_URL,        p.getString(KEY_LAST_HTTP_REQUEST_URL,        ""));
            obj.put(KEY_LAST_ERROR_MESSAGE,           p.getString(KEY_LAST_ERROR_MESSAGE,           ""));
            obj.put(KEY_CONSECUTIVE_403_COUNT,        p.getString(KEY_CONSECUTIVE_403_COUNT,        "0"));
            obj.put(KEY_LAST_403_AT,                  p.getString(KEY_LAST_403_AT,                  ""));
            obj.put(KEY_TOKEN_RETRY_SOURCE,           p.getString(KEY_TOKEN_RETRY_SOURCE,           ""));
            obj.put(KEY_TOKEN_RETRY_ATTEMPTED_AT,     p.getString(KEY_TOKEN_RETRY_ATTEMPTED_AT,     ""));
            obj.put(KEY_GPS_CONSENT_REQUIRED,         p.getString(KEY_GPS_CONSENT_REQUIRED,         "false"));

            // FGS start / permission gate
            obj.put(KEY_LAST_FGS_START_ATTEMPT_AT,       p.getString(KEY_LAST_FGS_START_ATTEMPT_AT,       ""));
            obj.put(KEY_LAST_FGS_START_RESULT,           p.getString(KEY_LAST_FGS_START_RESULT,           ""));
            obj.put(KEY_LAST_FGS_START_EXCEPTION,        p.getString(KEY_LAST_FGS_START_EXCEPTION,        ""));
            obj.put(KEY_FGS_START_BLOCKED,               p.getString(KEY_FGS_START_BLOCKED,               "false"));
            obj.put(KEY_FGS_START_BLOCKED_REASON,        p.getString(KEY_FGS_START_BLOCKED_REASON,        ""));
            obj.put(KEY_FINE_LOCATION_GRANTED,           p.getString(KEY_FINE_LOCATION_GRANTED,           ""));
            obj.put(KEY_COARSE_LOCATION_GRANTED,         p.getString(KEY_COARSE_LOCATION_GRANTED,         ""));
            obj.put(KEY_BACKGROUND_LOCATION_GRANTED,     p.getString(KEY_BACKGROUND_LOCATION_GRANTED,     ""));
            obj.put(KEY_NOTIFICATION_PERMISSION_GRANTED, p.getString(KEY_NOTIFICATION_PERMISSION_GRANTED, ""));
            obj.put(KEY_FGS_LOCATION_PERMISSION,         p.getString(KEY_FGS_LOCATION_PERMISSION,         ""));
            obj.put(KEY_LOCATION_ENABLED,                p.getString(KEY_LOCATION_ENABLED,                ""));
            obj.put(KEY_PERMISSION_GATE_RESULT,          p.getString(KEY_PERMISSION_GATE_RESULT,          ""));

            // Trail POST diagnostics
            obj.put(KEY_LAST_TRAIL_POST_RESULT,      p.getString(KEY_LAST_TRAIL_POST_RESULT,      ""));
            obj.put(KEY_LAST_TRAIL_POST_STATUS_CODE, p.getString(KEY_LAST_TRAIL_POST_STATUS_CODE, ""));
            obj.put(KEY_LAST_TRAIL_POST_ACCEPTED,    p.getString(KEY_LAST_TRAIL_POST_ACCEPTED,    ""));

            // Device
            obj.put(KEY_MANUFACTURER,                 p.getString(KEY_MANUFACTURER,                 ""));
            obj.put(KEY_BRAND,                        p.getString(KEY_BRAND,                        ""));
            obj.put(KEY_MODEL,                        p.getString(KEY_MODEL,                        ""));
            obj.put(KEY_SDK_INT,                      p.getString(KEY_SDK_INT,                      ""));

            // Session
            obj.put(KEY_SESSION_STATE,                p.getString(KEY_SESSION_STATE,                "unknown"));
            obj.put(KEY_NATIVE_SESSION_STORED_AT,     p.getString(KEY_NATIVE_SESSION_STORED_AT,     ""));
            obj.put(KEY_NATIVE_SESSION_CLEARED_AT,    p.getString(KEY_NATIVE_SESSION_CLEARED_AT,    ""));

            // Force-stop / OEM kill detection
            obj.put(KEY_SUSPECTED_FORCE_STOP,         p.getString(KEY_SUSPECTED_FORCE_STOP,         "false"));
            obj.put(KEY_SUSPECTED_FORCE_STOP_AT,      p.getString(KEY_SUSPECTED_FORCE_STOP_AT,      ""));
            obj.put(KEY_OEM_AUTO_START_NOT_FOUND,     p.getString(KEY_OEM_AUTO_START_NOT_FOUND,     ""));
            obj.put(KEY_GPS_STOP_REASON,              p.getString(KEY_GPS_STOP_REASON,              ""));

            // Point skip diagnostics
            obj.put(KEY_LAST_POINT_SKIP_REASON,       p.getString(KEY_LAST_POINT_SKIP_REASON,       ""));
            obj.put(KEY_LAST_POINT_SKIP_AT,           p.getString(KEY_LAST_POINT_SKIP_AT,           ""));
            obj.put(KEY_NEXT_GPS_CAPTURE_AT,          p.getString(KEY_NEXT_GPS_CAPTURE_AT,          ""));

            // Alarm diagnostics
            obj.put(KEY_EXACT_ALARM_GRANTED,          p.getString(KEY_EXACT_ALARM_GRANTED,          ""));
            obj.put(KEY_LAST_ALARM_TYPE,              p.getString(KEY_LAST_ALARM_TYPE,              ""));
            obj.put(KEY_LAST_ALARM_SCHEDULE_RESULT,   p.getString(KEY_LAST_ALARM_SCHEDULE_RESULT,   ""));
            obj.put(KEY_LAST_ALARM_SCHEDULE_ERROR,    p.getString(KEY_LAST_ALARM_SCHEDULE_ERROR,    ""));

            // Boot / DirectBoot / unlock chain
            obj.put(KEY_DIRECT_BOOT_LOCKED,                p.getString(KEY_DIRECT_BOOT_LOCKED,                "false"));
            obj.put(KEY_USER_UNLOCKED_RECEIVER_REGISTERED, p.getString(KEY_USER_UNLOCKED_RECEIVER_REGISTERED, ""));
            obj.put(KEY_RESTART_DEFERRED_UNTIL_UNLOCK,     p.getString(KEY_RESTART_DEFERRED_UNTIL_UNLOCK,     "false"));

            // Per-component credential snapshot
            obj.put(KEY_ATTENDANCE_ID_PRESENT,        p.getString(KEY_ATTENDANCE_ID_PRESENT,        ""));
            obj.put(KEY_ATTENDANCE_ID_FIRST8,         p.getString(KEY_ATTENDANCE_ID_FIRST8,         ""));
            obj.put(KEY_PLUGIN_CRED_SNAPSHOT_AT,      p.getString(KEY_PLUGIN_CRED_SNAPSHOT_AT,      ""));
            obj.put(KEY_SERVICE_CRED_SNAPSHOT_AT,     p.getString(KEY_SERVICE_CRED_SNAPSHOT_AT,     ""));
            obj.put(KEY_RECEIVER_CRED_SNAPSHOT_AT,    p.getString(KEY_RECEIVER_CRED_SNAPSHOT_AT,    ""));
            obj.put(KEY_WATCHDOG_CRED_SNAPSHOT_AT,    p.getString(KEY_WATCHDOG_CRED_SNAPSHOT_AT,    ""));

            // Token presence flag — read from GpsSessionStore (encrypted); never expose value
            String token = (sess != null) ? sess.authToken : null;
            obj.put("tokenPresent", token != null && !token.isEmpty());

        } catch (Exception e) {
            try { obj.put("_error", e.getMessage()); } catch (Exception ignored) {}
        }
        return obj.toString();
    }
}
