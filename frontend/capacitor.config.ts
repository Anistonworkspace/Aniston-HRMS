import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.anistonav.hrms',
  appName: 'Aniston HRMS',
  webDir: 'dist',

  server: {
    // androidScheme: 'https' keeps cookies / local-storage secure on Android
    androidScheme: 'https',
    // In development, uncomment + set your local IP to live-reload from dev server:
    // url: 'http://192.168.1.X:5173',
    // cleartext: true,
  },

  plugins: {
    // ── Self-hosted OTA updates via @capgo/capacitor-updater ────────────────
    // autoUpdate: false → we control when/what to show the update UI.
    // updateUrl points to our own Express endpoint that returns the manifest.
    // After a new web build is ready, zip frontend/dist/ and place it in
    // backend/app-updates/bundle-<version>.zip, then bump manifest.json.
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: 'https://hr.anistonav.com/api/app-updates/latest',
      statsUrl: '',         // disable capgo cloud analytics (self-hosted)
      channelUrl: '',       // disable capgo cloud channel (self-hosted)
    },

    SplashScreen: {
      launchShowDuration: 1800,
      backgroundColor: '#ffffff',
      showSpinner: false,
      androidSplashResourceName: 'splash',
      iosSplashResourceName: 'LaunchScreen',
      splashFullScreen: true,
      splashImmersive: true,
    },
  },
};

export default config;
