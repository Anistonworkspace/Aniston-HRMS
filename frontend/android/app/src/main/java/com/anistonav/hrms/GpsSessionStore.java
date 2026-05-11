package com.anistonav.hrms;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

/**
 * GpsSessionStore — single source of truth for native GPS session credentials.
 *
 * All five GPS components (GpsTrackingPlugin, GpsTrackingService,
 * GpsRestartReceiver, GpsWatchdogWorker, MainActivity) MUST read and write
 * credentials exclusively through this class. Direct SharedPreferences access
 * for credential fields is forbidden after this change.
 *
 * Root bug this fixes:
 *   Each component was calling getSharedPreferences(PREFS_NAME) independently.
 *   Tiny timing/key differences caused the watchdog to report "no_credentials"
 *   while the service simultaneously showed "credentialsPresent=true".
 *
 * Design principles:
 *   - Uses the SAME prefs file name as GpsTrackingService (GpsTrackingPrefs)
 *   - Uses the SAME key constants as GpsTrackingService (EXTRA_* fields)
 *   - Normalises backendUrl at save time, ensuring every reader gets a valid URL
 *   - getMissingFields() returns a human-readable comma-joined string for
 *     the diagnostics panel (e.g. "auth_token,employee_id")
 *   - All methods are static — no instances, no lifecycle
 */
public class GpsSessionStore {

    private static final String TAG = "GpsSessionStore";

    // ── Session data holder ───────────────────────────────────────────────────

    public static class Session {
        public final String  backendUrl;
        public final String  authToken;
        public final String  employeeId;
        public final String  orgId;
        public final String  attendanceId;
        public final long    gpsIntervalMs;
        public final boolean trackingEnabled;

        Session(String backendUrl, String authToken, String employeeId,
                String orgId, String attendanceId,
                long gpsIntervalMs, boolean trackingEnabled) {
            this.backendUrl      = backendUrl;
            this.authToken       = authToken;
            this.employeeId      = employeeId;
            this.orgId           = orgId != null ? orgId : "";
            this.attendanceId    = attendanceId != null ? attendanceId : "";
            this.gpsIntervalMs   = gpsIntervalMs;
            this.trackingEnabled = trackingEnabled;
        }
    }

    // ── Write ─────────────────────────────────────────────────────────────────

