'use client';

import { useEffect, useState } from 'react';
import { useLocale } from './LocaleProvider';
import { t } from '../lib/i18n';
import styles from './ThemeToggle.module.css';

// Three-state theme control (light | dark | system). The stored PREFERENCE may be
// "system"; what lands on <html data-theme> is always the RESOLVED "light"/"dark"
// (the inline script in layout.tsx does the same before first paint, so this
// component only has to keep the attribute in sync after interaction).

type Pref = 'light' | 'dark' | 'system';
const STORAGE_KEY = 'autoknow-theme';

function resolve(pref: Pref): 'light' | 'dark' {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function apply(pref: Pref) {
  document.documentElement.dataset.theme = resolve(pref);
}

export default function ThemeToggle() {
  const locale = useLocale();
  const [pref, setPref] = useState<Pref>('system');
  // The server renders a neutral control; read the real preference after mount
  // (the html attribute itself was already set pre-paint, so nothing flashes).
  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as Pref | null;
    if (stored === 'light' || stored === 'dark' || stored === 'system') setPref(stored);
  }, []);
  // Follow OS changes live while in system mode.
  useEffect(() => {
    if (pref !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply('system');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [pref]);

  const choose = (next: Pref) => {
    setPref(next);
    localStorage.setItem(STORAGE_KEY, next);
    apply(next);
  };

  const options: Array<{ value: Pref; label: string; icon: React.ReactNode }> = [
    {
      value: 'light',
      label: t(locale, 'themeLight'),
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ),
    },
    {
      value: 'dark',
      label: t(locale, 'themeDark'),
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      ),
    },
    {
      value: 'system',
      label: t(locale, 'themeSystem'),
      icon: (
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <rect x="3" y="4" width="18" height="13" rx="2" />
          <path d="M8 21h8m-4-4v4" />
        </svg>
      ),
    },
  ];

  return (
    <div role="radiogroup" aria-label={t(locale, 'themeLabel')} className={styles.group}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={pref === o.value}
          aria-label={o.label}
          title={o.label}
          type="button"
          className={styles.option}
          onClick={() => choose(o.value)}
        >
          {o.icon}
        </button>
      ))}
    </div>
  );
}
