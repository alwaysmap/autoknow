'use client';

import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import StatTile from './StatTile';

// The initiatives ecosystem-strip tile (gh-286 part h): how many initiatives are live
// right now. It sits beside the program tile because the two are one question — how much
// work is in flight — split by shape: programs are single-partner launches, initiatives
// the cross-partner goals the program loaders deliberately exclude (gh-286 decision 5).
// The figure links to /initiatives (design.md §2: a count is a door to the list it
// summarizes). No tone: the number is inventory, not news — unlike SopRiskStat and
// EscalationsStat, where a non-zero count is itself the bad news.

export default function InitiativesStat({ count }: { count: number }) {
  const locale = useLocale();
  return (
    <StatTile
      testId="initiatives-stat"
      label={t(locale, 'statsActiveInitiatives')}
      value={count.toLocaleString(locale)}
      href="/initiatives"
      title={t(locale, 'statsViewInitiatives')}
    />
  );
}
