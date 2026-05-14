// service-worker.js — Ontario Trails PWA
// Robust caching + offline fallback + controlled preload support

// ===== Versioned caches ======================================================
importScripts('./app-version.js');

const VERSION = globalThis.ONTARIO_TRAILS_VERSION || 'dev';

const STATIC_CACHE = `ontario-trails-static-${VERSION}`;
const DATA_CACHE   = `ontario-trails-data-${VERSION}`;
const TILE_CACHE   = `ontario-trails-tiles-${VERSION}`;

const USER_OFFLINE_IMAGERY_CACHE = 'ontario-trails-offline-imagery-v1';
const USER_OFFLINE_BASEMAP_CACHE = 'ontario-trails-offline-basemap-v1';
const USER_OFFLINE_DATA_CACHE    = 'ontario-trails-offline-data-v1';

// Limit sizes to avoid unbounded growth.
// Tune these based on available device storage and your expected usage.
const LIMITS = {
  [STATIC_CACHE]: 80,                 // HTML/CSS/JS/manifest/icons
  [DATA_CACHE]: 120,                  // local .geojson / .json data
  [TILE_CACHE]: 3000,                 // opportunistic viewed OSM/LIO/CDN tiles
  [USER_OFFLINE_BASEMAP_CACHE]: 20000 // durable viewed/downloaded R2 basemap tiles
};
// ===== App shell to pre-cache ================================================
// Keep same-origin files here only.
const APP_SHELL = [
  './',
  './index.html',
  './app-version.js',
  './app.css',
  './app.js',
  './manifest.webmanifest'

  // Optional if you ship icons:
  // './icons/icon-192.png',
  // './icons/icon-512.png'
];

// Optional core data files.
// These are cached on install if present. Missing files are ignored.
const CORE_DATA = [
  './data/routes/routes.json',
  './data/OTN.geojson',
  './data/OSM_paths.geojson',
  './data/Fish_Stocking_Data.geojson',
  './data/Fishing_Access_Point.geojson',

  // Keep these only if your app still serves data from the root:
  './OTN.geojson',
  './Fish_Stocking_Data.geojson',
  './Fishing_Access_Point.geojson'
];

// ====HELPERS = Utilities =============================================================

