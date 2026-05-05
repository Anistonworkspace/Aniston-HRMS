package com.anistonav.hrms;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

/**
 * Native foreground service for persistent GPS tracking.
 *
 * Key design principles:
 * - ALL network calls happen on the dedicated networkExecutor (never main looper).
 * - Heartbeat is scheduled on a ScheduledExecutorService — immune to Doze pausing the main Looper.
 * - backendUrl is always normalised to a full https:// origin before use.
 * - Credentials are persisted to SharedPreferences before the service starts so
 *   the watchdog, restart receiver, and boot receiver can all read them.
 * - sIsRunning is a volatile static so callers in the same process can guard
 *   against duplicate starts; false is the safe default (new process = not running).
 */
public class GpsTrackingService extends Service {

    private static final String TAG = "GpsTrackingService";
    private static final SimpleDateFormat ISO_FORMAT;
    static {
        ISO_FORMAT = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        ISO_FORMAT.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    public static final String CHANNEL_ID  = "aniston_gps_tracking";
    private static final int NOTIFICATION_ID = 1001;
    public static final String PREFS_NAME    = "GpsTrackingPrefs";

    // ── Intent actions ────────────────────────────────────────────────────────
    public static final String ACTION_STOP            = "com.anistonav.hrms.STOP_GPS";
    public static final String ACTION_UPDATE_TOKEN    = "com.anistonav.hrms.UPDATE_TOKEN";
    public static final String ACTION_UPDATE_INTERVAL = "com.anistonav.hrms.UPDATE_INTERVAL";

    // ── SharedPreferences keys (also used as Intent extras) ───────────────────
    public static final String EXTRA_TOKEN                      = "auth_token";
    public static final String EXTRA_BACKEND_URL                = "backend_url";
    public static final String EXTRA_EMPLOYEE_ID                = "employee_id";
    public static final String EXTRA_ORG_ID                     = "org_id";
    public static final String EXTRA_ATTENDANCE_ID              = "attendance_id";
    public static final String EXTRA_TRACKING_INTERVAL_MINUTES  = "tracking_interval_minutes";
    public  static final String PREFS_KEY_GPS_INTERVAL_MS       = "gps_interval_ms";
    public static final String PREFS_KEY_TRACKING_ENABLED       = "tracking_enabled";

    // ── GPS timing ────────────────────────────────────────────────────────────
    private static final long GPS_INTERVAL_MS_DEFAULT = 60_000L;
    private static final long GPS_FASTEST_MS          = 30_000L;
    private static final long HEARTBEAT_INTERVAL_MS   = 5 * 60_000L; // 5 min
    private static final float MAX_ACCURACY_METERS    = 50.0f;

    // ── Executor: single-thread for network; scheduled for heartbeat ──────────
    private ScheduledExecutorService networkExecutor;
    private ScheduledFuture<?>        heartbeatFuture;

    // ── FusedLocationProvider ─────────────────────────────────────────────────
    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback            locationCallback;
    private PowerManager.WakeLock       wakeLock;

    // ── Runtime state ─────────────────────────────────────────────────────────
    private String backendUrl;   // always normalised to full origin (https://...)
    private String authToken;
    private String employeeId;
    private String orgId;
    private String attendanceId;
    private long   gpsIntervalMs = GPS_INTERVAL_MS_DEFAULT;
    private boolean stoppedByEmployee = false;

    // Batching
    private static final int BATCH_THRESHOLD_HIGH_SPEED = 1;
    private static final int BATCH_THRESHOLD_LOW_SPEED  = 10;
    private final List<JSONObject> pendingBatch = new ArrayList<>();

    // RDP compression epsilon
    private static final double RDP_EPSILON_METERS = 5.0;

    // Last known location for notification updates
    private double lastLat;
    private double lastLng;

    /** True only while this process's service instance is running. */
    public static volatile boolean sIsRunning = false;

    // ── onCreate ─────────────────────────────────────────────────────────────

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        networkExecutor      = Executors.newScheduledThreadPool(2);
        fusedLocationClient  = LocationServices.getFusedLocationProviderClient(this);
        acquireWakeLock();
        GpsDiagnostics.recordDeviceInfo(this);
    }

