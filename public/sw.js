/* PU WebGIS - Service Worker
 * Offline-first app shell. API ka data KABHI cache nahi hota.
 */
const VERSION = 'v2.0.0';
const STATIC_CACHE = 'pu-static-' + VERSION;
const RUNTIME_CACHE = 'pu-runtime-' + VERSION;

const PRECACHE = [
  '/index.html',
  '/login.html',
  '/offline.html',
  '/manifest.json',
  '/css/app.css',
  '/js/common.js',
  '/js/app.js',
  '/js/login.js',
  '/js/draw.js',
  '/js/offline.js',
  '/auth.js',
  '/vendor/leaflet/leaflet.css',
  '/vendor/leaflet/leaflet.js',
  '/vendor/leaflet-draw/leaflet.draw.css',
  '/vendor/leaflet-draw/leaflet.draw.js',
  '/vendor/leaflet/images/marker-icon.png',
  '/vendor/leaflet/images/marker-icon-2x.png',
  '/vendor/leaflet/images/marker-shadow.png',
  '/vendor/leaflet/images/layers.png',
  '/vendor/leaflet/images/layers-2x.png',
  '/vendor/leaflet-draw/images/spritesheet.png',
  '/vendor/leaflet-draw/images/spritesheet-2x.png',
  '/vendor/leaflet-draw/images/spritesheet.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    // addAll all-or-nothing hota hai, is liye ek ek karke add karte hain
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        await cache.add(new Request(url, { cache: 'reload' }));
      } catch (err) {
        console.warn('[sw] precache skip:', url, err);
      }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((k) => k !== STATIC_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;              // POST/PUT/DELETE -> hamesha network

  const url = new URL(req.url);

  // API data kabhi cache nahi (auth + live data)
  if (url.origin === self.location.origin && url.pathname.indexOf('/api/') === 0) return;

  // Navigation: network first, phir cache, phir offline page
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok && !fresh.redirected) {
          const cache = await caches.open(RUNTIME_CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch (err) {
        const cached = await caches.match(req, { ignoreSearch: true });
        if (cached) return cached;
        const offline = await caches.match('/offline.html');
        if (offline) return offline;
        return new Response('Offline', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  // Same-origin static files: cache first + background me update
  if (url.origin === self.location.origin) {
    event.respondWith((async () => {
      const cached = await caches.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === 'basic') {
          caches.open(STATIC_CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
        }
        return res;
      }).catch(() => null);
      return cached || (await network) || new Response('', { status: 504 });
    })());
    return;
  }

  // Cross-origin map tiles: cache first (offert par purana map dikhta rahe)
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      const res = await fetch(req);
      if (res && (res.ok || res.type === 'opaque')) {
        const cache = await caches.open(RUNTIME_CACHE);
        cache.put(req, res.clone()).catch(() => {});
      }
      return res;
    } catch (err) {
      return new Response('', { status: 504 });
    }
  })());
});
