'use client';

import React from 'react';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { sopBufferRisk, type SopBufferProgram } from '../lib/sop';
import StatTile from './StatTile';

// The Big Number, second seat: how many active programs are projected to blow their
// SOP date because the buffer is gone — now + remaining critical-chain work already
// lands past the target. Same per-row signal the at-risk table's Forecast column
// renders, counted across the ecosystem, so a leader sees the size of the slip
// problem before reading which programs it is.
//
// The figure is a door to exactly those programs: /programs?sopOutlook=late preselects
// the SOP-outlook column funnel on the deterministic-buffer "At risk" class, so the
// count here and the list it opens are the same set by construction (both are
// lib/sop.sopBufferCategory === 'late').

interface SopRiskStatProps {
  programs: SopBufferProgram[];
  /** Server-snapshotted so SSR and hydration agree. */
  now: number;
}

export default function SopRiskStat({ programs, now }: SopRiskStatProps) {
  const locale = useLocale();
  const { late, assessable, undated } = sopBufferRisk(programs, now);

  return (
    <StatTile
      testId="sop-risk-stat"
      label={t(locale, 'statsSopAtRisk')}
      value={late.toLocaleString(locale)}
      href="/programs?sopOutlook=late"
      title={t(locale, 'statsSopAtRiskTitle')}
      // A zero is good news and stays in plain ink — coloring it would cry wolf.
      tone={late > 0 ? 'warn' : 'default'}
      sub={
        <>
          {t(locale, 'statsSopOfDated', { n: assessable.toLocaleString(locale) })}
          {/* An SOP-less active program can't be assessed at all. Owning up to that
              beats quietly shrinking the denominator. */}
          {undated > 0 && ` · ${t(locale, 'statsSopUndated', { n: undated.toLocaleString(locale) })}`}
        </>
      }
    />
  );
}
