// service-worker.js — Ontario Trails PWA (robust caching + guards)

// ===== Versioned caches ======================================================
const VERSION = 'v3';
const STATIC_CACHE = `ontario-trails-static-${VERSION}`;
const DATA_CACHE   = `ontario-trails-data-${VERSION}`;
const TILE_CACHE   = `ontario-trails-tiles-${VERSION}`;

// Limit sizes to avoid unbounded growth (tune as desired)
const LIMITS = {
  [STATIC_CACHE]: 40,  // HTML/CSS/JS/manifest/icons
  [DATA_CACHE]:   40,  // your *.geojson datasets
  [TILE_CACHE]:   400, // tiles & CDN libs
};

// ===== App shell to pre-cache (same-origin only) ============================
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.webmanifest',
  // Optional (include if you ship these):
  './OTN.geojson',                 // if present locally
  './Fish_Stocking_Data.geojson',  // if present locally
  './Fishing_Access_Point.geojson' // if present locally
  // './icons/icon-192.png',
  // './icons/icon-512.png',
];

// ===== Utilities =============================================================
async function trimCache(cacheName, maxEntries) {
  if (!maxEntries) return;
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  // Delete oldest entries first
  await Promise.all(keys.slice(0, keys.length - maxEntries).map(k => cache.delete(k)));
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isDataURL(url) {
  // treat your local data files as "data"
  return isSameOrigin(url) && /\.geojson(\?|#|$)/i.test(url.pathname);
}

function isStaticURL(url) {
  // same-origin HTML/CSS/JS/manifest/icons
  return (
    isSameOrigin(url) &&
    /\.(?:html?|css|js|webmanifest|png|jpg|jpeg|svg|ico)(\?|#|$)/i.test(url.pathname)
  );
}

function isTileOrCDN(url) {
  const h = url.host;
  // OSM tiles
  if (/(^|\.)(tile\.openstreetmap\.org)$/i.test(h)) return true;
  // Ontario LIO/GeoServices / ArcGIS tiles & imagery endpoints
  if (/ws\.(?:lio|geoservices)\.lrc\.gov\.on\.ca/i.test(h)) return true;
  if (/arcgisonline\.com$/i.test(h)) return true;
  // Unpkg & common CDNs used by the app
  if (/unpkg\.com$/i.test(h)) return true;
  return false;
}

async function fromNetworkWithTimeout(req, ms = 6000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(req, { signal: controller.signal, cache: 'no-store' });
    return res;
  } finally {
    clearTimeout(t);
  }
}

// ===== Install ===============================================================
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(STATIC_CACHE);
    try {
      await cache.addAll(APP_SHELL);
    } catch (_) {
      // Some optional shell items may not exist; ignore failures quietly.
    }
  })());
  self.skipWaiting();
});

// ===== Activate ==============================================================
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Enable navigation preload for faster SPA navigations (if supported)
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch {}
    }

    const keep = new Set([STATIC_CACHE, DATA_CACHE, TILE_CACHE]);
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (!keep.has(k) ? caches.delete(k) : null)));
  })());
  self.clients.claim();
});

// Optional: let page request an immediate takeover
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// ===== Fetch ================================================================
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Ignore anything that isn't a simple GET (or is a range request)
  if (req.method !== 'GET' || req.headers.has('range')) return;

  const url = new URL(req.url);

  // 1) Handle navigations: serve cached index.html fallback for offline SPA
  if (event.request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Use navigation preload response if available
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;

        // Network first for navigations
        const netRes = await fetch(req);
        return netRes;
      } catch {
        // Offline fallback to cached index.html
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match('./index.html');
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 2) Same-origin STATIC: cache-first
  if (isStaticURL(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(req, { ignoreVary: true });
      if (cached) return cached;

      try {
        const netRes = await fetch(req);
        if (netRes && netRes.ok && (netRes.type === 'basic' || netRes.type === 'default')) {
          event.waitUntil((async () => {
            await cache.put(req, netRes.clone());
            await trimCache(STATIC_CACHE, LIMITS[STATIC_CACHE]);
          })());
        }
        return netRes;
      } catch {
        return new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 3) Same-origin DATA (.geojson): network-first (so your data updates when online)
  if (isDataURL(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA_CACHE);
      try {
        const netRes = await fromNetworkWithTimeout(req, 8000);
        if (netRes && (netRes.ok || netRes.type === 'opaque')) {
          event.waitUntil((async () => {
            await cache.put(req, netRes.clone());
            await trimCache(DATA_CACHE, LIMITS[DATA_CACHE]);
          })());
        }
        return netRes;
      } catch {
        const cached = await cache.match(req, { ignoreVary: true });
        return cached || new Response('Offline', { status: 503, statusText: 'Offline' });
      }
    })());
    return;
  }

  // 4) Tiles & CDNs: stale-while-revalidate
  if (isTileOrCDN(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(TILE_CACHE);
      const cached = await cache.match(req);
      const revalidate = (async () => {
        try {
          const netRes = await fetch(req, { cache: 'no-store' });
          if (netRes && (netRes.ok || netRes.type === 'opaque')) {
            await cache.put(req, netRes.clone());
            await trimCache(TILE_CACHE, LIMITS[TILE_CACHE]);
          }
          return netRes;
        } catch {
          // swallow; we'll rely on cache if available
        }
      })();

      if (cached) {
        event.waitUntil(revalidate);
        return cached;
      }
      const net = await revalidate;
      return net || new Response('Offline', { status: 503, statusText: 'Offline' });
    })());
    return;
  }

  // 5) Everything else (other cross-origin GET): network → cache fallback
  event.respondWith((async () => {
    try {
      const netRes = await fetch(req);
      return netRes;
    } catch {
      // Try any cache
      const keys = await caches.keys();
      for (const k of keys) {
        const cache = await caches.open(k);
        const match = await cache.match(req);
        if (match) return match;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline' });
    }
  })());
});
