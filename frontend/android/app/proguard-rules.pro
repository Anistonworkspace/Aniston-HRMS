# ── Capacitor bridge ──────────────────────────────────────────────────────────
# Keep the Capacitor bridge and all plugin classes so JS↔Native calls work.
-keep class com.getcapacitor.** { *; }
-keep class * extends com.getcapacitor.Plugin { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.CapacitorPlugin <methods>;
    @com.getcapacitor.annotation.Permission <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}

# ── App package ───────────────────────────────────────────────────────────────
-keep class com.anistonav.** { *; }

# ── WebView JavaScript interfaces ─────────────────────────────────────────────
-keepclassmembers class * extends android.webkit.WebViewClient {
    public void *(android.webkit.WebView, java.lang.String, android.graphics.Bitmap);
    public boolean *(android.webkit.WebView, java.lang.String);
}

# ── Background geolocation (uses reflection) ──────────────────────────────────
-keep class com.transistorsoft.** { *; }
-dontwarn com.transistorsoft.**

# ── Capacitor Updater ─────────────────────────────────────────────────────────
-keep class ee.forgr.** { *; }
-dontwarn ee.forgr.**

# ── Suppress common third-party warnings ──────────────────────────────────────
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ── Keep stack traces readable in crash reports ───────────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
