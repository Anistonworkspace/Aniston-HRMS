import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['logo.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-192.png', 'icon-maskable-512.png', 'offline.html'],
      manifest: {
        name: 'Aniston HRMS',
        short_name: 'Aniston',
        description: 'Enterprise Human Resource Management System — Attendance, Leave, Payroll & more',
        start_url: '/dashboard',
        scope: '/',
        id: '/',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        background_color: '#f8fafc',
        theme_color: '#4F46E5',
        orientation: 'portrait-primary',
        lang: 'en',
        dir: 'ltr',
        categories: ['business', 'productivity'],
        prefer_related_applications: false,
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
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            form_factor: 'narrow',
            label: 'Aniston HRMS Dashboard',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            form_factor: 'wide',
            label: 'Aniston HRMS Desktop View',
          },
        ],
        shortcuts: [
          {
            name: 'Dashboard',
            short_name: 'Home',
            url: '/dashboard',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Mark Attendance',
            short_name: 'Attend',
            url: '/attendance',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'Apply Leave',
            short_name: 'Leave',
            url: '/leaves',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
          {
            name: 'My Profile',
            short_name: 'Profile',
            url: '/profile',
            icons: [{ src: '/icon-192.png', sizes: '192x192' }],
          },
        ],
        launch_handler: {
          client_mode: 'focus-existing',
        },
        related_applications: [],
      } as any,
      workbox: {
        // Clean old precaches on every new SW activation
        cleanupOutdatedCaches: true,
        // Skip waiting so new SW activates immediately when user clicks update
        skipWaiting: true,
        // SPA navigation fallback
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/uploads\//, /^\/api\//, /^\/\.well-known\//],
        // Precache the offline fallback page
        additionalManifestEntries: [
          { url: '/offline.html', revision: '1' },
        ],
        // Runtime caching strategies
        runtimeCaching: [
          {
            // Cache API responses for 5 min
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
            // Cache Google Fonts
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Cache images
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'images',
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
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
