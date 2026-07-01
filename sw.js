/* =============================================
   Irish Bar — Service Worker (PWA Full Offline)
   ============================================= */

const CACHE_NAME     = 'irish-bar-v3';

// Build absolute URLs relative to SW scope (works on GitHub Pages and any subdirectory)
const BASE = self.registration.scope; // e.g. https://user.github.io/repo/
const OFFLINE_URL = BASE + 'offline.html';

const PRECACHE_URLS = [
  BASE,
  BASE + 'index.html',
  BASE + 'offline.html',
  BASE + 'manifest.json',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'css/main.css',
  BASE + 'css/store.css',
  BASE + 'css/auth.css',
  BASE + 'css/dashboard.css',
  BASE + 'js/pwa.js',
  BASE + 'js/store.js',
  BASE + 'js/auth.js',
  BASE + 'js/ui.js',
  BASE + 'js/orders.js',
  BASE + 'js/agents.js',
  BASE + 'js/firebase-config.js',
  BASE + 'pages/auth.html',
  BASE + 'pages/dashboard.html',
  BASE + 'pages/agent-dashboard.html',
];

// ── Install: pre-cache all static assets ──────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url).catch(() => { /* ignore individual failures */ })
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ──────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: smart caching strategy ────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 1. Skip non-GET requests entirely
  if (request.method !== 'GET') return;

  // 2. Skip non-HTTP protocols
  if (!url.protocol.startsWith('http')) return;

  // 3. Skip ALL external/third-party requests — let browser handle them directly
  //    This includes: Firebase, Firestore, Google APIs, ImgBB, Telegram, Leaflet data, etc.
  if (!url.href.startsWith(BASE)) {
    // Only intercept known CDN resources we want to cache for offline use
    const isCDN = (
      url.hostname.includes('cdnjs.cloudflare.com') ||
      url.hostname.includes('unpkg.com') ||
      url.hostname.includes('fonts.googleapis.com') ||
      url.hostname.includes('fonts.gstatic.com')
    );

    if (!isCDN) return; // Let Firebase, Firestore, ImgBB, etc. pass through untouched

    // Cache CDN resources (fonts, leaflet, fontawesome)
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return resp;
        }).catch(() => cached || new Response('', { status: 408 }));
      })
    );
    return;
  }

  // 4. Same-origin navigation requests — network first, offline fallback
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(resp => {
          if (resp && resp.status === 200) {
            const clone = resp.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return resp;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // 5. Same-origin static assets (CSS, JS, icons) — cache first, network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(resp => {
        if (resp && resp.status === 200) {
          const clone = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
        }
        return resp;
      }).catch(() => caches.match(OFFLINE_URL));
    })
  );
});

// ── Push Notifications ────────────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'Irish Bar', body: 'لديك إشعار جديد' };
  try {
    data = event.data ? event.data.json() : data;
  } catch {
    data.body = event.data ? event.data.text() : data.body;
  }

  const options = {
    body:    data.body   || 'إشعار جديد',
    icon:    '/icon-192.png',
    badge:   '/icon-192.png',
    image:   data.image  || undefined,
    tag:     data.tag    || 'irish-bar',
    renotify: true,
    vibrate: [200, 100, 200],
    actions: data.actions || [],
    data:    { url: data.url || '/' },
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Irish Bar', options)
  );
});

// ── Notification Click ────────────────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url === targetUrl && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── Background Sync ───────────────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-orders') {
    event.waitUntil(syncPendingOrders());
  }
});

async function syncPendingOrders() {
  // Placeholder — actual sync logic handled by the app
  const allClients = await clients.matchAll();
  allClients.forEach(client => client.postMessage({ type: 'SYNC_ORDERS' }));
}
