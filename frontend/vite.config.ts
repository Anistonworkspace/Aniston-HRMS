import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'autoUpdate' silently activates new SW — best for enterprise apps
      // Also ensures SW registers immediately (no user prompt needed) so PWABuilder can detect it
      registerType: 'autoUpdate',
      // Inject SW registration script inline in index.html — runs before React mounts,
      // ensuring PWABuilder and store validators always see a registered SW on first visit
      injectRegister: 'inline',
      includeAssets: [
        'logo.png',
        'icon-192.png',
        'icon-512.png',
        'icon-maskable-192.png',
        'icon-maskable-512.png',
        'offline.html',
        'screenshots/*.png',
        'apple-splash/*.png',
      ],
      manifest: {
        name: 'Aniston HRMS',
        short_name: 'Aniston',
        description: 'Enterprise Human Resource Management System — Attendance, Leave, Payroll & more',
        start_url: '/dashboard?source=pwa',
        scope: '/',
        // Unique app identity — used by browsers to track install state
        id: 'com.aniston.hrms',
        display: 'standalone',
        // Window Controls Overlay → custom title bar on desktop Chrome/Edge
        // standalone → normal installed mode
        // minimal-ui → fallback for browsers that don't support WCO
        display_override: ['window-controls-overlay', 'standalone', 'minimal-ui'],
        background_color: '#f8fafc',
        theme_color: '#4F46E5',
        orientation: 'portrait-primary',
        lang: 'en',
        dir: 'ltr',
        categories: ['business', 'productivity'],
        // false = prefer this web app over any native apps
        prefer_related_applications: false,
        // IARC content rating — get your free certificate at https://www.globalratings.com/
        // Required for Play Store submission. Replace this placeholder with your actual ID.
        iarc_rating_id: 'e84b072d-71b3-4d3e-86ae-31a8ce4e53b7',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/icon-maskable-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: '/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        // Screenshots must be real app screenshots for store submission.
        // Replace placeholder files in frontend/public/screenshots/ with actual captured PNGs.
        // Narrow: 1080×1920 (portrait mobile), Wide: 1280×800 (landscape desktop)
        screenshots: [
          {
            src: '/screenshots/mobile-dashboard.png',
            sizes: '1080x1920',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Aniston HRMS — Dashboard',
          },
          {
            src: '/screenshots/mobile-attendance.png',
            sizes: '1080x1920',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Aniston HRMS — Attendance Tracker',
          },
          {
            src: '/screenshots/mobile-leave.png',
            sizes: '1080x1920',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Aniston HRMS — Leave Management',
          },
          {
            src: '/screenshots/desktop-dashboard.png',
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Aniston HRMS — Desktop Dashboard',
          },
          {
            src: '/screenshots/desktop-payroll.png',
            sizes: '1280x800',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Aniston HRMS — Payroll Management',
          },
        ],
        shortcuts: [
          {
            name: 'Dashboard',
            short_name: 'Home',
            url: '/dashboard',
            description: 'View HRMS dashboard and analytics',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Mark Attendance',
            short_name: 'Attend',
            url: '/attendance',
            description: 'Clock in or out for today',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'Apply Leave',
            short_name: 'Leave',
            url: '/leaves',
            description: 'Apply for leave or check balance',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
          {
            name: 'My Profile',
            short_name: 'Profile',
            url: '/profile',
            description: 'View and edit your employee profile',
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
          },
        ],
        // Single-instance: focus existing window instead of opening a new one
        launch_handler: {
          client_mode: ['focus-existing', 'auto'],
        },
        // Related native apps — fill in after publishing to stores:
        // { platform: 'play', url: '...', id: 'com.aniston.hrms' }
        // { platform: 'itunes', url: '...' }
        related_applications: [],
        // Allow PWA to navigate to these origins without leaving app context
        scope_extensions: [
          { origin: 'https://hr.anistonav.com' },
        ],
        // OS share sheet integration — users can share URLs/text to HRMS
        share_target: {
          action: '/share-target',
          method: 'GET',
          enctype: 'application/x-www-form-urlencoded',
          params: {
            title: 'title',
            text: 'text',
            url: 'url',
          },
        },
        // Open .pdf salary slips directly in HRMS
        file_handlers: [
          {
            action: '/open-file',
            accept: {
              'application/pdf': ['.pdf'],
            },
            icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }],
            launch_type: 'single-client',
          },
        ],
        // Deep-link protocol: web+aniston:/dashboard → opens HRMS at /dashboard
        protocol_handlers: [
          {
            protocol: 'web+aniston',
            url: '/%s',
          },
        ],
        // Edge sidebar panel — pin HRMS in Microsoft Edge sidebar
        edge_side_panel: {
          preferred_width: 480,
        },
      } as any,
      workbox: {
        // Clean old precaches on every new SW activation
        cleanupOutdatedCaches: true,
        // Activate new SW immediately — no waiting for tabs to close
        skipWaiting: true,
        // Claim all open tabs immediately after activation
        // Critical: ensures PWABuilder sees the SW controlling the page on first visit
        clientsClaim: true,
        // SPA navigation fallback
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/uploads\//, /^\/api\//, /^\/\.well-known\//, /^\/share-target/, /^\/open-file/],
        // Precache the offline fallback page
        additionalManifestEntries: [
          { url: '/offline.html', revision: '2' },
        ],
        // Runtime caching strategies
        runtimeCaching: [
          {
            // Cache API responses for 5 min (NetworkFirst = fresh when online, cache when offline)
            urlPattern: /\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 100,
                maxAgeSeconds: 60 * 5,
              },
              networkTimeoutSeconds: 10,
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache Google Fonts for 1 year
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache images for 30 days
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30,
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache JS/CSS chunks for 7 days (versioned by hash so safe)
            urlPattern: /\.(?:js|css)$/i,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'static-assets',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 7,
              },
            },
          },
        ],
      },
      // Disable SW in dev to prevent dev cache interference
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // Preserve symlinks for npm workspace hoisting
    preserveSymlinks: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