    /**
     * Persist a full GPS session. Call this BEFORE starting the foreground service
     * so the watchdog, receiver, and boot receiver always find valid credentials.
     */
    public static void saveSession(Context ctx,
                                   String rawBackendUrl,
                                   String authToken,
                                   String employeeId,
                                   String orgId,
                                   String attendanceId,
                                   long   gpsIntervalMs) {
        String backendUrl = normaliseBackendUrl(rawBackendUrl);
        prefs(ctx).edit()
            .putString (GpsTrackingService.EXTRA_BACKEND_URL,           backendUrl)
            .putString (GpsTrackingService.EXTRA_TOKEN,                 authToken != null ? authToken : "")
            .putString (GpsTrackingService.EXTRA_EMPLOYEE_ID,           employeeId != null ? employeeId : "")
            .putString (GpsTrackingService.EXTRA_ORG_ID,                orgId != null ? orgId : "")
            .putString (GpsTrackingService.EXTRA_ATTENDANCE_ID,         attendanceId != null ? attendanceId : "")
            .putLong   (GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS,   gpsIntervalMs > 0 ? gpsIntervalMs : 60_000L)
            .putBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED,  true)
            .apply();
        Log.d(TAG, "Session saved — employee=" + employeeId
            + " url=" + backendUrl + " intervalMs=" + gpsIntervalMs);
    }

    /**
     * Mark the session as stopped (employee checked out or admin stopped).
     * Clears all credential fields and sets tracking_enabled=false.
     */
    public static void clearSession(Context ctx) {
        prefs(ctx).edit()
            .clear()
            .putBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false)
            .apply();
        Log.d(TAG, "Session cleared");
    }

    /**
     * Update just the auth token (called on token refresh without a full restart).
     */
    public static void updateToken(Context ctx, String newToken) {
        if (newToken == null || newToken.isEmpty()) return;
        prefs(ctx).edit()
            .putString(GpsTrackingService.EXTRA_TOKEN, newToken)
            .apply();
        Log.d(TAG, "Auth token updated in session store");
    }

    /**
     * Update just the GPS tracking interval (called from ACTION_UPDATE_INTERVAL).
     */
    public static void updateInterval(Context ctx, long gpsIntervalMs) {
        if (gpsIntervalMs <= 0) return;
        prefs(ctx).edit()
            .putLong(GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS, gpsIntervalMs)
            .apply();
    }

    /**
     * Update just the attendance ID (set after clock-in when the backend returns the record ID).
     */
    public static void updateAttendanceId(Context ctx, String attendanceId) {
        if (attendanceId == null || attendanceId.isEmpty()) return;
        prefs(ctx).edit()
            .putString(GpsTrackingService.EXTRA_ATTENDANCE_ID, attendanceId)
            .apply();
    }

    // ── Read ──────────────────────────────────────────────────────────────────

    /**
     * Read the full session from prefs.
     * Always returns a non-null Session object; callers should check hasValidSession().
     */
    public static Session getSession(Context ctx) {
        SharedPreferences p = prefs(ctx);
        String rawUrl    = p.getString(GpsTrackingService.EXTRA_BACKEND_URL,  null);
        String token     = p.getString(GpsTrackingService.EXTRA_TOKEN,        null);
        String empId     = p.getString(GpsTrackingService.EXTRA_EMPLOYEE_ID,  null);
        String orgId     = p.getString(GpsTrackingService.EXTRA_ORG_ID,       null);
        String attId     = p.getString(GpsTrackingService.EXTRA_ATTENDANCE_ID, null);
        long   intervalMs;
        if (p.contains(GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS)) {
            intervalMs = p.getLong(GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS, 60_000L);
        } else {
            // Migrate from old key that stored minutes
            long mins = p.getLong(GpsTrackingService.EXTRA_TRACKING_INTERVAL_MINUTES, 0);
            intervalMs = mins > 0 ? mins * 60_000L : 60_000L;
        }
        boolean trackingEnabled = p.getBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false);
        return new Session(normaliseBackendUrl(rawUrl), token, empId, orgId, attId,
                           intervalMs, trackingEnabled);
    }

    /**
     * Returns true if the session contains all required fields AND tracking is enabled.
     * This is the canonical "should GPS be running?" check for all 5 components.
     */
    public static boolean hasValidSession(Context ctx) {
        Session s = getSession(ctx);
        return s.trackingEnabled
            && s.authToken   != null && !s.authToken.isEmpty()
            && s.employeeId  != null && !s.employeeId.isEmpty()
            && s.backendUrl  != null && !s.backendUrl.isEmpty()
                && s.backendUrl.startsWith("http");
    }

    /**
     * Returns true only if tracking_enabled=false (employee explicitly checked out
     * or admin stopped). This is the "stay idle, don't restart" signal.
     */
    public static boolean shouldTrack(Context ctx) {
        return prefs(ctx).getBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false);
    }

    /**
     * Returns a comma-joined string of the specific missing/invalid fields.
     * Empty string means all required fields are present and valid.
     * Used by watchdog, receiver, and diagnostics for precise error reporting.
     *
     * Examples:
     *   ""                                    — all OK
     *   "tracking_disabled"                   — employee checked out
     *   "auth_token,employee_id"              — both missing
     *   "tracking_disabled,auth_token"        — out + no token
     */
    public static String getMissingFields(Context ctx) {
        Session s = getSession(ctx);
        StringBuilder sb = new StringBuilder();
        if (!s.trackingEnabled)                               sb.append("tracking_disabled,");
        if (s.authToken  == null || s.authToken.isEmpty())   sb.append("auth_token,");
        if (s.employeeId == null || s.employeeId.isEmpty())  sb.append("employee_id,");
        if (s.backendUrl == null || s.backendUrl.isEmpty()
            || !s.backendUrl.startsWith("http"))             sb.append("backend_url,");
        String result = sb.toString();
        if (result.endsWith(",")) result = result.substring(0, result.length() - 1);
        return result;
    }

    /**
     * Returns the normalised backendUrl from prefs, or the production default.
     * Safe to call even if prefs are empty.
     */
    public static String getBackendUrl(Context ctx) {
        return normaliseBackendUrl(
            prefs(ctx).getString(GpsTrackingService.EXTRA_BACKEND_URL, null));
    }

    /**
     * Returns the attendanceId from prefs, or empty string.
     */
    public static String getAttendanceId(Context ctx) {
        String id = prefs(ctx).getString(GpsTrackingService.EXTRA_ATTENDANCE_ID, null);
        return id != null ? id : "";
    }

    // ── URL normalisation ─────────────────────────────────────────────────────

    /**
     * Normalise any raw backend URL to a full https:// origin with no trailing slash.
     * Mirrors GpsTrackingService.normaliseBackendUrl() — one canonical implementation.
     */
    public static String normaliseBackendUrl(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return "https://hr.anistonav.com";
        }
        raw = raw.trim();
        while (raw.endsWith("/")) {
            raw = raw.substring(0, raw.length() - 1);
        }
        if (raw.startsWith("https://") || raw.startsWith("http://")) {
            if (raw.endsWith("/api")) {
                raw = raw.substring(0, raw.length() - 4);
            }
            return raw;
        }
        Log.e(TAG, "Relative/invalid backendUrl: '" + raw + "' — using production default");
        return "https://hr.anistonav.com";
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE);
    }
}
