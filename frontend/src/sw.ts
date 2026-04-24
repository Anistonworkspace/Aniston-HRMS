/// <reference lib="webworker" />

import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  NetworkFirst,
  CacheFirst,
  StaleWhileRevalidate,
} from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { Queue } from 'workbox-background-sync';

declare const self: ServiceWorkerGlobalScope;

// ── Type declarations for non-standard SW events ──────────────────────────────
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
  readonly lastChance: boolean;
}
interface PeriodicSyncEvent extends ExtendableEvent {
  readonly tag: string;
}

// ── Precaching ────────────────────────────────────────────────────────────────
// self.__WB_MANIFEST is replaced by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();

// The browser will auto-activate a waiting SW when ALL tabs are closed.
// On that path we still clear runtime caches so users never see stale data.
// AppUpdateGuard sends SKIP_WAITING after the 3-second countdown on web,
// and after download on native — both paths also call clearAllCaches first.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Clear all runtime caches on every activation.
      // Covers both:
      //   (a) User clicked "Update Now" — AppUpdateGuard already cleared these
      //       before SKIP_WAITING, so this is a harmless no-op on that path.
      //   (b) Browser auto-activated (all tabs closed) — ensures the user never
      //       sees stale API responses or stale JS/CSS after reopening the app.
      // Workbox precache keys start with "workbox-precache" — we keep those
      // so the new SW can serve the SPA shell offline immediately.
      const cacheKeys = await caches.keys();
      await Promise.all(
        cacheKeys
          .filter((k) => !k.startsWith('workbox-precache'))
          .map((k) => caches.delete(k))
      );

      // Claim all open clients so new SW takes control without a reload.
      await self.clients.claim();
    })()
  );
});

// Message handlers from the app shell
self.addEventListener('message', (event) => {
  // SKIP_WAITING — sent by AppUpdateGuard when user clicks "Update Now"
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // CLEAR_CACHES — deletes all runtime caches so users see fresh data
  // Called by AppUpdateGuard before activating the new SW
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
    );
  }
});

// ── SPA Navigation Fallback ───────────────────────────────────────────────────
const navigationHandler = createHandlerBoundToURL('/index.html');
const navigationRoute = new NavigationRoute(navigationHandler, {
  denylist: [
    /^\/uploads\//,
    /^\/api\//,
    /^\/\.well-known\//,
    /^\/share-target/,
    /^\/open-file/,
  ],
});
registerRoute(navigationRoute);

// ── Background Sync ───────────────────────────────────────────────────────────
// Queue failed API mutations so they're retried when connectivity returns
const mutationQueue = new Queue('hrms-api-mutations', {
  maxRetentionTime: 24 * 60, // retry for up to 24 hours
  onSync: async ({ queue }) => {
    let entry;
    while ((entry = await queue.shiftRequest())) {
      try {
        await fetch(entry.request);
      } catch {
        // Put back on failure and stop; will retry on next sync
        await queue.unshiftRequest(entry);
        throw new Error('Background sync replay failed; will retry later.');
      }
    }
    // Notify all app windows that sync completed
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) =>
      c.postMessage({ type: 'BG_SYNC_COMPLETE', timestamp: Date.now() })
    );
  },
});

// Queue non-GET API requests that fail (offline mutations)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (
    request.method !== 'GET' &&
    request.url.includes('/api/') &&
    !request.url.includes('/api/auth/')
  ) {
    const bgSyncPromise = fetch(request.clone()).catch(() =>
      mutationQueue.pushRequest({ request })
    );
    event.waitUntil(bgSyncPromise);
  }
});

// sync event — triggered by the browser when connectivity is restored
self.addEventListener('sync', (event: Event) => {
  const syncEvent = event as unknown as SyncEvent;
  if (
    syncEvent.tag === 'hrms-sync' ||
    syncEvent.tag === 'hrms-api-mutations'
  ) {
    syncEvent.waitUntil(
      fetch('/api/health').catch(() => {
        /* silently ignore if still offline */
      })
    );
  }
});

// ── Periodic Background Sync ──────────────────────────────────────────────────
// Runs ~every 15 minutes (actual frequency controlled by browser/OS)
self.addEventListener('periodicsync', (event: Event) => {
  const periodicEvent = event as unknown as PeriodicSyncEvent;
  if (periodicEvent.tag === 'hrms-periodic-sync') {
    periodicEvent.waitUntil(periodicSyncHandler());
  }
});

async function periodicSyncHandler(): Promise<void> {
  try {
    // Pre-fetch lightweight health endpoint to warm the API cache
    await fetch('/api/health');

    // Notify open windows so they can refresh stale data
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((c) =>
      c.postMessage({ type: 'PERIODIC_SYNC', timestamp: Date.now() })
    );
  } catch {
    // Fail silently — periodic sync will be retried automatically
  }
}

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', (event: PushEvent) => {
  let payload: {
    title?: string;
    body?: string;
    icon?: string;
    badge?: string;
    url?: string;
    tag?: string;
    requireInteraction?: boolean;
  } = {};

  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = {
      title: 'Aniston HRMS',
      body: event.data?.text() || 'You have a new notification',
    };
  }

  const options: NotificationOptions = {
    body: payload.body || 'You have a new notification',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'hrms-notification',
    renotify: true,
    requireInteraction: payload.requireInteraction ?? false,
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

self.addEventListener('notificationclick', (event: NotificationEvent) => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl: string = event.notification.data?.url || '/dashboard';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clients) => {
        // Focus an existing HRMS window if one is open
        for (const client of clients) {
          if (
            client.url.startsWith(self.registration.scope) &&
            'focus' in client
          ) {
            (client as WindowClient).navigate(targetUrl);
            return (client as WindowClient).focus();
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(targetUrl);
      })
  );
});

self.addEventListener('notificationclose', (_event: NotificationEvent) => {
  // Analytics hook — extend here to POST a dismiss event to /api/notifications/dismiss
});

// ── Runtime Caching ───────────────────────────────────────────────────────────

// API responses — NetworkFirst: fresh when online, cached when offline (5 min)
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'api-cache',
    networkTimeoutSeconds: 10,
    plugins: [
      new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 5 }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// Google Fonts — CacheFirst (1 year)
registerRoute(
  ({ url }) =>
    url.origin.includes('fonts.googleapis.com') ||
    url.origin.includes('fonts.gstatic.com'),
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 30,
        maxAgeSeconds: 60 * 60 * 24 * 365,
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// Images — CacheFirst (30 days)
registerRoute(
  ({ request }) => request.destination === 'image',
  new CacheFirst({
    cacheName: 'images',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 60,
        maxAgeSeconds: 60 * 60 * 24 * 30,
      }),
      new CacheableResponsePlugin({ statuses: [0, 200] }),
    ],
  })
);

// JS/CSS static assets — StaleWhileRevalidate (7 days, versioned by hash)
registerRoute(
  ({ request }) =>
    request.destination === 'script' || request.destination === 'style',
  new StaleWhileRevalidate({
    cacheName: 'static-assets',
    plugins: [
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 7,
      }),
    ],
  })
);
