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
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native foreground service for persistent GPS tracking.
 *
 * Survives swipe-from-recents because android:stopWithTask="false" in manifest.
 * Only truly stops on Force Stop (Settings → Apps → Force Stop).
 * Uses FusedLocationProviderClient — most battery-efficient GPS API on Android.
 * Posts points directly via HttpURLConnection with no WebView dependency.
 */
public class GpsTrackingService extends Service {

    private static final String TAG = "GpsTrackingService";
    private static final SimpleDateFormat ISO_FORMAT;
    static {
        ISO_FORMAT = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        ISO_FORMAT.setTimeZone(TimeZone.getTimeZone("UTC"));
    }
    public static final String CHANNEL_ID = "aniston_gps_tracking";
    private static final int NOTIFICATION_ID = 1001;
    public static final String PREFS_NAME = "GpsTrackingPrefs";

    // Intent actions
    public static final String ACTION_STOP = "com.anistonav.hrms.STOP_GPS";
    public static final String ACTION_UPDATE_TOKEN = "com.anistonav.hrms.UPDATE_TOKEN";
    public static final String ACTION_UPDATE_INTERVAL = "com.anistonav.hrms.UPDATE_INTERVAL";

    // Intent extras
    public static final String EXTRA_TOKEN = "auth_token";
    public static final String EXTRA_BACKEND_URL = "backend_url";
    public static final String EXTRA_EMPLOYEE_ID = "employee_id";
    public static final String EXTRA_ORG_ID = "org_id";
    // Intent extra key: value is an integer number of MINUTES (as sent by the Capacitor plugin)
    public static final String EXTRA_TRACKING_INTERVAL_MINUTES = "tracking_interval_minutes";
    // SharedPreferences key: value is stored in MILLISECONDS for direct use in LocationRequest
    private static final String PREFS_KEY_GPS_INTERVAL_MS = "gps_interval_ms";

    // GPS timing — interval overridable per shift; clamped to [1, 240] minutes
    private static final long GPS_INTERVAL_MS_DEFAULT = 60_000L;
    private static final long GPS_FASTEST_MS = 30_000L;       // fastest delivery hint (30s); actual interval controlled by gpsIntervalMs
    private static final long HEARTBEAT_INTERVAL_MS = 5 * 60_000L; // ping backend every 5 min

    private FusedLocationProviderClient fusedLocationClient;
    private LocationCallback locationCallback;
    private PowerManager.WakeLock wakeLock;
    private ExecutorService networkExecutor;
    private Handler heartbeatHandler;
    private Runnable heartbeatRunnable;

    private String backendUrl;
    private String authToken;
    private String employeeId;
    private String orgId;
    private long gpsIntervalMs = GPS_INTERVAL_MS_DEFAULT;

    // Set true once the foreground service is fully started; false at the top of onDestroy
    // so that an OOM kill (which skips onDestroy) returns false — safer than prefs alone.
    public static volatile boolean sIsRunning = false;

    // True only when the employee explicitly taps "Stop Tracking" (ACTION_STOP).
    // Used in onDestroy to decide whether to wipe SharedPreferences credentials.
    private boolean stoppedByEmployee = false;

