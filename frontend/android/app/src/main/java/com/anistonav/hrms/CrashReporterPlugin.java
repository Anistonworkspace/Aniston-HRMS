package com.anistonav.hrms;

import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
 * Custom crash reporter — replaces Firebase Crashlytics.
 * Posts crash reports directly to the Aniston HRMS backend.
 * No third-party account required.
 *
 * Also installs a global UncaughtExceptionHandler for Java-level crashes.
 * JS errors are reported via the report() PluginMethod.
 */
@CapacitorPlugin(name = "CrashReporter")
public class CrashReporterPlugin extends Plugin {

    private static final String TAG = "CrashReporter";
    private static final SimpleDateFormat ISO_FMT;
    static {
        ISO_FMT = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US);
        ISO_FMT.setTimeZone(TimeZone.getTimeZone("UTC"));
    }

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @Override
    public void load() {
        installUncaughtExceptionHandler();
    }

    /** Called from JS to report a JS/React error (ErrorBoundary, unhandledrejection, etc.) */
    @PluginMethod
    public void report(PluginCall call) {
        String message   = call.getString("message", "Unknown error");
        String stack     = call.getString("stack", "");
        String errorType = call.getString("type", "JS_ERROR");
        String route     = call.getString("route", "");

        postCrash(errorType, message, stack, route);
        call.resolve();
    }

    /** Called from JS to report a native crash that was caught and re-thrown. */
    @PluginMethod
    public void reportNative(PluginCall call) {
        String message = call.getString("message", "Native crash");
        String stack   = call.getString("stack", "");
        postCrash("NATIVE_CRASH", message, stack, "");
        call.resolve();
    }

    private void installUncaughtExceptionHandler() {
        Thread.UncaughtExceptionHandler existing = Thread.getDefaultUncaughtExceptionHandler();
        Thread.setDefaultUncaughtExceptionHandler((thread, throwable) -> {
            try {
                StringBuilder sb = new StringBuilder();
                for (StackTraceElement el : throwable.getStackTrace()) {
                    sb.append("  at ").append(el.toString()).append("\n");
                }
                Throwable cause = throwable.getCause();
                if (cause != null) {
                    sb.append("Caused by: ").append(cause.getMessage()).append("\n");
                    for (StackTraceElement el : cause.getStackTrace()) {
                        sb.append("  at ").append(el.toString()).append("\n");
                    }
                }
                postCrash("JAVA_CRASH", throwable.getMessage() != null ? throwable.getMessage() : throwable.getClass().getName(), sb.toString(), "thread:" + thread.getName());
                // Give the network call ~3s to complete before the process dies
                Thread.sleep(3000);
            } catch (Exception ignored) { }
            if (existing != null) existing.uncaughtException(thread, throwable);
        });
    }

    private void postCrash(String type, String message, String stack, String context) {
        SharedPreferences prefs = getContext().getSharedPreferences(
                GpsTrackingService.PREFS_NAME, android.content.Context.MODE_PRIVATE);
        String backendUrl = prefs.getString(GpsTrackingService.EXTRA_BACKEND_URL, "https://hr.anistonav.com");
        String authToken  = prefs.getString(GpsTrackingService.EXTRA_TOKEN, null);
        String employeeId = prefs.getString(GpsTrackingService.EXTRA_EMPLOYEE_ID, null);

        executor.execute(() -> {
            try {
                JSONObject body = new JSONObject();
                body.put("type",       type);
                body.put("message",    message != null ? message : "");
                body.put("stack",      stack   != null ? stack   : "");
                body.put("context",    context != null ? context : "");
                body.put("appVersion", "1.2.0");
                body.put("platform",   "android");
                body.put("osVersion",  Build.VERSION.RELEASE);
                body.put("device",     Build.MANUFACTURER + " " + Build.MODEL);
                body.put("timestamp",  ISO_FMT.format(new Date()));
                if (employeeId != null) body.put("employeeId", employeeId);

                URL url = new URL(backendUrl + "/api/crash-reports");
                HttpURLConnection conn = (HttpURLConnection) url.openConnection();
                conn.setRequestMethod("POST");
                conn.setRequestProperty("Content-Type", "application/json");
                if (authToken != null) conn.setRequestProperty("Authorization", "Bearer " + authToken);
                conn.setRequestProperty("X-Native-App", "true");
                conn.setDoOutput(true);
                conn.setConnectTimeout(8_000);
                conn.setReadTimeout(8_000);

                byte[] bytes = body.toString().getBytes("UTF-8");
                conn.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream os = conn.getOutputStream()) { os.write(bytes); }
                conn.getResponseCode(); // consume response
                conn.disconnect();
                Log.d(TAG, "Crash report posted: " + type + " — " + message);
            } catch (Exception e) {
                Log.w(TAG, "Failed to post crash report: " + e.getMessage());
            }
        });
    }
}
