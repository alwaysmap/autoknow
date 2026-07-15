'use client';

import React from 'react';
import Link from 'next/link';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './EcosystemStats.module.css';

// The Big Number: how many programs are ACTIVE right now (not archived, not done),
// with the all-time total as quiet context beneath it. Tufte: one huge figure,
// small-caps label, no box. Every summary is a door: the big number opens the
// Programs page filtered to active; the all-time count opens it unfiltered.

interface EcosystemStatsProps {
  activeCount: number;
  allTimeCount: number;
}

export default function EcosystemStats({ activeCount, allTimeCount }: EcosystemStatsProps) {
  const locale = useLocale();
  return (
    <div className={styles.stat} data-testid="ecosystem-stats">
      <div className={styles.label}>{t(locale, 'statsActivePrograms')}</div>
      <Link href="/programs?filter=active" className={styles.big} title={t(locale, 'viewActivePrograms')}>
        {activeCount.toLocaleString(locale)}
      </Link>
      <Link href="/programs" className={styles.sub} title={t(locale, 'viewAllPrograms')}>
        {t(locale, 'statsAllTime', { n: allTimeCount.toLocaleString(locale) })}
      </Link>
    </div>
  );
}