    // Last known location — kept for notification updates
    private double lastLat = 0;
    private double lastLng = 0;
    private float lastAccuracy = 0;
    private float lastSpeedMs = 0;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannel();
        networkExecutor = Executors.newSingleThreadExecutor();
        heartbeatHandler = new Handler(Looper.getMainLooper());
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this);
        acquireWakeLock();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) {
            // Restarted by OS after being killed (START_STICKY) — restore from prefs
            restoreFromPrefs();
        } else if (ACTION_STOP.equals(intent.getAction())) {
            stoppedByEmployee = true; // allow onDestroy to wipe prefs
            postTrackingStop(); // tell backend tracking ended
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
            backendUrl = intent.getStringExtra(EXTRA_BACKEND_URL);
            authToken = intent.getStringExtra(EXTRA_TOKEN);
            employeeId = intent.getStringExtra(EXTRA_EMPLOYEE_ID);
            orgId = intent.getStringExtra(EXTRA_ORG_ID);
            if (backendUrl == null) backendUrl = "https://hr.anistonav.com";
            int intervalMinutes = intent.getIntExtra(EXTRA_TRACKING_INTERVAL_MINUTES, 0);
            if (intervalMinutes > 0) {
                // Clamp to [1, 240] minutes — supports 1min through 4hr intervals
                intervalMinutes = Math.max(1, Math.min(240, intervalMinutes));
                gpsIntervalMs = intervalMinutes * 60_000L;
            } else {
                gpsIntervalMs = GPS_INTERVAL_MS_DEFAULT;
            }
            saveToPrefs();
        }

        if (authToken == null || employeeId == null) {
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundNow("Aniston HRMS — GPS Active", "Initialising location…");
        sIsRunning = true;
        startLocationUpdates();
        startHeartbeat();
        return START_STICKY;
    }

    // ── Prefs helpers ────────────────────────────────────────────────────────────

    private void saveToPrefs() {
        getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit()
            .putString(EXTRA_BACKEND_URL, backendUrl)
            .putString(EXTRA_TOKEN, authToken)
            .putString(EXTRA_EMPLOYEE_ID, employeeId)
            .putString(EXTRA_ORG_ID, orgId)
            .putLong(PREFS_KEY_GPS_INTERVAL_MS, gpsIntervalMs)
            .apply();
    }

    private void restoreFromPrefs() {
        SharedPreferences p = getSharedPreferences(PREFS_NAME, MODE_PRIVATE);
        backendUrl = p.getString(EXTRA_BACKEND_URL, "https://hr.anistonav.com");
        authToken  = p.getString(EXTRA_TOKEN, null);
        employeeId = p.getString(EXTRA_EMPLOYEE_ID, null);
        orgId      = p.getString(EXTRA_ORG_ID, null);
        // Read new key first; fall back to old misnamed key for apps upgrading from a
        // previous install where the value was stored under "tracking_interval_minutes".
        if (p.contains(PREFS_KEY_GPS_INTERVAL_MS)) {
            gpsIntervalMs = p.getLong(PREFS_KEY_GPS_INTERVAL_MS, GPS_INTERVAL_MS_DEFAULT);
        } else {
            gpsIntervalMs = p.getLong(EXTRA_TRACKING_INTERVAL_MINUTES, GPS_INTERVAL_MS_DEFAULT);
        }
    }

    // ── Wake lock ────────────────────────────────────────────────────────────────

    private void acquireWakeLock() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AnistonHRMS:GpsWakeLock");
            // 12-hour timeout prevents indefinite wake lock if onDestroy is never called
            wakeLock.acquire(12 * 60 * 60 * 1000L);
        }
    }

    // ── GPS ──────────────────────────────────────────────────────────────────────

    private void startLocationUpdates() {
        // minUpdateInterval must not exceed the requested interval
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

                lastLat      = loc.getLatitude();
                lastLng      = loc.getLongitude();
                lastAccuracy = loc.getAccuracy();
                lastSpeedMs  = loc.getSpeed();

                String kmh  = String.format("%.1f km/h", lastSpeedMs * 3.6f);
                String acc  = String.format("±%.0f m", lastAccuracy);
                String coords = String.format("%.5f, %.5f", lastLat, lastLng);

                updateNotification("GPS Active — " + kmh, coords + "  " + acc);
                postGpsPoint(lastLat, lastLng, lastAccuracy, lastSpeedMs);
            }
        };

        try {
            fusedLocationClient.requestLocationUpdates(req, locationCallback, Looper.getMainLooper());
        } catch (SecurityException e) {
            Log.e(TAG, "Location permission not available", e);
            stopSelf();
        }
    }

    /** Remove existing location updates and re-register with the current gpsIntervalMs. */
    private void restartLocationUpdates() {
        if (locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        startLocationUpdates();
    }

    // ── Heartbeat ────────────────────────────────────────────────────────────────

    private void startHeartbeat() {
        heartbeatRunnable = new Runnable() {
            @Override
            public void run() {
                postHeartbeat();
                heartbeatHandler.postDelayed(this, HEARTBEAT_INTERVAL_MS);
            }
        };
        // First heartbeat immediately, then every 5 min
        heartbeatHandler.post(heartbeatRunnable);
    }

    // ── HTTP helpers ─────────────────────────────────────────────────────────────

    private void postGpsPoint(double lat, double lng, float accuracy, float speed) {
        if (backendUrl == null || authToken == null) return;
        networkExecutor.execute(() -> {
            try {
                JSONObject pt = new JSONObject();
                pt.put("lat", lat);
                pt.put("lng", lng);
                pt.put("accuracy", accuracy);
                // Send speed only when device reports a non-negative value; omit when unknown (speed=0 from loc.getSpeed() when unavailable)
                if (speed >= 0) pt.put("speed", speed);
                pt.put("timestamp", ISO_FORMAT.format(new Date()));

                JSONObject body = new JSONObject();
                body.put("points", new JSONArray().put(pt));

                postJson(backendUrl + "/api/attendance/gps-trail", body.toString());
            } catch (Exception e) {
                Log.w(TAG, "postGpsPoint failed: " + e.getMessage());
            }
        });
    }

    private void postHeartbeat() {
        if (backendUrl == null || authToken == null) return;
        networkExecutor.execute(() -> {
            try {
                postJson(backendUrl + "/api/attendance/gps-heartbeat", "{}");
            } catch (Exception e) {
                Log.w(TAG, "postHeartbeat failed: " + e.getMessage());
            }
        });
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
        URL url = new URL(urlStr);
        HttpURLConnection conn = (HttpURLConnection) url.openConnection();
        conn.setRequestMethod("POST");
        conn.setRequestProperty("Content-Type", "application/json");
        conn.setRequestProperty("Authorization", "Bearer " + authToken);
        conn.setRequestProperty("X-Native-App", "true");
        conn.setDoOutput(true);
        conn.setConnectTimeout(10_000);
        conn.setReadTimeout(10_000);

        byte[] bytes = jsonBody.getBytes("UTF-8");
        conn.setFixedLengthStreamingMode(bytes.length);
        try (OutputStream os = conn.getOutputStream()) {
            os.write(bytes);
        }

        int code = conn.getResponseCode();
        if (code == 401) {
            // Try token from prefs (plugin may have refreshed it)
            String refreshed = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)
                .getString(EXTRA_TOKEN, null);
            if (refreshed != null && !refreshed.equals(authToken)) {
                authToken = refreshed;
            }
        }
        conn.disconnect();
    }

    // ── Notification ─────────────────────────────────────────────────────────────

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID, "GPS Tracking", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Live GPS tracking status for field attendance");
            ch.setShowBadge(false);
            NotificationManager nm = getSystemService(NotificationManager.class);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private void startForegroundNow(String title, String text) {
        Notification n = buildNotification(title, text);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) { // API 34+
            startForeground(NOTIFICATION_ID, n,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) { // API 29+
            startForeground(NOTIFICATION_ID, n,
                android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, n);
        }
    }

    private void updateNotification(String title, String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification(title, text));
    }

    /** Extra key carried on the notification-tap Intent so MainActivity can deep-link. */
    public static final String EXTRA_NAVIGATE = "navigate_to";

    private Notification buildNotification(String title, String text) {
        // Tap notification → open app and navigate to /attendance
        Intent openApp = new Intent(this, MainActivity.class);
        openApp.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openApp.putExtra(EXTRA_NAVIGATE, "/attendance");
        PendingIntent openPi = PendingIntent.getActivity(this, 0, openApp,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        // "Stop Tracking" action in notification
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
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, "Stop Tracking", stopPi)
            .build();
    }

    // ── Lifecycle ────────────────────────────────────────────────────────────────

    /**
     * Called when the user swipes this app off the recents screen.
     * android:stopWithTask="false" means the SERVICE does NOT stop here — but we
     * schedule an AlarmManager restart 3 s out as a safety net for OEM launchers
     * that ignore stopWithTask and kill the service anyway.
     */
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        Log.i(TAG, "onTaskRemoved — scheduling AlarmManager restart in 3s");
        try {
            GpsRestartReceiver.scheduleRestart(this);
        } catch (Exception e) {
            Log.e(TAG, "Failed to schedule GPS restart: " + e.getMessage());
        }
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (locationCallback != null) {
            fusedLocationClient.removeLocationUpdates(locationCallback);
        }
        if (heartbeatRunnable != null) {
            heartbeatHandler.removeCallbacks(heartbeatRunnable);
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        if (networkExecutor != null && !networkExecutor.isShutdown()) {
            networkExecutor.shutdown();
        }
        sIsRunning = false;
        // Only wipe credentials on an explicit employee-initiated stop (ACTION_STOP).
        // OS kills (OOM, task-removal restart) must NOT clear prefs — GpsRestartReceiver
        // reads them to know whether to restart the service after process death.
        // lastStoppedByEmployee is set to true only in the ACTION_STOP handler above.
        if (stoppedByEmployee) {
            getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().clear().apply();
        }
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null; // Not a bound service
    }
}
