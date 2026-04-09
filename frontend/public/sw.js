// DEV FALLBACK ONLY — this file is served in development mode.
// In production, vite-plugin-pwa generates /sw.js from frontend/src/sw.ts
// (injectManifest strategy with full Workbox + Push + BackgroundSync + PeriodicSync).

const CACHE_NAME = 'aniston-hrms-dev-v2';
const OFFLINE_URL = '/offline.html';
const PRECACHE_ASSETS = ['/', '/offline.html', '/icon-192.png', '/icon-512.png'];

// ── Install — cache shell immediately ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate — remove old dev caches ─────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('aniston-hrms-dev-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

// ── Fetch — network first, fallback to cache, then offline page ───────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http')) return;
  if (request.url.includes('/api/')) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() =>
        caches
          .match(request)
          .then((cached) => cached || caches.match(OFFLINE_URL))
      )
  );
});

// ── Background Sync ───────────────────────────────────────────────────────────
// Dev stub — logs the sync tag so the browser registers the capability
self.addEventListener('sync', (event) => {
  console.log('[SW-dev] Background sync triggered:', event.tag);
  if (event.tag === 'hrms-sync' || event.tag === 'hrms-api-mutations') {
    event.waitUntil(
      fetch('/api/health').catch(() => {
        /* ignore offline */
      })
    );
  }
});

// ── Periodic Background Sync ──────────────────────────────────────────────────
// Dev stub — logs the periodic sync tag
self.addEventListener('periodicsync', (event) => {
  console.log('[SW-dev] Periodic sync triggered:', event.tag);
  if (event.tag === 'hrms-periodic-sync') {
    event.waitUntil(
      fetch('/api/health')
        .then(() => {
          self.clients
            .matchAll({ type: 'window' })
            .then((clients) =>
              clients.forEach((c) =>
                c.postMessage({ type: 'PERIODIC_SYNC', timestamp: Date.now() })
              )
            );
        })
        .catch(() => {
          /* ignore */
        })
    );
  }
});

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {
      title: 'Aniston HRMS',
      body: event.data?.text() || 'You have a new notification',
    };
  }

  const options = {
    body: payload.body || 'You have a new notification',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'hrms-notification',
    renotify: true,
    data: { url: payload.url || '/dashboard' },
    actions: [
      { action: 'open', title: 'View' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  };

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Aniston HRMS', options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        for (const client of clients) {
          if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});

self.addEventListener('notificationclose', (_event) => {
  // Analytics hook — extend here to track dismissals
});

// ── Skip-waiting on demand ────────────────────────────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
