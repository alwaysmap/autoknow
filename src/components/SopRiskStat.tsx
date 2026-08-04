'use client';

import React from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { sopBufferRisk, SOP_FLAGGED_CLASSES, type SopBufferProgram } from '../lib/sop';
import StatTile from './StatTile';
import styles from './SopRiskStat.module.css';

// The Big Number, second seat: how many active programs are in trouble against their
// SOP — the date already missed, the chain overrunning a date still ahead, or the
// buffer fallen under the 50%-rule reserve (lib/sop.SOP_FLAGGED_CLASSES; why all three
// and not only the first is
// docs/adr/2026-08-03-a-summary-count-uses-the-threshold-of-the-detail-it-summarizes.md,
// not this file). Same per-row signal the /programs "SOP outlook" column renders,
// counted across the ecosystem, so a leader sees the size of the slip problem before
// reading which programs it is.
//
// The figure is a door to exactly those programs: the deep link preselects that
// column's funnel on the same classes (selections are OR-ed within a column,
// design.md §6), built from the same constant the count is.

interface SopRiskStatProps {
  programs: SopBufferProgram[];
  /** Server-snapshotted so SSR and hydration agree. */
  now: number;
}

const FLAGGED_HREF = `/programs?${SOP_FLAGGED_CLASSES.map((c) => `sopOutlook=${c}`).join('&')}`;

export default function SopRiskStat({ programs, now }: SopRiskStatProps) {
  const locale = useLocale();
  const { flagged, blown, assessable, undated } = sopBufferRisk(programs, now);

  return (
    <StatTile
      testId="sop-risk-stat"
      label={t(locale, 'statsSopAtRisk')}
      value={flagged.toLocaleString(locale)}
      href={FLAGGED_HREF}
      title={t(locale, 'statsSopAtRiskTitle')}
      // A zero is good news and stays in plain ink — coloring it would cry wolf.
      tone={flagged > 0 ? 'warn' : 'default'}
      sub={
        <>
          {t(locale, 'statsSopOfDated', { n: assessable.toLocaleString(locale) })}
          {/* A SOP already in the past is not a forecast and does not read as one: it
              is broken out here, in --bad, because "3 at risk" and "3 at risk, 1 of
              them already past its date" are different briefings. */}
          {blown > 0 && (
            <>
              {' · '}
              <span className={styles.blown}>
                {t(locale, 'statsSopMissed', { n: blown.toLocaleString(locale) })}
              </span>
            </>
          )}
          {/* An SOP-less active program can't be assessed at all. Owning up to that
              beats quietly shrinking the denominator. */}
          {undated > 0 && ` · ${t(locale, 'statsSopUndated', { n: undated.toLocaleString(locale) })}`}
        </>
      }
    />
  );
}
