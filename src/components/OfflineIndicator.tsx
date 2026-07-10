'use client';

import { useEffect, useSyncExternalStore } from 'react';
import styles from './OfflineIndicator.module.css';

// Online/offline is external browser state — subscribe to it directly instead of
// mirroring it into useState from an effect. The server snapshot is "online".
const subscribe = (onChange: () => void) => {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
};

export default function OfflineIndicator() {
  const isOnline = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);

  // Register the service worker for offline support (no state involved).
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('ServiceWorker registration successful with scope: ', registration.scope);
        })
        .catch((err) => {
          console.log('ServiceWorker registration failed: ', err);
        });
    }
  }, []);

  return (
    <div className={styles.container}>
      {isOnline ? (
        <span className={styles.onlineBadge}>
          <span className={styles.pulseGreen}></span>
          Online
        </span>
      ) : (
        <span className={styles.offlineBadge}>
          ⚡ Working Offline (Cached)
        </span>
      )}
    </div>
  );
}
