package com.anistonav.hrms;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GpsTrackingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
