package com.anistonav.hrms;

import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GpsTrackingPlugin.class);
        registerPlugin(CrashReporterPlugin.class);
        registerPlugin(InAppUpdatePlugin.class);
        registerPlugin(NetworkQualityPlugin.class);
        registerPlugin(BiometricPlugin.class);
        registerPlugin(ShiftReminderPlugin.class);
        registerPlugin(PermissionPlugin.class);
        super.onCreate(savedInstanceState);
        // Schedule GPS watchdog (no-op if already scheduled; KEEP policy prevents duplicates)
        GpsWatchdogWorker.schedule(this);
        // Cold-start path: app was fully killed when user tapped the GPS notification.
        // onCreate() is called instead of onNewIntent(), so we read the launch intent here.
        // Delay is required — the Capacitor bridge and WebView need a moment to initialise
        // before evaluateJavascript() can run.
        handleNavigateIntentWithDelay(getIntent(), 500);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        // Hot path: app was backgrounded/foregrounded when user tapped the notification.
        // Bridge is already initialised so a short delay is sufficient.
        handleNavigateIntentWithDelay(intent, 100);
    }

    /**
     * Auto-restart GPS service on every resume if:
     *   1. Saved credentials exist in SharedPreferences (employee was checked-in before)
     *   2. GpsTrackingService is not already running
     *
     * This fills the gap between the 15-min WorkManager watchdog ticks — if an employee
     * opens the app tab-switched or after a brief swipe-to-recents, GPS resumes immediately
     * without requiring them to navigate to the Attend tab.
     */
    @Override
    public void onResume() {
        super.onResume();
        tryAutoRestartGps();
    }

    private void tryAutoRestartGps() {
        if (GpsTrackingService.sIsRunning) return;

        SharedPreferences prefs = getSharedPreferences(GpsTrackingService.PREFS_NAME, MODE_PRIVATE);
        String token = prefs.getString(GpsTrackingService.EXTRA_TOKEN, null);
        String employeeId = prefs.getString(GpsTrackingService.EXTRA_EMPLOYEE_ID, null);
        String orgId = prefs.getString(GpsTrackingService.EXTRA_ORG_ID, null);
        String backendUrl = prefs.getString(GpsTrackingService.EXTRA_BACKEND_URL, null);

        if (token == null || token.isEmpty()) return;
        if (employeeId == null || employeeId.isEmpty()) return;

        Intent svc = new Intent(this, GpsTrackingService.class);
        svc.putExtra(GpsTrackingService.EXTRA_TOKEN, token);
        svc.putExtra(GpsTrackingService.EXTRA_EMPLOYEE_ID, employeeId);
        if (orgId != null) svc.putExtra(GpsTrackingService.EXTRA_ORG_ID, orgId);
        if (backendUrl != null) svc.putExtra(GpsTrackingService.EXTRA_BACKEND_URL, backendUrl);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(svc);
        } else {
            startService(svc);
        }

        // Notify the React/JS side that GPS was auto-restarted so it can refresh the
        // Attendance UI without requiring the employee to tap the Attend tab.
        // Small delay: bridge needs ~300ms after onResume before evaluateJavascript works.
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            try {
                if (getBridge() != null && getBridge().getWebView() != null) {
                    getBridge().getWebView().evaluateJavascript(
                        "window.dispatchEvent(new CustomEvent('gps:auto-restarted'))", null);
                }
            } catch (Exception ignored) {}
        }, 400);
    }

    private void handleNavigateIntentWithDelay(Intent intent, long delayMs) {
        if (intent == null) return;
        String navigateTo = intent.getStringExtra(GpsTrackingService.EXTRA_NAVIGATE);
        if (navigateTo == null || navigateTo.isEmpty()) return;

        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            boolean navigated = deepLinkWebView(navigateTo);
            if (!navigated) {
                // Bridge/WebView not ready yet on cold start — retry once after a longer delay.
                new Handler(Looper.getMainLooper()).postDelayed(
                    () -> deepLinkWebView(navigateTo), 700);
            }
        }, delayMs);
    }

    /**
     * Navigate the Capacitor WebView to the given SPA path.
     * Returns true if the navigation was dispatched, false if the bridge/WebView
     * was not yet ready (caller can retry).
     */
    private boolean deepLinkWebView(String path) {
        if (getBridge() == null) return false;
        WebView webView = getBridge().getWebView();
        if (webView == null) return false;
        // Escape backslashes first, then single quotes — path values are internal constants
        // but we sanitise defensively to prevent script injection.
        String safePath = path.replace("\\", "\\\\").replace("'", "\\'");
        webView.post(() ->
            webView.evaluateJavascript(
                "window.location.replace('" + safePath + "')", null));
        return true;
    }
}
