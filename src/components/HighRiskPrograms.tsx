'use client';

import React from 'react';
import Link from 'next/link';
import { healthOrder, healthColor, healthKey } from '../lib/health';
import { sopOutlook, riskScore } from '../lib/sop';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './HighRiskPrograms.module.css';

// The programs most likely to sink capacity: up to five ACTIVE programs ranked by
// health severity, then SOP lateness (remaining chain weeks overshooting the target).
// A missing SOP is itself flagged — the target is required. "More →" opens the
// Programs page pre-filtered/sorted the same way.

export interface RiskProgram {
  id: number;
  name: string;
  isArchived: boolean;
  theNeedle: string;
  hillChartProgress: number;
  sopDate: string | null;
  volumeFirstYear: number;
  chainRemainingDays: number;
}

export default function HighRiskPrograms({ programs, now }: { programs: RiskProgram[]; now: number }) {
  const locale = useLocale();

  const ranked = programs
    .filter((p) => !p.isArchived && p.hillChartProgress < 100)
    .map((p) => {
      const slackDays = p.sopDate ? sopOutlook(p.chainRemainingDays, p.sopDate, now).slackDays : null;
      return { ...p, slackDays, score: riskScore(healthOrder(p.theNeedle), slackDays) };
    })
    // high-risk = health above On Track, OR late against SOP, OR no SOP at all
    .filter((p) => p.score > 0 || p.slackDays == null)
    .sort((a, b) => b.score - a.score || (a.slackDays ?? 0) - (b.slackDays ?? 0))
    .slice(0, 5);

  return (
    <div data-testid="high-risk-programs">
      <div className={styles.title}>{t(locale, 'highRiskTitle')}</div>
      {ranked.length === 0 ? (
        <p className={styles.none}>{t(locale, 'highRiskNone')}</p>
      ) : (
        <ul className={styles.list}>
          {ranked.map((p) => (
            <li key={p.id} className={styles.row}>
              <Link href={`/programs/${p.id}`} className={styles.name}>{p.name}</Link>
              <span className={styles.health} style={{ color: healthColor(p.theNeedle) }}>
                {t(locale, healthKey(p.theNeedle))}
              </span>
              {p.slackDays == null ? (
                <span className={styles.flag}>{t(locale, 'missingSop')}</span>
              ) : p.slackDays < 0 ? (
                <span className={styles.flag}>{t(locale, 'lateByWeeks', { n: Math.ceil(-p.slackDays / 7) })}</span>
              ) : null}
              {p.volumeFirstYear > 0 && (
                <span className={styles.volume}>{p.volumeFirstYear.toLocaleString(locale)}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Link href="/programs?minRisk=1&sort=risk" className={styles.more}>
        {t(locale, 'highRiskMore')}
      </Link>
    </div>
  );
}
