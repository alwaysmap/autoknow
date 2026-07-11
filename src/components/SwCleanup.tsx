'use client';

import { useEffect } from 'react';

// The offline feature (service worker + cache) is retired. Its Cache-First asset
// strategy served stale CSS/JS after every deploy/edit. This renders nothing and
// evicts the retired worker from browsers that still carry it: unregister every
// registration and delete every cache. public/sw.js is a matching kill-switch for
// browsers that update the worker before running page JS. Delete this component
// (and sw.js) once the fleet has been clean for a while.
export default function SwCleanup() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => Promise.all(regs.map((r) => r.unregister())))
        .catch(() => {});
    }
    if (typeof caches !== 'undefined') {
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(() => {});
    }
  }, []);
  return null;
}
