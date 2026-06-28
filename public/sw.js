const CACHE_NAME = 'autoknow-cache-v1';
const PRECACHE_ASSETS = [
  '/',
  '/globals.css',
  '/favicon.ico'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip POST requests, API calls, and WebSockets (like next-dev HMR)
  if (
    event.request.method !== 'GET' ||
    url.pathname.startsWith('/api') ||
    url.pathname.includes('/_next/webpack-hmr') ||
    url.pathname.includes('/ws')
  ) {
    return;
  }

  // Search does not work offline
  if (url.pathname.startsWith('/search')) {
    event.respondWith(
      fetch(event.request).catch(() => {
        return new Response(
          `<html>
            <head>
              <title>Search Unavailable Offline</title>
              <style>
                body { font-family: sans-serif; text-align: center; padding: 50px; background: #f7f5ed; color: #333; }
                h1 { font-size: 24px; color: #b06000; }
                p { font-size: 14px; }
                a { color: #4285f4; text-decoration: none; font-weight: bold; }
              </style>
            </head>
            <body>
              <h1>Search is Unavailable Offline</h1>
              <p>Search queries require connection to the pgvector database. Please reconnect to the network.</p>
              <p><a href="/">Go to Dashboard</a></p>
            </body>
          </html>`,
          { headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  const isRsc = event.request.headers.get('RSC') === '1' || url.searchParams.has('_rsc') || url.pathname.includes('/_next/data');

  // Network First for Next.js RSC data requests
  if (isRsc) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request);
        })
    );
    return;
  }

  // Network First, fallback to cache for document requests (HTML pages)
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
          return response;
        })
        .catch(() => {
          return caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
              return cachedResponse;
            }
            // Fallback if page not cached
            return new Response(
              `<html>
                <head>
                  <title>Offline Mode - Page Uncached</title>
                  <style>
                    body { font-family: sans-serif; text-align: center; padding: 50px; background: #f7f5ed; color: #333; }
                    h1 { font-size: 20px; color: #b06000; }
                    p { font-size: 14px; }
                    a { color: #4285f4; text-decoration: none; font-weight: bold; }
                  </style>
                </head>
                <body>
                  <h1>Working Offline</h1>
                  <p>This page hasn't been cached yet. Navigate to already visited pages to view them offline.</p>
                  <p><a href="/">Go to Dashboard</a></p>
                </body>
              </html>`,
              { headers: { 'Content-Type': 'text/html' } }
            );
          });
        })
    );
    return;
  }

  // Cache First for static resources (JS, CSS, images, fonts)
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((response) => {
        // Cache newly fetched assets
        if (response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      });
    })
  );
});
