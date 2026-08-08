// TaskFlow Service Worker v21 – RPG Hero, Kanban Board, Eisenhower Matrix & Instant QR Sharing
const CACHE_NAME = 'taskflow-cache-v21';
const ASSETS = [
  './',
  './index.html',
  './css/styles.css?v=21',
  './js/app.js?v=21',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// Install: Pre-cache all assets and force immediate activation
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS).catch(err => console.warn('Cache addAll warning:', err));
    })
  );
});

// Activate: Delete all old caches and claim clients immediately
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Fetch: Network First, fallback to cache if offline
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push Notification Handler (for due task alarms)
self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '🔔 تنبيه TaskFlow';
  const options = {
    body: data.body || 'لديك مهام مستحقة اليوم!',
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    vibrate: [200, 100, 200],
    dir: 'rtl',
    lang: 'ar',
    tag: data.tag || 'taskflow-alarm',
    renotify: true,
    requireInteraction: data.sticky || false,
    silent: data.silent || false,
    data: { url: self.registration.scope, sticky: data.sticky || false }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification Click Handler
self.addEventListener('notificationclick', event => {
  const notifData = event.notification.data || {};
  const isSticky = notifData.sticky || event.notification.tag === 'taskflow-sticky-summary';

  // Only close alarm notifications on click, keep sticky open (user dismisses manually)
  if (!isSticky) {
    event.notification.close();
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('./');
    })
  );
});