async function trimCache(cacheName, maxEntries) {
  if (!maxEntries) return;

  const cache = await caches.open(cacheName);
  const keys = await cache.keys();

  if (keys.length <= maxEntries) return;

  // Delete oldest entries first.
  const toDelete = keys.slice(0, keys.length - maxEntries);
  await Promise.all(toDelete.map(key => cache.delete(key)));
}

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isDataURL(url) {
  // Treat local .geojson and .json files as data.
  // This includes ./data/routes/routes.json.
  return (
    isSameOrigin(url) &&
    /\.(?:geojson|json)(\?|#|$)/i.test(url.pathname)
  );
}

function isOfflineBasemapURL(url) {
  return (
    /\.(?:png|jpg|jpeg|webp)(\?|#|$)/i.test(url.pathname) &&
    (
      url.hostname === 'pub-19f9e9e1492a49faaa32e257355e1973.r2.dev' ||
      url.pathname.includes('/offline-basemap/') ||
      /offline-basemap/i.test(url.hostname)
    )
  );
}

function isStaticURL(url) {
  // Same-origin app shell/static files.
  return (
    isSameOrigin(url) &&
    /\.(?:html?|css|js|webmanifest|png|jpg|jpeg|svg|ico|webp)(\?|#|$)/i.test(url.pathname)
  );
}

function isTileOrCDN(url) {
  const h = url.host;

  // OSM tiles.
  // NOTE: cache tiles that the app actually requests during use.
  // Do not bulk-preload public OSM tiles unless the provider permits it.
  if (/(^|\.)tile\.openstreetmap\.org$/i.test(h)) return true;

  // Ontario LIO / GeoServices / ArcGIS tiles and imagery endpoints.
  if (/ws\.(?:lio|geoservices)\.lrc\.gov\.on\.ca/i.test(h)) return true;
  if (/arcgisonline\.com$/i.test(h)) return true;

  // Common CDNs used by the app.
  if (/unpkg\.com$/i.test(h)) return true;
  if (/cdn\.jsdelivr\.net$/i.test(h)) return true;

  return false;
}

function looksLikeTileURL(url) {
  // Common XYZ tile patterns:
  // /z/x/y.png
  // /z/x/y.jpg
  // /tile/z/y/x
  return (
    /\/\d+\/\d+\/\d+\.(?:png|jpg|jpeg|webp)(\?|#|$)/i.test(url.pathname) ||
    /\/tile\/\d+\/\d+\/\d+(\?|#|$)/i.test(url.pathname)
  );
}

async function fromNetworkWithTimeout(req, ms = 6000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  try {
    return await fetch(req, {
      signal: controller.signal,
      cache: 'no-store'
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function cacheFirst(req, cacheName, limitName = cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });

  if (cached) return cached;

  const netRes = await fetch(req);

  if (netRes && (netRes.ok || netRes.type === 'opaque')) {
    await cache.put(req, netRes.clone());
    await trimCache(cacheName, LIMITS[limitName]);
  }

  return netRes;
}

async function networkFirst(req, cacheName, timeoutMs = 8000, limitName = cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const netRes = await fromNetworkWithTimeout(req, timeoutMs);

    if (netRes && (netRes.ok || netRes.type === 'opaque')) {
      await cache.put(req, netRes.clone());
      await trimCache(cacheName, LIMITS[limitName]);
    }

    return netRes;
  } catch {
    const cached = await cache.match(req, { ignoreVary: true });
    if (cached) return cached;

    return new Response('Offline', {
      status: 503,
      statusText: 'Offline'
    });
  }
}

async function networkFirstWithDataFallback(req, primaryCacheName, fallbackCacheName, timeoutMs = 8000) {
  const primaryCache = await caches.open(primaryCacheName);

  try {
    const netRes = await fromNetworkWithTimeout(req, timeoutMs);

    if (netRes && (netRes.ok || netRes.type === 'opaque')) {
      await primaryCache.put(req, netRes.clone());
      await trimCache(primaryCacheName, LIMITS[primaryCacheName]);
    }

    return netRes;
  } catch {
    const primaryMatch = await primaryCache.match(req, { ignoreVary: true });
    if (primaryMatch) return primaryMatch;

    const fallbackCache = await caches.open(fallbackCacheName);
    const fallbackMatch = await fallbackCache.match(req, { ignoreVary: true });
    if (fallbackMatch) return fallbackMatch;

    return new Response('Offline', {
      status: 503,
      statusText: 'Offline'
    });
  }
}

async function staleWhileRevalidate(req, cacheName, limitName = cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req, { ignoreVary: true });

  const revalidate = (async () => {
    try {
      const netRes = await fetch(req, { cache: 'no-store' });

      if (netRes && (netRes.ok || netRes.type === 'opaque')) {
        await cache.put(req, netRes.clone());
        if (LIMITS[limitName]) await trimCache(cacheName, LIMITS[limitName]);
      }

      return netRes;
    } catch {
      return null;
    }
  })();

  if (cached) {
    // Refresh in background.
    revalidate.catch(() => {});
    return cached;
  }

  const net = await revalidate;
  return net || new Response('Offline', {
    status: 503,
    statusText: 'Offline'
  });
}

async function addAllLenient(cacheName, urls) {
  const cache = await caches.open(cacheName);

  await Promise.all(
    urls.map(async url => {
      try {
        const req = new Request(url, { cache: 'reload' });
        const res = await fetch(req);

        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(req, res.clone());
        }
      } catch {
        // Ignore missing optional files.
      }
    })
  );

  if (LIMITS[cacheName]) await trimCache(cacheName, LIMITS[cacheName]);
}

// ===== Install ===============================================================

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await addAllLenient(STATIC_CACHE, APP_SHELL);
    await addAllLenient(DATA_CACHE, CORE_DATA);
  })());

  self.skipWaiting();
});

// ===== Activate ==============================================================

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Enable navigation preload for faster navigations, where supported.
    if (self.registration.navigationPreload) {
      try {
        await self.registration.navigationPreload.enable();
      } catch {
        // Ignore unsupported/failed preload setup.
      }
    }

const keep = new Set([
  STATIC_CACHE,
  DATA_CACHE,
  TILE_CACHE,

  // User-managed offline downloads — do not delete on app update.
  USER_OFFLINE_IMAGERY_CACHE,
  USER_OFFLINE_BASEMAP_CACHE,
  USER_OFFLINE_DATA_CACHE
]);

    const keys = await caches.keys();

    await Promise.all(
      keys.map(key => {
        if (!keep.has(key)) return caches.delete(key);
        return null;
      })
    );

    await self.clients.claim();
  })());
});

// ===== Messages ==============================================================

