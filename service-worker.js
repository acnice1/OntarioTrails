// service-worker.js (safe clone + guards)
const CACHE_NAME = 'ontario-trails-pwa-v2';
const APP_SHELL = [
  './',
  './index.html',
  './OTN.geojson',
  './manifest.webmanifest',
];

// --- Install: pre-cache app shell
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(APP_SHELL);
  })());
  self.skipWaiting();
});

// --- Activate: clean old caches
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k !== CACHE_NAME) && caches.delete(k)));
  })());
  self.clients.claim();
});

// --- Fetch: cache-first (same-origin), SWR (CDNs/tiles)
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignore anything that isn't a simple GET
  if (req.method !== 'GET' || req.headers.has('range')) return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCDN = /(^|\.)(unpkg\.com)$/.test(url.host);
  const isOSMTiles = /(^|\.)(tile\.openstreetmap\.org)$/.test(url.host);
  const isEsriTiles = /(^|\.)(arcgisonline\.com)$/.test(url.host);

  // --- SAME-ORIGIN: cache-first
  if (sameOrigin) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      if (cached) return cached;

      // Fetch from network, clone once for cache, return the original
      const netRes = await fetch(req);
      // Only cache successful, basic responses
      if (netRes && netRes.ok && netRes.type === 'basic') {
        event.waitUntil(cache.put(req, netRes.clone()));
      }
      return netRes;
    })());
    return; // important
  }

  // --- EXTERNAL: stale-while-revalidate for CDNs/tiles
  if (isCDN || isOSMTiles || isEsriTiles) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(req);
      const fetchPromise = (async () => {
        try {
          const netRes = await fetch(req, { cache: 'no-store' });
          // Cache successful or opaque (e.g., cross-origin tiles)
          if (netRes && (netRes.ok || netRes.type === 'opaque')) {
            await cache.put(req, netRes.clone());
          }
          return netRes;
        } catch (_) {
          // Network failed: fall back to cache (handled below)
        }
      })();

      // Return cached immediately if present; update in background
      if (cached) {
        event.waitUntil(fetchPromise);
        return cached;
      }
      // No cache: wait for network (may still be undefined on failure)
      const netRes = await fetchPromise;
      return netRes || new Response('Offline', { status: 503, statusText: 'Offline' });
    })());
  }
});
