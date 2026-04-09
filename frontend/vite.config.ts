import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // injectManifest: use our custom sw.ts which adds Push, Background Sync,
      // Periodic Sync, and full offline caching on top of Workbox precaching.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',

      // 'autoUpdate' silently activates new SW — best for enterprise apps
      registerType: 'autoUpdate',
      // Inject SW registration script inline in index.html
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
        'widgets/*.json',
      ],

      manifest: {
        name: 'Aniston HRMS',
        short_name: 'Aniston',
        description:
          'Enterprise Human Resource Management System — Attendance, Leave, Payroll & more',
        start_url: '/dashboard?source=pwa',
        scope: '/',
        // Unique app identity — used by browsers to track install state
        id: 'com.aniston.hrms',
        display: 'standalone',
        // Window Controls Overlay → custom title bar on desktop Chrome/Edge
        // tabbed → multiple tabs inside the PWA window
        // standalone → normal installed mode
        // minimal-ui → fallback for browsers that don't support above
        display_override: [
          'window-controls-overlay',
          'tabbed',
          'standalone',
          'minimal-ui',
        ],
        background_color: '#f8fafc',
        theme_color: '#4F46E5',
        orientation: 'portrait-primary',
        lang: 'en',
        dir: 'ltr',
        categories: ['business', 'productivity'],
        // false = prefer this web app over any native apps
        prefer_related_applications: false,
        // IARC content rating — free certificate from https://www.globalratings.com/
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

        // Related applications — web platform entry satisfies the manifest field.
        // Replace with Play Store / App Store entries after publishing to stores.
        related_applications: [
          {
            platform: 'webapp',
            url: 'https://hr.anistonav.com/manifest.webmanifest',
          },
        ],

        // Allow PWA to navigate to these origins without leaving app context
        scope_extensions: [{ origin: 'https://hr.anistonav.com' }],

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

        // ── Windows 11 Widgets ──────────────────────────────────────────────
        // Allows users to pin Attendance and Leave Balance as home screen widgets
        widgets: [
          {
            name: 'Attendance Status',
            short_name: 'Attendance',
            description: "View today's attendance status and check in/out quickly",
            tag: 'attendance-status',
            template: 'calendar-small',
            ms_ac_template: '/widgets/attendance.json',
            data: '/api/widgets/attendance',
            type: 'application/json',
            icons: [
              { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            ],
            screenshots: [
              {
                src: '/screenshots/mobile-attendance.png',
                sizes: '1080x1920',
                type: 'image/png',
                label: 'Attendance widget preview',
              },
            ],
            auth: true,
            update: 900, // refresh every 15 minutes
          },
          {
            name: 'Leave Balance',
            short_name: 'Leave',
            description: 'Quick view of your remaining leave balance',
            tag: 'leave-balance',
            template: 'list-item',
            ms_ac_template: '/widgets/leave.json',
            data: '/api/widgets/leave',
            type: 'application/json',
            icons: [
              { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
            ],
            screenshots: [
              {
                src: '/screenshots/mobile-leave.png',
                sizes: '1080x1920',
                type: 'image/png',
                label: 'Leave balance widget preview',
              },
            ],
            auth: true,
            update: 3600, // refresh every hour
          },
        ],

        // ── Note Taking ─────────────────────────────────────────────────────
        // Registers HRMS with the OS note-taking integration (e.g. Windows Notes)
        note_taking: {
          new_note_url: '/announcements/new',
        },
      } as any,

      // injectManifest options — controls which files are precached
      injectManifest: {
        // Inject into every built asset
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Exclude large optional assets from precache
        globIgnores: [
          '**/node_modules/**',
          '**/pdf.worker.min.mjs',
          '**/apple-splash/**',
        ],
        // Precache the offline fallback
        additionalManifestEntries: [
          { url: '/offline.html', revision: '3' },
        ],
      },

      // Disable SW in dev to prevent cache interference
      devOptions: {
        enabled: false,
      },
    }),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
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
