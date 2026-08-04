// Vessel PWA Service Worker — Offline SMS Cache
//
// Caches DPA-approved SMS document responses so crew workstations can
// continue reading documents during temporary local LAN disruptions.
// Uses a stale-while-revalidate strategy: serve from cache immediately,
// then update in the background.

const CACHE_NAME = 'mpc-vessel-sms-v1';
const SMS_DOC_CACHE_PATTERN = /\/api\/sms\/documents/;

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll([
      '/',
      '/index.html',
    ])).catch(() => {
      // initial cache fail is fine — we populate on first request
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Stale-while-revalidate for SMS document API calls
  if (SMS_DOC_CACHE_PATTERN.test(url.pathname) || url.pathname.includes('/sms/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req).then((res) => {
          if (res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // App shell: cache-first for same-origin navigation/asset requests
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res.ok && (req.destination === 'style' || req.destination === 'script' || req.destination === 'document')) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return res;
      }).catch(() => caches.match('/index.html')))
    );
  }
});
