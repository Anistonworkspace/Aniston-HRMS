package com.equimaps.capacitor_background_geolocation;

import android.app.Notification;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.location.Location;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;

import com.getcapacitor.Logger;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationAvailability;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;

import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.TimeZone;

import androidx.localbroadcastmanager.content.LocalBroadcastManager;

// A started + bound foreground service for continuous GPS tracking.
// Survives force-close (android:stopWithTask="false" + START_STICKY).
// When the app is killed, switches to direct HTTP posting so location
// data reaches the backend without the JS/Capacitor bridge.
public class BackgroundGeolocationService extends Service {
    static final String ACTION_BROADCAST = (
            BackgroundGeolocationService.class.getPackage().getName() + ".broadcast"
    );
    private final IBinder binder = new LocalBinder();

    private static final int NOTIFICATION_ID = 28351;
    private static final String PREFS_NAME = "AnistonGPS";
    private static final String PREF_BACKEND_URL = "backendUrl";
    private static final String PREF_AUTH_TOKEN = "authToken";

    private String backendUrl = null;
    private String authToken = null;
    // true when app process was killed — GPS data goes directly via HTTP
    private boolean isOrphaned = false;

    private class Watcher {
        public String id;
        public FusedLocationProviderClient client;
        public LocationRequest locationRequest;
        public LocationCallback locationCallback;
        public Notification backgroundNotification;
    }
    private HashSet<Watcher> watchers = new HashSet<Watcher>();

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        // Restore credentials from SharedPreferences on START_STICKY restart
        if (intent == null) {
            SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            backendUrl = prefs.getString(PREF_BACKEND_URL, null);
            authToken = prefs.getString(PREF_AUTH_TOKEN, null);
            Logger.debug("BackgroundGeolocationService: restarted by OS, credentials restored");
        }
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        resetToConnectedMode();
        return binder;
    }

    // onUnbind returns true so onRebind() fires when app reconnects
    @Override
    public boolean onUnbind(Intent intent) {
        isOrphaned = true;
        Logger.debug("BackgroundGeolocationService: app killed, orphaned mode — posting GPS directly to backend");
        // Do NOT remove location callbacks — tracking continues
        return true;
    }

    @Override
    public void onRebind(Intent intent) {
        resetToConnectedMode();
        super.onRebind(intent);
    }

    // Called when user swipes app from Recent Apps — keep running
    @Override
    public void onTaskRemoved(Intent rootIntent) {
        Logger.debug("BackgroundGeolocationService: task removed, continuing orphaned GPS tracking");
        super.onTaskRemoved(rootIntent);
    }

    private void resetToConnectedMode() {
        isOrphaned = false;
        // Clear stale watchers from previous process; app will re-register
        for (Watcher watcher : watchers) {
            watcher.client.removeLocationUpdates(watcher.locationCallback);
        }
        watchers = new HashSet<Watcher>();
    }

    Notification getNotification() {
        for (Watcher watcher : watchers) {
            if (watcher.backgroundNotification != null) {
                return watcher.backgroundNotification;
            }
        }
        return null;
    }

    private void postToBackend(final Location location) {
        if (backendUrl == null || authToken == null) return;
        final String url = backendUrl + "/api/attendance/gps-trail";
        final String token = authToken;
        final double lat = location.getLatitude();
        final double lng = location.getLongitude();
        final float accuracy = location.hasAccuracy() ? location.getAccuracy() : 0f;
        final float speed = location.hasSpeed() ? location.getSpeed() : 0f;

        SimpleDateFormat sdf = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        sdf.setTimeZone(TimeZone.getTimeZone("UTC"));
        final String timestamp = sdf.format(new Date(location.getTime()));

        new Thread(new Runnable() {
            @Override
            public void run() {
                HttpURLConnection conn = null;
                try {
                    conn = (HttpURLConnection) new URL(url).openConnection();
                    conn.setRequestMethod("POST");
                    conn.setRequestProperty("Content-Type", "application/json");
                    conn.setRequestProperty("Authorization", "Bearer " + token);
                    conn.setDoOutput(true);
                    conn.setConnectTimeout(10000);
                    conn.setReadTimeout(10000);

                    String body = "{\"points\":[{"
                            + "\"lat\":" + lat
                            + ",\"lng\":" + lng
                            + ",\"accuracy\":" + accuracy
                            + ",\"speed\":" + speed
                            + ",\"timestamp\":\"" + timestamp + "\""
                            + "}]}";

                    OutputStream os = conn.getOutputStream();
                    os.write(body.getBytes("UTF-8"));
                    os.close();

                    int code = conn.getResponseCode();
                    if (code == 401) {
                        // Token expired — stop trying until app refreshes it
                        Logger.debug("BackgroundGeolocationService: token expired, pausing direct posts");
                        authToken = null;
                    }
                } catch (Exception e) {
                    Logger.error("BackgroundGeolocationService: GPS post failed", e);
                } finally {
                    if (conn != null) conn.disconnect();
                }
            }
        }).start();
    }

    public class LocalBinder extends Binder {

        void setCredentials(String url, String token) {
            backendUrl = url;
            authToken = token;
            getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                    .edit()
                    .putString(PREF_BACKEND_URL, url)
                    .putString(PREF_AUTH_TOKEN, token)
                    .apply();
        }

        void addWatcher(
                final String id,
                Notification backgroundNotification,
                float distanceFilter
        ) {
            FusedLocationProviderClient client = LocationServices.getFusedLocationProviderClient(
                    BackgroundGeolocationService.this
            );
            LocationRequest locationRequest = new LocationRequest();
            locationRequest.setMaxWaitTime(1000);
            locationRequest.setInterval(1000);
            locationRequest.setPriority(LocationRequest.PRIORITY_HIGH_ACCURACY);
            locationRequest.setSmallestDisplacement(distanceFilter);

            LocationCallback callback = new LocationCallback() {
                @Override
                public void onLocationResult(LocationResult locationResult) {
                    Location location = locationResult.getLastLocation();
                    if (!isOrphaned) {
                        // App alive — use LocalBroadcast (JS handles posting to backend)
                        Intent intent = new Intent(ACTION_BROADCAST);
                        intent.putExtra("location", location);
                        intent.putExtra("id", id);
                        LocalBroadcastManager.getInstance(
                                getApplicationContext()
                        ).sendBroadcast(intent);
                    } else {
                        // App killed — post directly to backend from Java
                        postToBackend(location);
                    }
                }

                @Override
                public void onLocationAvailability(LocationAvailability availability) {
                    if (!availability.isLocationAvailable()) {
                        Logger.debug("Location not available");
                    }
                }
            };

            Watcher watcher = new Watcher();
            watcher.id = id;
            watcher.client = client;
            watcher.locationRequest = locationRequest;
            watcher.locationCallback = callback;
            watcher.backgroundNotification = backgroundNotification;
            watchers.add(watcher);

            try {
                watcher.client.requestLocationUpdates(
                        watcher.locationRequest,
                        watcher.locationCallback,
                        null
                );
            } catch (SecurityException ignore) {}

            if (backgroundNotification != null) {
                try {
                    startForeground(NOTIFICATION_ID, backgroundNotification);
                } catch (Exception exception) {
                    Logger.error("Failed to start foreground service", exception);
                }
            }
        }

        void removeWatcher(String id) {
            for (Watcher watcher : watchers) {
                if (watcher.id.equals(id)) {
                    watcher.client.removeLocationUpdates(watcher.locationCallback);
                    watchers.remove(watcher);
                    if (getNotification() == null) {
                        stopForeground(true);
                        // All watchers removed (employee checked out) — stop service
                        stopSelf();
                    }
                    return;
                }
            }
        }

        void onPermissionsGranted() {
            for (Watcher watcher : watchers) {
                watcher.client.removeLocationUpdates(watcher.locationCallback);
                watcher.client.requestLocationUpdates(
                        watcher.locationRequest,
                        watcher.locationCallback,
                        null
                );
            }
        }

        void stopService() {
            for (Watcher watcher : watchers) {
                watcher.client.removeLocationUpdates(watcher.locationCallback);
            }
            watchers = new HashSet<Watcher>();
            BackgroundGeolocationService.this.stopForeground(true);
            BackgroundGeolocationService.this.stopSelf();
        }
    }
}
