/*
 * Service Worker for MITTI‑Helper
 *
 * This service worker implements a simple cache-first strategy for static
 * resources. It caches the core assets on install and serves them from cache
 * while attempting to fetch an updated version from the network in the
 * background. It also cleans up old caches during activation. This allows the
 * application to function offline when hosted via GitHub Pages on a subpath.
 */

const CACHE_VERSION = 'mitti-helper-v1';
const CACHE_NAME = `${CACHE_VERSION}`;
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.svg',
  './icons/icon-512.svg'
];

// Install event: pre-cache core assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(CORE_ASSETS);
    })
  );
});

// Activate event: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    })
  );
});

// Fetch event: cache-first with network fallback
self.addEventListener('fetch', (event) => {
  const request = event.request;
  // Only handle GET requests
  if (request.method !== 'GET') return;
  event.respondWith(
    caches.match(request).then(cachedResponse => {
      const fetchPromise = fetch(request).then(networkResponse => {
        // If response is OK, update cache
        if (networkResponse && networkResponse.status === 200) {
          caches.open(CACHE_NAME).then(cache => {
            cache.put(request, networkResponse.clone());
          });
        }
        return networkResponse;
      }).catch(() => {
        // network failed
        return cachedResponse;
      });
      // Serve cached if available; else fetch from network
      return cachedResponse || fetchPromise;
    })
  );
});