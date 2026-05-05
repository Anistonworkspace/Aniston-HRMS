package com.anistonav.hrms;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * PermissionPlugin — exposes a single Capacitor bridge for all runtime permission
 * checks and requests needed by the GPS tracking / notification flow.
 *
 * Methods:
 *   checkAllPermissions()        → { location, backgroundLocation, notifications, batteryOptimization, gpsEnabled }
 *   requestNotificationPermission() → { granted: boolean }
 *   isGpsEnabled()               → { enabled: boolean }
 *   openGpsSettings()            → void  (opens Settings.ACTION_LOCATION_SOURCE_SETTINGS)
 *   openAppSettings()            → void  (opens app details settings for manual permission grant)
 */
@CapacitorPlugin(name = "AppPermissions")
public class PermissionPlugin extends Plugin {

    // ── checkAllPermissions ───────────────────────────────────────────────────

    @PluginMethod
    public void checkAllPermissions(PluginCall call) {
        Activity ctx = getActivity();
        JSObject result = new JSObject();

        // Foreground location
        boolean fineLocation = ActivityCompat.checkSelfPermission(ctx,
                Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarseLocation = ActivityCompat.checkSelfPermission(ctx,
                Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        result.put("location", fineLocation || coarseLocation);

        // Background location (Android 10+; always true on older versions)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            boolean bgLocation = ActivityCompat.checkSelfPermission(ctx,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED;
            result.put("backgroundLocation", bgLocation);
        } else {
            result.put("backgroundLocation", true);
        }

        // Notifications (Android 13+; always true on older versions)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            boolean notifs = ActivityCompat.checkSelfPermission(ctx,
                    Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            result.put("notifications", notifs);
        } else {
            // Pre-Android 13: notifications enabled if channel not blocked
            result.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        }

        // Battery optimization exemption
        android.os.PowerManager pm = (android.os.PowerManager)
                ctx.getSystemService(android.content.Context.POWER_SERVICE);
        boolean batteryExempt = pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName());
        result.put("batteryOptimization", batteryExempt);

        // GPS provider enabled
        LocationManager lm = (LocationManager) ctx.getSystemService(android.content.Context.LOCATION_SERVICE);
        boolean gpsOn = lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        result.put("gpsEnabled", gpsOn);

        call.resolve(result);
    }

    // ── requestNotificationPermission ────────────────────────────────────────

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // Android 13+ requires runtime permission for POST_NOTIFICATIONS
            boolean already = ActivityCompat.checkSelfPermission(getActivity(),
                    Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            if (already) {
                JSObject r = new JSObject();
                r.put("granted", true);
                call.resolve(r);
                return;
            }
            // Request via ActivityCompat — result handled by Capacitor's permission callback
            ActivityCompat.requestPermissions(getActivity(),
                    new String[]{ Manifest.permission.POST_NOTIFICATIONS }, 9001);
            // We can't await the system dialog result here; resolve optimistically.
            // The JS side re-checks via checkAllPermissions() after a short delay.
            JSObject r = new JSObject();
            r.put("granted", false);
            r.put("prompted", true);
            call.resolve(r);
        } else {
            // Pre-Android 13: always granted
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
        }
    }

    // ── isGpsEnabled ─────────────────────────────────────────────────────────

    @PluginMethod
    public void isGpsEnabled(PluginCall call) {
        LocationManager lm = (LocationManager)
                getActivity().getSystemService(android.content.Context.LOCATION_SERVICE);
        boolean enabled = lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        JSObject r = new JSObject();
        r.put("enabled", enabled);
        call.resolve(r);
    }

    // ── openGpsSettings ──────────────────────────────────────────────────────

    @PluginMethod
    public void openGpsSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
        call.resolve();
    }

    // ── openAppSettings ──────────────────────────────────────────────────────

    @PluginMethod
    public void openAppSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        intent.setData(android.net.Uri.fromParts("package", getActivity().getPackageName(), null));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
        call.resolve();
    }
}