self.addEventListener('message', event => {
  const data = event.data;

  // Existing behaviour: immediate takeover.
  if (data === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  if (!data || typeof data !== 'object') return;

  // Controlled preload support.
  //
  // Expected message:
  // {
  //   type: 'PRELOAD_URLS',
  //   urls: ['https://.../z/x/y.png', './data/file.geojson'],
  //   cacheName: 'tiles' | 'data' | optional full cache name
  // }
  //
  // The app should decide what URLs are appropriate to preload.
  // Do not bulk-preload tile providers unless their terms permit it.
  if (data.type === 'PRELOAD_URLS') {
    event.waitUntil(preloadUrls(event));
  }
});

async function preloadUrls(event) {
  const data = event.data || {};
  const urls = Array.isArray(data.urls) ? data.urls : [];

  let cacheName = TILE_CACHE;

  if (data.cacheName === 'data') cacheName = DATA_CACHE;
  else if (data.cacheName === 'tiles') cacheName = TILE_CACHE;
  else if (data.cacheName === 'static') cacheName = STATIC_CACHE;
  else if (typeof data.cacheName === 'string' && data.cacheName.startsWith('ontario-trails-')) {
    cacheName = data.cacheName;
  }

  const cache = await caches.open(cacheName);

  let completed = 0;
  let cachedCount = 0;
  let failedCount = 0;

  for (const rawUrl of urls) {
    try {
      const absoluteUrl = new URL(rawUrl, self.location.href);
      const req = new Request(absoluteUrl.toString(), {
        method: 'GET',
        mode: absoluteUrl.origin === self.location.origin ? 'same-origin' : 'no-cors'
      });

      const existing = await cache.match(req, { ignoreVary: true });

      if (!existing) {
        const res = await fetch(req);

        if (res && (res.ok || res.type === 'opaque')) {
          await cache.put(req, res.clone());
          cachedCount++;
        } else {
          failedCount++;
        }
      } else {
        cachedCount++;
      }
    } catch {
      failedCount++;
    }

    completed++;

    // Report progress back to the page.
    try {
      event.source?.postMessage({
        type: 'PRELOAD_PROGRESS',
        completed,
        total: urls.length,
        cached: cachedCount,
        failed: failedCount,
        cacheName
      });
    } catch {
      // Ignore if no client is available.
    }

    // Keep cache bounded during longer preloads.
    if (completed % 25 === 0) {
      if (LIMITS[cacheName]) await trimCache(cacheName, LIMITS[cacheName]);
    }
  }

  if (LIMITS[cacheName]) await trimCache(cacheName, LIMITS[cacheName]);

  try {
    event.source?.postMessage({
      type: 'PRELOAD_DONE',
      completed,
      total: urls.length,
      cached: cachedCount,
      failed: failedCount,
      cacheName
    });
  } catch {
    // Ignore if no client is available.
  }
}

// ===== Fetch =================================================================

self.addEventListener('fetch', event => {
  const req = event.request;

  // Ignore anything that is not a simple GET, or is a range request.
  if (req.method !== 'GET' || req.headers.has('range')) return;

  const url = new URL(req.url);

  // 1) Navigations: network first, cached index fallback.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;

        const netRes = await fetch(req);
        return netRes;
      } catch {
        const cache = await caches.open(STATIC_CACHE);
        const cached = await cache.match('./index.html');
        return cached || new Response('Offline', {
          status: 503,
          statusText: 'Offline'
        });
      }
    })());

    return;
  }

  // 2) Same-origin data: network first with fallback to durable offline data cache.
// Handles .geojson and .json.
if (isDataURL(url)) {
  event.respondWith(
    networkFirstWithDataFallback(req, DATA_CACHE, USER_OFFLINE_DATA_CACHE, 8000)
  );
  return;
}

  // App version should be checked from network first so update detection is reliable.
  if (isSameOrigin(url) && url.pathname.endsWith('/app-version.js')) {
    event.respondWith(networkFirst(req, STATIC_CACHE, 3000));
  return;
}

  // 3) Same-origin static: cache first.
  if (isStaticURL(url)) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

 
// 3b) User-managed offline basemap tiles from R2/custom domain.
// Use the durable basemap cache, not the small generic TILE_CACHE.
if (isOfflineBasemapURL(url)) {
  event.respondWith(
    staleWhileRevalidate(req, USER_OFFLINE_BASEMAP_CACHE)
  );
  return;
}

  // 4) Tiles and CDN assets: stale-while-revalidate.
  // Also catches tile-looking URL patterns.
  if (isTileOrCDN(url) || looksLikeTileURL(url)) {
    event.respondWith(staleWhileRevalidate(req, TILE_CACHE));
    return;
  }

  // 5) Everything else: network, then any-cache fallback.
  event.respondWith((async () => {
    try {
      return await fetch(req);
    } catch {
      const keys = await caches.keys();

      for (const key of keys) {
        const cache = await caches.open(key);
        const match = await cache.match(req, { ignoreVary: true });
        if (match) return match;
      }

      return new Response('Offline', {
        status: 503,
        statusText: 'Offline'
      });
    }
  })());
});