    // ── onStartCommand ───────────────────────────────────────────────────────

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Restarted by START_STICKY after OS kill — restore credentials from prefs
            restoreFromPrefs();
        } else if (ACTION_STOP.equals(intent.getAction())) {
            stoppedByEmployee = true;
            postTrackingStop();
            stopSelf();
            return START_NOT_STICKY;

        } else if (ACTION_UPDATE_TOKEN.equals(intent.getAction())) {
            String newToken = intent.getStringExtra(EXTRA_TOKEN);
            if (newToken != null && !newToken.isEmpty()) {
                authToken = newToken;
                saveToPrefs();
            }
            return START_STICKY;

        } else if (ACTION_UPDATE_INTERVAL.equals(intent.getAction())) {
            int minutes = intent.getIntExtra(EXTRA_TRACKING_INTERVAL_MINUTES, 60);
            minutes = Math.max(1, Math.min(240, minutes));
            gpsIntervalMs = (long) minutes * 60_000L;
            saveToPrefs();
            if (sIsRunning) restartLocationUpdates();
            return START_STICKY;

        } else {
            // Fresh start from plugin or restart receiver
            backendUrl   = normaliseBackendUrl(intent.getStringExtra(EXTRA_BACKEND_URL));
            authToken    = intent.getStringExtra(EXTRA_TOKEN);
            employeeId   = intent.getStringExtra(EXTRA_EMPLOYEE_ID);
            orgId        = intent.getStringExtra(EXTRA_ORG_ID);
            attendanceId = intent.getStringExtra(EXTRA_ATTENDANCE_ID);

            int intervalMinutes = intent.getIntExtra(EXTRA_TRACKING_INTERVAL_MINUTES, 0);
            if (intervalMinutes > 0) {
                intervalMinutes = Math.max(1, Math.min(240, intervalMinutes));
                gpsIntervalMs = intervalMinutes * 60_000L;
            } else {
                gpsIntervalMs = GPS_INTERVAL_MS_DEFAULT;
            }
            saveToPrefs();
        }

        // Validate required credentials before starting
        if (authToken == null || authToken.isEmpty()) {
            GpsDiagnostics.recordError(this, "missing_token");
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_CREDENTIALS_PRESENT, "false");
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_MISSING_CREDENTIAL_FIELDS, "auth_token");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (employeeId == null || employeeId.isEmpty()) {
            GpsDiagnostics.recordError(this, "missing_employee_id");
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_CREDENTIALS_PRESENT, "false");
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_MISSING_CREDENTIAL_FIELDS, "employee_id");
            stopSelf();
            return START_NOT_STICKY;
        }
        if (backendUrl == null || backendUrl.isEmpty()) {
            GpsDiagnostics.recordError(this, "invalid_api_base_url:<null>");
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_BASE_URL_VALID, "false");
            stopSelf();
            return START_NOT_STICKY;
        }

        // Record url diagnostics
        String heartbeatUrl = backendUrl + "/api/attendance/gps-heartbeat";
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_API_BASE_URL, backendUrl);
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_HEARTBEAT_URL, heartbeatUrl);
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_BASE_URL_VALID, "true");
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_BASE_URL_SOURCE, "plugin_start");
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_CREDENTIALS_PRESENT, "true");
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_MISSING_CREDENTIAL_FIELDS, "");
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_TRACKING_ENABLED, "true");

        startForegroundNow("Aniston HRMS — GPS Active", "Initialising location…");
        sIsRunning = true;

        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_SERVICE_RUNNING,       "true");
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_SERVICE_START_AT, GpsDiagnostics.nowIso());

        startLocationUpdates();
        scheduleHeartbeat();

        return START_STICKY;
    }

    // ── URL normalisation ────────────────────────────────────────────────────

    /**
     * Ensure backendUrl is always a full https:// origin with no trailing slash.
     * Handles three bad inputs from stale prefs or old builds:
     *   "/api"                       → "https://hr.anistonav.com"
     *   "/api/attendance/..."        → "https://hr.anistonav.com"
     *   "https://hr.anistonav.com/"  → "https://hr.anistonav.com"
     *   null / empty                 → "https://hr.anistonav.com"
     * A full absolute URL is returned unchanged (after trimming trailing slash).
     */
    private static String normaliseBackendUrl(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            return "https://hr.anistonav.com";
        }
        raw = raw.trim();
        // Strip trailing slash(es)
        while (raw.endsWith("/")) {
            raw = raw.substring(0, raw.length() - 1);
        }
        // If it already starts with a scheme, accept it
        if (raw.startsWith("https://") || raw.startsWith("http://")) {
            // Strip any /api suffix that was accidentally stored
            if (raw.endsWith("/api")) {
                raw = raw.substring(0, raw.length() - 4);
            }
            return raw;
        }
        // Relative URL — cannot determine origin at runtime; use hard-coded production domain
        Log.e("GpsTrackingService", "Invalid backendUrl (relative path): " + raw + " — using production default");
        return "https://hr.anistonav.com";
    }

    // ── Prefs helpers ─────────────────────────────────────────────────────────

    private void saveToPrefs() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putString(EXTRA_BACKEND_URL,               backendUrl)
            .putString(EXTRA_TOKEN,                     authToken)
            .putString(EXTRA_EMPLOYEE_ID,               employeeId)
            .putString(EXTRA_ORG_ID,                    orgId)
            .putString(EXTRA_ATTENDANCE_ID,             attendanceId)
            .putLong  (PREFS_KEY_GPS_INTERVAL_MS,       gpsIntervalMs)
            .putBoolean(PREFS_KEY_TRACKING_ENABLED,     true)
            .apply();
        // Also persist a copy of the session stored-at timestamp for diagnostics
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_NATIVE_SESSION_STORED_AT, GpsDiagnostics.nowIso());
    }

    private void restoreFromPrefs() {
        SharedPreferences p = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        backendUrl   = normaliseBackendUrl(p.getString(EXTRA_BACKEND_URL, null));
        authToken    = p.getString(EXTRA_TOKEN,        null);
        employeeId   = p.getString(EXTRA_EMPLOYEE_ID,  null);
        orgId        = p.getString(EXTRA_ORG_ID,       null);
        attendanceId = p.getString(EXTRA_ATTENDANCE_ID, null);

        if (p.contains(PREFS_KEY_GPS_INTERVAL_MS)) {
            gpsIntervalMs = p.getLong(PREFS_KEY_GPS_INTERVAL_MS, GPS_INTERVAL_MS_DEFAULT);
        } else {
            // Migrate from old prefs key that stored minutes instead of ms
            long storedMinutes = p.getLong(EXTRA_TRACKING_INTERVAL_MINUTES, 0);
            gpsIntervalMs = storedMinutes > 0
                ? storedMinutes * 60_000L
                : GPS_INTERVAL_MS_DEFAULT;
        }
    }

    // ── Wake lock ─────────────────────────────────────────────────────────────

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AnistonHRMS:GpsWakeLock");
            wakeLock.acquire(12 * 60 * 60 * 1000L); // 12-hour timeout
        }
    }

    // ── GPS ───────────────────────────────────────────────────────────────────

    private void startLocationUpdates() {
        long fastestMs = Math.min(GPS_FASTEST_MS, gpsIntervalMs);
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, gpsIntervalMs)
            .setMinUpdateIntervalMillis(fastestMs)
            .setWaitForAccurateLocation(false)
            .build();

        locationCallback = new LocationCallback() {
            @Override
            public void onLocationResult(LocationResult result) {
                if (result == null) return;
                Location loc = result.getLastLocation();
                if (loc == null) return;

                lastLat = loc.getLatitude();
                lastLng = loc.getLongitude();
                float accuracy = loc.getAccuracy();
                float speed    = loc.getSpeed();

                GpsDiagnostics.recordEvent(GpsTrackingService.this,
                    GpsDiagnostics.KEY_LAST_LOCATION_RECEIVED_AT, GpsDiagnostics.nowIso());

                String kmh    = String.format(Locale.US, "%.1f km/h", speed * 3.6f);
                String acc    = String.format(Locale.US, "±%.0f m", accuracy);
                String coords = String.format(Locale.US, "%.5f, %.5f", lastLat, lastLng);
                updateNotification("GPS Active — " + kmh, coords + "  " + acc);

                if (accuracy > MAX_ACCURACY_METERS) {
                    Log.d(TAG, "Skipping inaccurate point: accuracy=" + accuracy + "m");
                    return;
                }
                postGpsPoint(lastLat, lastLng, accuracy, speed);
            }
        };

        try {
            // Use getMainLooper() for location delivery — FusedLocationProvider guarantees
            // callbacks fire on the specified looper even in background.
            // Network posting is dispatched to networkExecutor immediately from the callback.
            fusedLocationClient.requestLocationUpdates(req, locationCallback, Looper.getMainLooper());
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_LOCATION_REQUEST_AT, GpsDiagnostics.nowIso());
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not granted", e);
            GpsDiagnostics.recordError(this, "location_permission_denied: " + e.getMessage());
            stopSelf();
        }
    }

    private void restartLocationUpdates() {
        if (locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        startLocationUpdates();
    }

    // ── Heartbeat — runs on background ScheduledExecutorService ──────────────
    // CRITICAL: Never use Handler(getMainLooper()) for heartbeat.
    // Xiaomi/POCO in Doze mode can pause the main looper, silently stopping heartbeats.
    // ScheduledExecutorService runs on a real background thread that survives Doze.

    private void scheduleHeartbeat() {
        if (heartbeatFuture != null && !heartbeatFuture.isCancelled()) {
            heartbeatFuture.cancel(false);
        }
        // Fire immediately, then every HEARTBEAT_INTERVAL_MS
        heartbeatFuture = networkExecutor.scheduleAtFixedRate(
            this::postHeartbeat,
            0L,
            HEARTBEAT_INTERVAL_MS,
            TimeUnit.MILLISECONDS
        );
    }

    // ── HTTP helpers ──────────────────────────────────────────────────────────

    private void postGpsPoint(double lat, double lng, float accuracy, float speed) {
        if (backendUrl == null || authToken == null) return;

        try {
            JSONObject pt = new JSONObject();
            pt.put("lat",       lat);
            pt.put("lng",       lng);
            pt.put("accuracy",  accuracy);
            if (speed >= 0) pt.put("speed", speed);
            pt.put("timestamp", ISO_FORMAT.format(new Date()));
            pendingBatch.add(pt);
        } catch (Exception e) {
            Log.w(TAG, "Failed to build GPS point: " + e.getMessage());
            return;
        }

        boolean highSpeed = NetworkQualityPlugin.getQuality(this).optBoolean("isHighSpeed", true);
        int threshold = highSpeed ? BATCH_THRESHOLD_HIGH_SPEED : BATCH_THRESHOLD_LOW_SPEED;
        if (pendingBatch.size() < threshold) return;

        final List<JSONObject> batchToSend = new ArrayList<>(pendingBatch);
        pendingBatch.clear();

        networkExecutor.execute(() -> {
            try {
                List<JSONObject> compressed = rdpSimplify(batchToSend, RDP_EPSILON_METERS);
                JSONArray arr = new JSONArray();
                for (JSONObject p : compressed) arr.put(p);
                JSONObject body = new JSONObject();
                body.put("points", arr);

                String trailUrl = backendUrl + "/api/attendance/gps-trail";
                GpsDiagnostics.recordEvent(GpsTrackingService.this,
                    GpsDiagnostics.KEY_LAST_HTTP_REQUEST_AT, GpsDiagnostics.nowIso());
                GpsDiagnostics.recordEvent(GpsTrackingService.this,
                    GpsDiagnostics.KEY_LAST_HTTP_REQUEST_URL, trailUrl);

                postJson(trailUrl, body.toString());

                GpsDiagnostics.recordEvent(GpsTrackingService.this,
                    GpsDiagnostics.KEY_LAST_GPS_POINT_AT, GpsDiagnostics.nowIso());
                GpsDiagnostics.recordEvent(GpsTrackingService.this,
                    GpsDiagnostics.KEY_LAST_HTTP_RESPONSE_AT, GpsDiagnostics.nowIso());

            } catch (Exception e) {
                Log.w(TAG, "postGpsPoint batch failed: " + e.getMessage());
                GpsDiagnostics.recordError(GpsTrackingService.this, e.getMessage());
                // Re-queue failed points
                synchronized (pendingBatch) {
                    for (int i = batchToSend.size() - 1; i >= 0; i--) {
                        pendingBatch.add(0, batchToSend.get(i));
                    }
                }
            }
        });
    }

    private void postHeartbeat() {
        if (backendUrl == null || authToken == null) {
            GpsDiagnostics.recordError(this, "postHeartbeat: missing credentials");
            return;
        }
        // Validate URL is absolute before posting
        if (!backendUrl.startsWith("http://") && !backendUrl.startsWith("https://")) {
            String invalid = backendUrl;
            backendUrl = normaliseBackendUrl(backendUrl);
            GpsDiagnostics.recordError(this, "invalid_api_base_url:" + invalid + " -> normalised to " + backendUrl);
        }
        try {
            String hbUrl = backendUrl + "/api/attendance/gps-heartbeat";
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_HTTP_REQUEST_AT,  GpsDiagnostics.nowIso());
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_HTTP_REQUEST_URL, hbUrl);

            postJson(hbUrl, "{}");

            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_HEARTBEAT_AT,    GpsDiagnostics.nowIso());
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_HTTP_RESPONSE_AT, GpsDiagnostics.nowIso());
        } catch (Exception e) {
            Log.w(TAG, "postHeartbeat failed: " + e.getMessage());
            GpsDiagnostics.recordError(this, e.getMessage());
        }
    }

    private void postTrackingStop() {
        if (backendUrl == null || authToken == null) return;
        networkExecutor.execute(() -> {
            try {
                postJson(backendUrl + "/api/attendance/gps-tracking-stop", "{}");
            } catch (Exception e) {
                Log.w(TAG, "postTrackingStop failed: " + e.getMessage());
            }
        });
    }

    private void postJson(String urlStr, String jsonBody) throws Exception {
        // Guard against relative URLs reaching the network layer
        if (!urlStr.startsWith("http://") && !urlStr.startsWith("https://")) {
            throw new IllegalArgumentException("invalid_url_no_protocol: " + urlStr);
        }
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type",  "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + authToken);
        conn.setRequestProperty("X-Native-App",  "true");
        conn.setDoOutput(true);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(10_000);

        byte[] bytes = jsonBody.getBytes("UTF-8");
        conn.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(bytes);
        }

        int code = conn.getResponseCode();
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_BACKEND_STATUS_CODE, String.valueOf(code));

        if (code == 401) {
            // Service may have a stale token; try reading a fresher one from prefs
            String refreshed = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .getString(EXTRA_TOKEN, null);
            if (refreshed != null && !refreshed.equals(authToken)) {
                authToken = refreshed;
            }
        }
        conn.disconnect();
    }

    // ── RDP compression ───────────────────────────────────────────────────────

    private static List<JSONObject> rdpSimplify(List<JSONObject> points, double epsilonMeters) {
        if (points.size() < 3) return points;
        double maxDist = 0;
        int    maxIdx  = 0;
        JSONObject first = points.get(0);
        JSONObject last  = points.get(points.size() - 1);
        for (int i = 1; i < points.size() - 1; i++) {
            double d = perpendicularDistance(points.get(i), first, last);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }
        if (maxDist > epsilonMeters) {
            List<JSONObject> left  = rdpSimplify(points.subList(0, maxIdx + 1), epsilonMeters);
            List<JSONObject> right = rdpSimplify(points.subList(maxIdx, points.size()), epsilonMeters);
            List<JSONObject> result = new ArrayList<>(left);
            result.addAll(right.subList(1, right.size()));
            return result;
        } else {
            List<JSONObject> result = new ArrayList<>();
            result.add(first);
            result.add(last);
            return result;
        }
    }

    private static double perpendicularDistance(JSONObject p, JSONObject a, JSONObject b) {
        try {
            double lat  = p.getDouble("lat"), lng  = p.getDouble("lng");
            double lat1 = a.getDouble("lat"), lng1 = a.getDouble("lng");
            double lat2 = b.getDouble("lat"), lng2 = b.getDouble("lng");
            double dx = lng2 - lng1, dy = lat2 - lat1;
            if (dx == 0 && dy == 0) return haversineMeters(lat, lng, lat1, lng1);
            double t = ((lng - lng1) * dx + (lat - lat1) * dy) / (dx * dx + dy * dy);
            t = Math.max(0, Math.min(1, t));
            return haversineMeters(lat, lng, lat1 + t * dy, lng1 + t * dx);
        } catch (Exception e) { return 0; }
    }

    private static double haversineMeters(double lat1, double lng1, double lat2, double lng2) {
        final double R = 6_371_000.0;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // ── Notification ──────────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "GPS Tracking", NotificationManager.IMPORTANCE_DEFAULT);
            ch.setDescription("Live GPS tracking status for field attendance");
            ch.setShowBadge(false);
            ch.setSound(null, null);
            ch.enableVibration(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void startForegroundNow(String title, String text) {
        Notification n = buildNotification(title, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, n,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_FOREGROUND_NOTIFICATION_VISIBLE, "true");
    }

    private void updateNotification(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(title, text));
    }

    public static final String EXTRA_NAVIGATE = "navigate_to";

    private Notification buildNotification(String title, String text) {
        Intent openApp  = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openApp.putExtra(EXTRA_NAVIGATE, "/attendance");
        PendingIntent openPi = PendingIntent.getActivity(this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        Intent stopIntent = new Intent(this, GpsTrackingService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 1, stopIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(openPi)
            .setOngoing(true)
            .setSilent(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, "Stop Tracking", stopPi)
            .build();
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_ON_TASK_REMOVED_AT, GpsDiagnostics.nowIso());
        Log.i(TAG, "onTaskRemoved — scheduling dual-alarm restart");

        // Strategy 1: immediate self-restart (works on stock Android before process dies)
        try {
            Intent restart = new Intent(this, GpsTrackingService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restart);
            } else {
                startService(restart);
            }
        } catch (Exception e) {
            Log.w(TAG, "Immediate restart failed (expected on some OEMs): " + e.getMessage());
        }

        // Strategy 2: AlarmManager — fires even after process death
        try {
            GpsRestartReceiver.scheduleRestart(this);
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_RESTART_ALARM_AT, GpsDiagnostics.nowIso());
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule AlarmManager restart: " + e.getMessage());
            GpsDiagnostics.recordError(this, "schedule_alarm_failed: " + e.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        // Flush remaining batched points
        if (!pendingBatch.isEmpty() && backendUrl != null && authToken != null) {
            final List<JSONObject> remaining = new ArrayList<>(pendingBatch);
            pendingBatch.clear();
            networkExecutor.execute(() -> {
                try {
                    JSONArray arr = new JSONArray();
                    for (JSONObject p : remaining) arr.put(p);
                    JSONObject body = new JSONObject();
                    body.put("points", arr);
                    postJson(backendUrl + "/api/attendance/gps-trail", body.toString());
                } catch (Exception e) {
                    Log.w(TAG, "Final batch flush failed: " + e.getMessage());
                }
            });
        }
        if (locationCallback != null)                              fusedLocationClient.removeLocationUpdates(locationCallback);
        if (heartbeatFuture  != null && !heartbeatFuture.isCancelled()) heartbeatFuture.cancel(false);
        if (networkExecutor  != null && !networkExecutor.isShutdown())  networkExecutor.shutdown();
        if (wakeLock         != null && wakeLock.isHeld())              wakeLock.release();

        sIsRunning = false;
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_SERVICE_RUNNING,        "false");
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_SERVICE_STOP_AT,   GpsDiagnostics.nowIso());
        GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_FOREGROUND_NOTIFICATION_VISIBLE, "false");

        if (stoppedByEmployee) {
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_SERVICE_STOP_REASON, "employee_checkout");
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_TRACKING_ENABLED,         "false");
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_NATIVE_SESSION_CLEARED_AT, GpsDiagnostics.nowIso());
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
                .clear()
                .putBoolean(PREFS_KEY_TRACKING_ENABLED, false)
                .apply();
        } else {
            GpsDiagnostics.recordEvent(this, GpsDiagnostics.KEY_LAST_SERVICE_STOP_REASON, "os_kill_or_restart");
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) { return null; }
}
