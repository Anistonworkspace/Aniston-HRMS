package com.anistonav.hrms;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor Plugin — bridges JavaScript to the native GpsTrackingService.
 *
 * JS usage (after registering in MainActivity):
 *   import { registerPlugin } from '@capacitor/core';
 *   const GpsTracking = registerPlugin('GpsTracking');
 *   await GpsTracking.start({ backendUrl, authToken, employeeId, orgId });
 *   await GpsTracking.stop();
 *   await GpsTracking.updateToken({ token: newToken });
 *   const { running } = await GpsTracking.isRunning();
 */
@CapacitorPlugin(name = "GpsTracking")
public class GpsTrackingPlugin extends Plugin {

    private static final String TAG = "GpsTrackingPlugin";

    @PluginMethod
    public void start(PluginCall call) {
        String backendUrl  = call.getString("backendUrl", "https://hr.anistonav.com");
        String authToken   = call.getString("authToken");
        String employeeId  = call.getString("employeeId");
        String orgId       = call.getString("orgId", "");
        int trackingIntervalMinutes = call.getInt("trackingIntervalMinutes", 60);

        if (authToken == null || authToken.isEmpty()) {
            call.reject("authToken is required");
            return;
        }
        if (employeeId == null || employeeId.isEmpty()) {
            call.reject("employeeId is required");
            return;
        }

        Context ctx = getContext();
        Intent intent = new Intent(ctx, GpsTrackingService.class);
        intent.putExtra(GpsTrackingService.EXTRA_BACKEND_URL, backendUrl);
        intent.putExtra(GpsTrackingService.EXTRA_TOKEN, authToken);
        intent.putExtra(GpsTrackingService.EXTRA_EMPLOYEE_ID, employeeId);
        intent.putExtra(GpsTrackingService.EXTRA_ORG_ID, orgId);
        intent.putExtra(GpsTrackingService.EXTRA_TRACKING_INTERVAL_MINUTES, trackingIntervalMinutes);

        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ctx.startForegroundService(intent);
            } else {
                ctx.startService(intent);
            }
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Failed to start GPS service", e);
            call.reject("Failed to start GPS tracking: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        Intent intent = new Intent(ctx, GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_STOP);
        try {
            ctx.startService(intent);
        } catch (Exception e) {
            Log.w(TAG, "Stop service failed (already stopped?): " + e.getMessage());
        }
        call.resolve();
    }

    @PluginMethod
    public void updateToken(PluginCall call) {
        String newToken = call.getString("token");
        if (newToken == null || newToken.isEmpty()) {
            call.reject("token is required");
            return;
        }

        Context ctx = getContext();

        // Update SharedPreferences so service picks it up on next read
        ctx.getSharedPreferences(GpsTrackingService.PREFS_NAME, Context.MODE_PRIVATE)
            .edit()
            .putString(GpsTrackingService.EXTRA_TOKEN, newToken)
            .apply();

        // If service is running, send the update via Intent too
        Intent intent = new Intent(ctx, GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_UPDATE_TOKEN);
        intent.putExtra(GpsTrackingService.EXTRA_TOKEN, newToken);
        try {
            ctx.startService(intent);
        } catch (Exception e) {
            Log.w(TAG, "updateToken intent failed (service may not be running): " + e.getMessage());
        }

        call.resolve();
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        // Use the static volatile field — reliable even after OOM kill because
        // a new process starts with sIsRunning = false (static default).
        // SharedPreferences can falsely say "running" if onDestroy was skipped by the OS.
        JSObject result = new JSObject();
        result.put("running", GpsTrackingService.sIsRunning);
        call.resolve(result);
    }

    /**
     * Update the GPS tracking interval in a running service without restarting it.
     * Called when HR reassigns an employee to a different shift mid-day.
     * No-op if the service is not currently running.
     */
    @PluginMethod
    public void updateInterval(PluginCall call) {
        int minutes = call.getInt("minutes", 60);

        Context ctx = getContext();
        Intent intent = new Intent(ctx, GpsTrackingService.class);
        intent.setAction(GpsTrackingService.ACTION_UPDATE_INTERVAL);
        intent.putExtra(GpsTrackingService.EXTRA_TRACKING_INTERVAL_MINUTES, minutes);
        try {
            ctx.startService(intent);
        } catch (Exception e) {
            Log.w(TAG, "updateInterval intent failed (service may not be running): " + e.getMessage());
        }
        call.resolve();
    }
}
