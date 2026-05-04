package com.anistonav.hrms;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Returns current network type and estimated bandwidth.
 * Used by GPS sync to decide batch size: small batches on WiFi/4G, larger batches on 2G/3G.
 */
@CapacitorPlugin(name = "NetworkQuality")
public class NetworkQualityPlugin extends Plugin {

    @PluginMethod
    public void getNetworkQuality(PluginCall call) {
        JSObject result = getQuality(getContext());
        call.resolve(result);
    }

    public static JSObject getQuality(Context context) {
        JSObject result = new JSObject();
        result.put("type", "UNKNOWN");
        result.put("bandwidthKbps", 0);
        result.put("isHighSpeed", false);

        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return result;

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Network net = cm.getActiveNetwork();
            if (net == null) {
                result.put("type", "OFFLINE");
                return result;
            }
            NetworkCapabilities caps = cm.getNetworkCapabilities(net);
            if (caps == null) return result;

            int downKbps = caps.getLinkDownstreamBandwidthKbps();
            result.put("bandwidthKbps", downKbps);

            if (caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)
                    || caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET)) {
                result.put("type", "WIFI");
                result.put("isHighSpeed", true);
            } else if (caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) {
                // > 1 Mbps = 4G/LTE, 150–1000 Kbps = 3G, < 150 Kbps = 2G/edge
                if (downKbps >= 1000) {
                    result.put("type", "4G");
                    result.put("isHighSpeed", true);
                } else if (downKbps >= 150) {
                    result.put("type", "3G");
                    result.put("isHighSpeed", false);
                } else {
                    result.put("type", "2G");
                    result.put("isHighSpeed", false);
                }
            }
        }
        return result;
    }
}
