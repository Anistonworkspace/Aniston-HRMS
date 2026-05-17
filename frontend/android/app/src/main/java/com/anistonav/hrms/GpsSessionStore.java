package com.anistonav.hrms;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

import java.io.IOException;
import java.security.GeneralSecurityException;

/**
 * GpsSessionStore — single source of truth for native GPS session credentials.
 *
 * All five GPS components (GpsTrackingPlugin, GpsTrackingService,
 * GpsRestartReceiver, GpsWatchdogWorker, MainActivity) MUST read and write
 * credentials exclusively through this class. Direct SharedPreferences access
 * for credential fields is forbidden after this change.
 *
 * Security: credentials (auth token, employee ID, etc.) are stored in
 * EncryptedSharedPreferences (AES256-SIV key encryption, AES256-GCM value
 * encryption backed by Android Keystore). A one-time migration from the old
 * plain SharedPreferences file is performed on first access.
 *
 * Root bug this fixes:
 *   Each component was calling getSharedPreferences(PREFS_NAME) independently.
 *   Tiny timing/key differences caused the watchdog to report "no_credentials"
 *   while the service simultaneously showed "credentialsPresent=true".
 */
public class GpsSessionStore {

    private static final String TAG = "GpsSessionStore";

    // Name of the encrypted prefs file (different from the old plain file)
    private static final String ENCRYPTED_PREFS_NAME = "GpsTrackingPrefs_enc";
    // Legacy plain prefs file — still used by diagnostics prefs, not credentials
    static final String PLAIN_PREFS_NAME = "GpsTrackingPrefs";

    // Singleton to avoid repeated KeyStore unlock overhead
    private static volatile SharedPreferences sEncryptedPrefs = null;
    private static final Object sLock = new Object();

    // ── Session data holder ───────────────────────────────────────────────────

    public static class Session {
        public final String  backendUrl;
        public final String  authToken;
        public final String  employeeId;
        public final String  orgId;
        public final String  attendanceId;
        public final long    gpsIntervalMs;
        public final boolean trackingEnabled;
        /** "FIELD" for full GPS trail, "HYBRID" for lightweight geofence monitoring. */
        public final String  shiftType;

        Session(String backendUrl, String authToken, String employeeId,
                String orgId, String attendanceId,
                long gpsIntervalMs, boolean trackingEnabled, String shiftType) {
            this.backendUrl      = backendUrl;
            this.authToken       = authToken;
            this.employeeId      = employeeId;
            this.orgId           = orgId != null ? orgId : "";
            this.attendanceId    = attendanceId != null ? attendanceId : "";
            this.gpsIntervalMs   = gpsIntervalMs;
            this.trackingEnabled = trackingEnabled;
            this.shiftType       = (shiftType != null && !shiftType.isEmpty()) ? shiftType : "FIELD";
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
        saveSession(ctx, rawBackendUrl, authToken, employeeId, orgId, attendanceId, gpsIntervalMs, "FIELD");
    }

    public static void saveSession(Context ctx,
                                   String rawBackendUrl,
                                   String authToken,
                                   String employeeId,
                                   String orgId,
                                   String attendanceId,
                                   long   gpsIntervalMs,
                                   String shiftType) {
        String backendUrl = normaliseBackendUrl(rawBackendUrl);
        String resolvedShiftType = (shiftType != null && !shiftType.isEmpty()) ? shiftType : "FIELD";
        SharedPreferences p = prefs(ctx);
        SharedPreferences.Editor ed = p.edit();
        ed.putString (GpsTrackingService.EXTRA_BACKEND_URL,          backendUrl);
        ed.putString (GpsTrackingService.EXTRA_TOKEN,                authToken != null ? authToken : "");
        ed.putString (GpsTrackingService.EXTRA_EMPLOYEE_ID,          employeeId != null ? employeeId : "");
        ed.putString (GpsTrackingService.EXTRA_ORG_ID,               orgId != null ? orgId : "");
        ed.putString (GpsTrackingService.EXTRA_ATTENDANCE_ID,        attendanceId != null ? attendanceId : "");
        ed.putLong   (GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS,  gpsIntervalMs > 0 ? gpsIntervalMs : 60_000L);
        ed.putBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, true);
        ed.putString (GpsTrackingService.PREFS_KEY_SHIFT_TYPE,       resolvedShiftType);
        ed.apply();
        Log.d(TAG, "Session saved (encrypted) — employee=" + employeeId
            + " url=" + backendUrl + " intervalMs=" + gpsIntervalMs + " shiftType=" + resolvedShiftType);
    }

