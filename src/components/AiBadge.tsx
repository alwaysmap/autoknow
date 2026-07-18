'use client';

import React from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './AiBadge.module.css';

// The machine-provenance mark (design.md §8): every piece of LLM-written text
// carries this sparkle adjacent to its first line; human-written text is never
// marked (its provenance is author attribution). One component so the treatment
// can't drift between surfaces.

export default function AiBadge() {
  const locale = useLocale();
  return (
    <span className={styles.badge} title={t(locale, 'aiTitle')}>
      <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden>
        {/* four-point sparkle — concave sides so it can't read as a plus at 10px */}
        <path d="M 6 0.5 Q 6.9 4.4 11.5 6 Q 6.9 7.6 6 11.5 Q 5.1 7.6 0.5 6 Q 5.1 4.4 6 0.5 Z" fill="currentColor" />
      </svg>
      {t(locale, 'aiLabel')}
    </span>
  );
}
