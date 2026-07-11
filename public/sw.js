// Kill-switch: the offline feature is retired. Browsers that still have the old
// worker fetch this file on their next visit; it unregisters itself, deletes all
// caches, and reloads any open tabs so they leave the worker's control. Keep this
// file until the fleet is clean — deleting it outright would leave the old
// Cache-First worker running forever.
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    })()
  );
});
