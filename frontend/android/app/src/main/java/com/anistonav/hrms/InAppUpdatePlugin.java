package com.anistonav.hrms;

import android.app.Activity;
import android.content.IntentSender;
import android.util.Log;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.appupdate.AppUpdateInfo;
import com.google.android.play.core.appupdate.AppUpdateManager;
import com.google.android.play.core.appupdate.AppUpdateManagerFactory;
import com.google.android.play.core.appupdate.AppUpdateOptions;
import com.google.android.play.core.install.model.AppUpdateType;
import com.google.android.play.core.install.model.UpdateAvailability;

/**
 * Capacitor plugin wrapping Google Play In-App Update API.
 *
 * JS usage:
 *   const InAppUpdate = registerPlugin('InAppUpdate');
 *   const { available, versionCode } = await InAppUpdate.checkUpdate();
 *   if (available) await InAppUpdate.startFlexibleUpdate();
 *   // or: await InAppUpdate.startImmediateUpdate();  (blocks UI until done)
 */
@CapacitorPlugin(name = "InAppUpdate")
public class InAppUpdatePlugin extends Plugin {

    private static final String TAG = "InAppUpdatePlugin";
    private static final int UPDATE_REQUEST_CODE = 9001;

    private AppUpdateManager appUpdateManager;
    private PluginCall pendingUpdateCall;

    @Override
    public void load() {
        appUpdateManager = AppUpdateManagerFactory.create(getContext());
    }

    /**
     * Check if an update is available on Play Store.
     * Returns { available: boolean, versionCode: number, updateType: 'FLEXIBLE'|'IMMEDIATE' }
     */
    @PluginMethod
    public void checkUpdate(PluginCall call) {
        appUpdateManager.getAppUpdateInfo().addOnSuccessListener(info -> {
            JSObject result = new JSObject();
            boolean available = info.updateAvailability() == UpdateAvailability.UPDATE_AVAILABLE;
            result.put("available", available);
            result.put("versionCode", info.availableVersionCode());

            // Recommend IMMEDIATE for staleness > 7 days, FLEXIBLE otherwise
            int staleness = info.clientVersionStalenessDays() != null
                    ? info.clientVersionStalenessDays() : 0;
            boolean immediate = staleness >= 7;
            result.put("updateType", immediate ? "IMMEDIATE" : "FLEXIBLE");
            result.put("stalenessDays", staleness);
            call.resolve(result);
        }).addOnFailureListener(e -> {
            Log.w(TAG, "checkUpdate failed: " + e.getMessage());
            JSObject result = new JSObject();
            result.put("available", false);
            result.put("error", e.getMessage());
            call.resolve(result);
        });
    }

    /**
     * Start a FLEXIBLE update (downloads in background, user can continue using app).
     * Call completeFlexibleUpdate() once download completes to trigger install.
     */
    @PluginMethod
    public void startFlexibleUpdate(PluginCall call) {
        pendingUpdateCall = call;
        appUpdateManager.getAppUpdateInfo().addOnSuccessListener(info -> {
            if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE
                    && info.updateAvailability() != UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                JSObject r = new JSObject();
                r.put("started", false);
                r.put("reason", "No update available");
                call.resolve(r);
                return;
            }
            try {
                appUpdateManager.startUpdateFlowForResult(
                        info,
                        getActivity(),
                        AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build(),
                        UPDATE_REQUEST_CODE
                );
            } catch (IntentSender.SendIntentException e) {
                Log.e(TAG, "startFlexibleUpdate failed", e);
                call.reject("Failed to start update: " + e.getMessage());
            }
        }).addOnFailureListener(e -> call.reject("getAppUpdateInfo failed: " + e.getMessage()));
    }

    /**
     * Start an IMMEDIATE update (full-screen blocking UI — use for critical updates).
     */
    @PluginMethod
    public void startImmediateUpdate(PluginCall call) {
        pendingUpdateCall = call;
        appUpdateManager.getAppUpdateInfo().addOnSuccessListener(info -> {
            if (info.updateAvailability() != UpdateAvailability.UPDATE_AVAILABLE
                    && info.updateAvailability() != UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS) {
                JSObject r = new JSObject();
                r.put("started", false);
                r.put("reason", "No update available");
                call.resolve(r);
                return;
            }
            try {
                appUpdateManager.startUpdateFlowForResult(
                        info,
                        getActivity(),
                        AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build(),
                        UPDATE_REQUEST_CODE
                );
            } catch (IntentSender.SendIntentException e) {
                Log.e(TAG, "startImmediateUpdate failed", e);
                call.reject("Failed to start update: " + e.getMessage());
            }
        }).addOnFailureListener(e -> call.reject("getAppUpdateInfo failed: " + e.getMessage()));
    }

    /**
     * Complete a FLEXIBLE update — triggers the install (app restarts).
     * Only needed after FLEXIBLE download finishes. Not needed for IMMEDIATE.
     */
    @PluginMethod
    public void completeFlexibleUpdate(PluginCall call) {
        appUpdateManager.completeUpdate();
        call.resolve();
    }

    @ActivityCallback
    private void updateFlowResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject r = new JSObject();
        r.put("resultCode", result.getResultCode());
        r.put("started", result.getResultCode() == Activity.RESULT_OK);
        call.resolve(r);
    }
}
