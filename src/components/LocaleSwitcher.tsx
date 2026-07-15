'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { LOCALES, isLocale, type Locale } from '../lib/i18n';
import styles from './LocaleSwitcher.module.css';

// The ONE locale picker, in the global nav: a plain dropdown whose value is the
// cookie-set default. Picking a language writes the `lang` cookie (the server's
// source of truth) and refreshes the route so server components re-render localized.

export default function LocaleSwitcher({ locale }: { locale: Locale }) {
  const router = useRouter();
  const pick = (code: string) => {
    if (!isLocale(code)) return;
    document.cookie = `lang=${code}; path=/; max-age=31536000`;
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
