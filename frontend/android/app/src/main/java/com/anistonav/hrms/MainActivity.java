package com.anistonav.hrms;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GpsTrackingPlugin.class);
        super.onCreate(savedInstanceState);
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
