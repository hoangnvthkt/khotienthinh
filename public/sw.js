// Vioo Service Worker v10 - PWA shell + Web Push notifications
const CACHE_NAME = 'vioo-v10';
const OFFLINE_URL = '/offline.html';

const PRECACHE_URLS = [
  '/',
  '/offline.html',
  '/manifest.json',
  '/apple-touch-icon.png',
  '/icons/icon-72.png',
  '/icons/icon-180.png',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

const shouldCacheResponse = (response) => response && response.ok && response.type !== 'opaque';

const isStaticAsset = (url) =>
  url.pathname === '/' ||
  url.pathname === '/index.html' ||
  url.pathname === '/manifest.json' ||
  url.pathname === OFFLINE_URL ||
  url.pathname.match(/\.(css|js|png|jpg|jpeg|svg|gif|webp|woff2?|ttf|ico)$/);

const cacheResponse = async (request, response) => {
  if (!shouldCacheResponse(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response.clone());
};

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (!['http:', 'https:'].includes(url.protocol)) return;
  if (url.origin !== self.location.origin) return;
  if (url.hostname.includes('supabase')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => response)
        .catch(() => caches.match('/').then((cached) => cached || caches.match(OFFLINE_URL)))
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          cacheResponse(event.request, response);
          return response;
        });
      })
    );
    return;
  }
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

const normalizeBadgeCount = (value) => {
  const count = Number(value);
  if (!Number.isFinite(count)) return null;
  return Math.max(0, Math.min(100, Math.floor(count)));
};

const getAppBadgeCount = (data) => {
  if (!data || typeof data !== 'object') return null;
  return normalizeBadgeCount(
    data.badgeCount ?? data.unreadCount ?? data.appBadge ?? data.app_badge
  );
};

const setAppBadgeFromPush = async (data) => {
  const count = getAppBadgeCount(data);
  const badgeNavigator = self.navigator;
  if (count === null || !badgeNavigator?.setAppBadge) return;

  try {
    if (count > 0) {
      await badgeNavigator.setAppBadge(count);
    } else if (badgeNavigator.clearAppBadge) {
      await badgeNavigator.clearAppBadge();
    } else {
      await badgeNavigator.setAppBadge(0);
    }
  } catch (error) {
    console.warn('App badge update failed:', error);
  }
};

self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'Vioo', body: event.data.text() };
  }

  const notificationId = data.notificationId || data.notification_id || data.id || '';
  const url = data.url || data.actionUrl || data.action_url || '/';

  const options = {
    body: data.body || '',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-72.png',
    tag: data.tag || notificationId || 'vioo-notification',
    timestamp: Date.now(),
    data: {
      url,
      notificationId,
      priority: data.priority || 'normal',
    },
    actions: data.actions || [],
    vibrate: [100, 50, 100],
    renotify: data.renotify !== false,
    silent: data.silent === true,
    requireInteraction: data.priority === 'urgent' || data.priority === 'high',
  };

  event.waitUntil(
    Promise.all([
      setAppBadgeFromPush(data),
      self.registration.showNotification(data.title || 'Vioo', options),
    ])
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const urlToOpen = new URL(event.notification.data?.url || '/', self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          const focusPromise = client.focus();
          if ('navigate' in client && client.url !== urlToOpen) {
            return client.navigate(urlToOpen).then((navigatedClient) => navigatedClient?.focus() || focusPromise);
          }
          return focusPromise;
        }
      }
      return self.clients.openWindow(urlToOpen);
    })
  );
});
