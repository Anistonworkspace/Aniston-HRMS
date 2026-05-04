package com.anistonav.hrms;

import android.os.Build;
import android.util.Log;

import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.concurrent.Executor;

/**
 * Capacitor plugin for biometric authentication (fingerprint / face ID).
 * Used to lock the app after 10 min of background — employee must re-authenticate
 * before accessing payroll, KYC, or other sensitive data.
 *
 * JS usage:
 *   const Biometric = registerPlugin('Biometric');
 *   const { available } = await Biometric.isAvailable();
 *   const { success } = await Biometric.authenticate({ reason: 'Confirm identity' });
 */
@CapacitorPlugin(name = "Biometric")
public class BiometricPlugin extends Plugin {

    private static final String TAG = "BiometricPlugin";

    /** Check if biometric hardware is available and enrolled. */
    @PluginMethod
    public void isAvailable(PluginCall call) {
        BiometricManager bm = BiometricManager.from(getContext());
        int result = bm.canAuthenticate(
                BiometricManager.Authenticators.BIOMETRIC_STRONG
                | BiometricManager.Authenticators.DEVICE_CREDENTIAL);

        JSObject r = new JSObject();
        switch (result) {
            case BiometricManager.BIOMETRIC_SUCCESS:
                r.put("available", true);
                r.put("reason", "ok");
                break;
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                r.put("available", false);
                r.put("reason", "NO_HARDWARE");
                break;
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                r.put("available", false);
                r.put("reason", "HW_UNAVAILABLE");
                break;
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                r.put("available", false);
                r.put("reason", "NONE_ENROLLED");
                break;
            default:
                r.put("available", false);
                r.put("reason", "UNKNOWN");
        }
        call.resolve(r);
    }

    /** Show the biometric prompt. Resolves { success: true } on auth, rejects on failure/cancel. */
    @PluginMethod
    public void authenticate(PluginCall call) {
        String reason = call.getString("reason", "Confirm your identity to continue");

        if (!(getActivity() instanceof FragmentActivity)) {
            call.reject("Activity is not a FragmentActivity");
            return;
        }
        FragmentActivity activity = (FragmentActivity) getActivity();
        Executor executor = ContextCompat.getMainExecutor(getContext());

        BiometricPrompt prompt = new BiometricPrompt(activity, executor,
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                        JSObject r = new JSObject();
                        r.put("success", true);
                        call.resolve(r);
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, CharSequence errString) {
                        Log.w(TAG, "Biometric error " + errorCode + ": " + errString);
                        call.reject("BIOMETRIC_ERROR_" + errorCode, errString.toString());
                    }

                    @Override
                    public void onAuthenticationFailed() {
                        // Single failed attempt — prompt stays open, don't reject yet
                        Log.d(TAG, "Biometric attempt failed — prompt still open");
                    }
                });

        BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle("Aniston HRMS")
                .setSubtitle(reason)
                .setAllowedAuthenticators(
                        BiometricManager.Authenticators.BIOMETRIC_STRONG
                        | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                .build();

        activity.runOnUiThread(() -> prompt.authenticate(info));
    }
}
