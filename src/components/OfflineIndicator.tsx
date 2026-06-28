'use client';

import { useState, useEffect } from 'react';
import styles from './OfflineIndicator.module.css';

export default function OfflineIndicator() {
  const [isOnline, setIsOnline] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window !== 'undefined' && typeof navigator !== 'undefined') {
      setIsOnline(navigator.onLine);

      const handleOnline = () => setIsOnline(true);
      const handleOffline = () => setIsOnline(false);

      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);

      // Register service worker for offline support
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

      return () => {
        window.removeEventListener('online', handleOnline);
        window.removeEventListener('offline', handleOffline);
      };
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
