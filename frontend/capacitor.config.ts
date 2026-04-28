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
    CapacitorUpdater: {
      autoUpdate: false,
      updateUrl: 'https://hr.anistonav.com/api/app-updates/latest',
      statsUrl: '',
      channelUrl: '',
    },

    SplashScreen: {
      launchShowDuration: 1800,
      backgroundColor: '#0f172a',   // dark navy — matches app sidebar
      showSpinner: false,
      androidSplashResourceName: 'splash',
      iosSplashResourceName: 'LaunchScreen',
      splashFullScreen: true,
      splashImmersive: true,
    },

    Geolocation: {
      // Android: request ACCESS_BACKGROUND_LOCATION so GPS works with screen off
      // User sees the "Allow all the time" dialog on first tracking start
    },

    BackgroundGeolocation: {
      // Foreground service notification shown while GPS tracking is active.
      // This keeps the Android process alive when screen is off / app is backgrounded.
      // Without this, Android 8+ kills the WebView process after ~1 min in background.
    },
  },
};

export default config;
