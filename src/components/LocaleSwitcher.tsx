'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { LOCALES, isLocale, type Locale } from '../lib/i18n';
import { LOCALE, LOCALE_LEGACY_KEY } from '../lib/preferences';
import styles from './LocaleSwitcher.module.css';

// The ONE locale picker, in the global nav: a plain dropdown whose value is the
// cookie-set default. Picking a language writes the locale cookie (the server's source of
// truth, keyed via the preferences registry, #31) and refreshes the route so server
// components re-render localized.

export default function LocaleSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const pick = (code: string) => {
    if (!isLocale(code)) return;
    document.cookie = `${LOCALE.key}=${code}; path=/; max-age=31536000`;
    document.cookie = `${LOCALE_LEGACY_KEY}=; path=/; max-age=0`; // retire the pre-namespace cookie
    router.refresh();
  };
  return (
    <select
      className={styles.select}
      aria-label="Language"
      defaultValue={locale}
      onChange={(e) => pick(e.target.value)}
    >
      {LOCALES.map((l) => (
        <option key={l.code} value={l.code}>{l.label}</option>
      ))}
    </select>
  );
}