    /**
     * Mark the session as stopped (employee checked out or admin stopped).
     * Clears all credential fields and sets tracking_enabled=false.
     */
    public static void clearSession(Context ctx) {
        SharedPreferences p = prefs(ctx);
        p.edit().clear()
            .putBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false)
            .apply();
        // Also clear the legacy plain prefs to avoid stale plaintext lying around
        try {
            ctx.getSharedPreferences(PLAIN_PREFS_NAME, Context.MODE_PRIVATE)
                .edit().clear()
                .putBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false)
                .apply();
        } catch (Exception ignored) {}
        Log.d(TAG, "Session cleared (encrypted + legacy plain)");
    }

    /**
     * Update just the auth token (called on token refresh without a full restart).
     */
    public static void updateToken(Context ctx, String newToken) {
        if (newToken == null || newToken.isEmpty()) return;
        prefs(ctx).edit()
            .putString(GpsTrackingService.EXTRA_TOKEN, newToken)
            .apply();
        Log.d(TAG, "Auth token updated in encrypted session store");
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
        String  shiftType       = p.getString(GpsTrackingService.PREFS_KEY_SHIFT_TYPE, "FIELD");
        return new Session(normaliseBackendUrl(rawUrl), token, empId, orgId, attId,
                           intervalMs, trackingEnabled, shiftType);
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
     * Returns true only if tracking_enabled=true (employee is on shift).
     */
    public static boolean shouldTrack(Context ctx) {
        return prefs(ctx).getBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false);
    }

    /**
     * Returns a comma-joined string of the specific missing/invalid fields.
     * Empty string means all required fields are present and valid.
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

    /**
     * Returns the EncryptedSharedPreferences instance, lazily initialised.
     * Falls back to plain SharedPreferences if EncryptedSharedPreferences fails
     * (e.g. KeyStore unavailable in DirectBoot — device locked after reboot).
     * On first call, migrates any existing credentials from the legacy plain file.
     */
    private static SharedPreferences prefs(Context ctx) {
        if (sEncryptedPrefs != null) return sEncryptedPrefs;
        synchronized (sLock) {
            if (sEncryptedPrefs != null) return sEncryptedPrefs;
            try {
                MasterKey masterKey = new MasterKey.Builder(ctx)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build();
                SharedPreferences enc = EncryptedSharedPreferences.create(
                    ctx,
                    ENCRYPTED_PREFS_NAME,
                    masterKey,
                    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
                );
                // One-time migration: copy credentials from old plain prefs to encrypted prefs
                migrateFromPlain(ctx, enc);
                sEncryptedPrefs = enc;
                return enc;
            } catch (GeneralSecurityException | IOException e) {
                // KeyStore unavailable (locked device / DirectBoot) — fall back to plain prefs
                Log.w(TAG, "EncryptedSharedPreferences unavailable, using plain prefs: " + e.getMessage());
                return ctx.getSharedPreferences(PLAIN_PREFS_NAME, Context.MODE_PRIVATE);
            }
        }
    }

    /**
     * Migrates credentials from the old plain-text GpsTrackingPrefs to the new
     * encrypted file. Only runs if the legacy file has data and the new file is empty.
     * After migration, credential keys are removed from the plain file.
     */
    private static void migrateFromPlain(Context ctx, SharedPreferences enc) {
        SharedPreferences plain = ctx.getSharedPreferences(PLAIN_PREFS_NAME, Context.MODE_PRIVATE);
        // Only migrate if encrypted prefs are empty and plain prefs have credentials
        if (enc.contains(GpsTrackingService.EXTRA_TOKEN)) return; // already migrated
        if (!plain.contains(GpsTrackingService.EXTRA_TOKEN)) return; // nothing to migrate

        Log.i(TAG, "Migrating GPS credentials from plain to encrypted prefs");
        try {
            SharedPreferences.Editor encEd   = enc.edit();
            SharedPreferences.Editor plainEd = plain.edit();

            String[] credKeys = {
                GpsTrackingService.EXTRA_BACKEND_URL,
                GpsTrackingService.EXTRA_TOKEN,
                GpsTrackingService.EXTRA_EMPLOYEE_ID,
                GpsTrackingService.EXTRA_ORG_ID,
                GpsTrackingService.EXTRA_ATTENDANCE_ID,
            };
            for (String key : credKeys) {
                String val = plain.getString(key, null);
                if (val != null) {
                    encEd.putString(key, val);
                    plainEd.remove(key); // remove from plain after migration
                }
            }
            long intervalMs = plain.getLong(GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS, 60_000L);
            encEd.putLong(GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS, intervalMs);
            plainEd.remove(GpsTrackingService.PREFS_KEY_GPS_INTERVAL_MS);
            // Migrate shiftType if present in old plain prefs
            String legacyShiftType = plain.getString(GpsTrackingService.PREFS_KEY_SHIFT_TYPE, null);
            if (legacyShiftType != null) {
                encEd.putString(GpsTrackingService.PREFS_KEY_SHIFT_TYPE, legacyShiftType);
                plainEd.remove(GpsTrackingService.PREFS_KEY_SHIFT_TYPE);
            }

            boolean trackingEnabled = plain.getBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, false);
            encEd.putBoolean(GpsTrackingService.PREFS_KEY_TRACKING_ENABLED, trackingEnabled);
            // Leave PREFS_KEY_TRACKING_ENABLED in plain prefs — it's needed for
            // DirectBoot fallback reads when KeyStore is locked after reboot.

            encEd.apply();
            plainEd.apply();
            Log.i(TAG, "Migration complete");
        } catch (Exception e) {
            Log.e(TAG, "Migration failed: " + e.getMessage());
        }
    }
}
