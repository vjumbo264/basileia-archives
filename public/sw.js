/**
 * Basileia Archives Service Worker (v3.0.0)
 * - Versioned App Shell cache
 * - Stale-while-revalidate for catalog.json and episodes.json
 * - LRU Cover cache with quota error recovery
 * - Audio streaming/downloads NEVER cached (always network)
 * - Safe fallback if Cache API or storage unavailable
 */

const SHELL_CACHE = 'basileia-shell-v3.0.0';
const CATALOG_CACHE = 'basileia-catalog-v3.0.0';
const COVERS_CACHE = 'basileia-covers-v3.0.0';
const MAX_CACHED_COVERS = 100;

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/metadata.json'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache => {
      return cache.addAll(SHELL_ASSETS).catch(err => {
        console.warn('SW shell pre-cache skipped optional assets:', err);
      });
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (![SHELL_CACHE, CATALOG_CACHE, COVERS_CACHE].includes(key)) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Helper: Trim cover cache to LRU max
async function trimCoverCache() {
  try {
    const cache = await caches.open(COVERS_CACHE);
    const keys = await cache.keys();
    if (keys.length > MAX_CACHED_COVERS) {
      const excess = keys.length - MAX_CACHED_COVERS;
      for (let i = 0; i < excess; i++) {
        await cache.delete(keys[i]);
      }
    }
  } catch (e) {
    // Graceful silence on quota/storage error
  }
}

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);

  // 1. Audio files or audio proxy: NEVER cache audio
  if (
    url.pathname.includes('/releases/download/audio-') ||
    url.pathname.endsWith('.m4a') ||
    url.pathname.endsWith('.mp3') ||
    url.pathname.startsWith('/api/audio-proxy') ||
    url.searchParams.has('audio')
  ) {
    return; // Pass directly to native network / Range streaming
  }

  // 2. Catalog data (stale-while-revalidate)
  if (url.pathname.endsWith('catalog.json') || url.pathname.endsWith('episodes.json')) {
    event.respondWith(
      caches.open(CATALOG_CACHE).then(async cache => {
        const cachedResponse = await cache.match(request);
        const fetchPromise = fetch(request)
          .then(networkResponse => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(request, networkResponse.clone());
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
    return;
  }

  // 3. Cover art images (cache-first + LRU limit)
  if (
    url.pathname.startsWith('/assets/covers/') ||
    url.pathname.includes('/covers/') ||
    url.hostname.includes('podbean.com') ||
    url.pathname.endsWith('.webp') ||
    url.pathname.endsWith('.jpg') ||
    url.pathname.endsWith('.jpeg')
  ) {
    event.respondWith(
      caches.open(COVERS_CACHE).then(async cache => {
        const cached = await cache.match(request);
        if (cached) return cached;

        try {
          const res = await fetch(request);
          if (res && res.status === 200) {
            cache.put(request, res.clone()).then(() => trimCoverCache());
          }
          return res;
        } catch (err) {
          return cached || new Response('', { status: 408 });
        }
      })
    );
    return;
  }

  // 4. Default: Network first with shell fallback
  event.respondWith(
    caches.match(request).then(cached => {
      return (
        fetch(request)
          .then(res => {
            // Cache successful HTML / script responses into shell
            if (
              res.status === 200 &&
              (url.pathname === '/' || url.pathname.endsWith('.html') || url.pathname.endsWith('.js') || url.pathname.endsWith('.css'))
            ) {
              caches.open(SHELL_CACHE).then(cache => cache.put(request, res.clone())).catch(() => {});
            }
            return res;
          })
          .catch(() => cached)
      );
    })
  );
});
