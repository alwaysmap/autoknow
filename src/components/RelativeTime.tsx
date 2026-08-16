'use client';

import { useSyncExternalStore } from 'react';
import { useLocale } from './LocaleProvider';
import { t } from '../lib/i18n';
import { dayLabel, isoDateTime } from '../lib/dates';
import { useDateLabels } from './DateLabelsProvider';
import { relativeTimeText } from '../lib/relativeTime';
import { subscribeTick, getTickNow } from '../lib/relativeTimeTicker';

// #171: the shared "is what I'm reading current?" answer — "20 minutes ago", not
// "2026-07-26 00:15 UTC" the reader has to do arithmetic on. Sibling to `DateCell`
// (design.md §6) for the same reason: the format, the crossover threshold, and the
// `<time>` markup live in ONE place or they drift into four, which is exactly how this
// issue found three byte-identical `updatedOn` copies and three differently-shaped
// freshness stamps in the first place (AGENTS lesson 7).
//
// §6 governs table CELLS — record dates read down a column, compared against each
// other, where a ragged "3 days ago / 4 days ago / last month" fights a sortable,
// aligned ISO/locale-short grammar. This governs STAMPS — "is this fact still true" —
// answered against NOW, one at a time, which is exactly what a duration answers and a
// column of them does not. A `DateCell` column never becomes a `RelativeTime` column;
// this component has no place in one.
//
// Nothing is lost converting a stamp to relative: `dateTime` stays the exact ISO
// instant (assistive tech, copy-paste, anything parsing the DOM) and `title` carries
// the full UTC stamp on hover — `DateCell`'s existing machine-form/reading-form split,
// extended to a duration instead of a date.
export default function RelativeTime({
  value,
  className,
}: {
  value: string | Date;
  className?: string;
}) {
  const locale = useLocale();
  const dateLabels = useDateLabels();
  // 0 on the server AND on the client's first (hydration-matching) render; a real
  // timestamp once mounted. Relative time depends on `now`, which differs between the
  // server and the browser BY DEFINITION (AGENTS lesson 8) — rendering the absolute
  // form until mount, unconditionally, is what keeps SSR and first paint byte-identical
  // instead of producing a hydration mismatch warning.
  const now = useSyncExternalStore(subscribeTick, getTickNow, () => 0);
  const iso = new Date(value).toISOString();
  const title = `${isoDateTime(value)} UTC`;
  const text = now > 0
    ? relativeTimeText(value, now, locale, t(locale, 'justNow'), dateLabels)
    : dayLabel(value, locale, dateLabels, { year: true });
  return (
    <time dateTime={iso} title={title} className={className}>
      {text}
    </time>
  );
}
