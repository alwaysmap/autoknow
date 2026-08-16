// Pure bucket math for #171's freshness stamps — split from the component so the
// boundary arithmetic is testable without a DOM (mirrors hillLayout.ts/labelPlacement.ts
// splitting layout math from the SVG that draws it).
//
// Buckets stop at DAYS on purpose: past `CROSSOVER_DAYS`, "2 months ago" is vaguer than
// a calendar date, so the caller falls back to an absolute label instead of reaching for
// week/month/year units at all (design decision #4 — the crossover is a cliff, not a
// gentler unit).
import { dayLabel, type DateLabelMode } from './dates';
import type { Locale } from './i18n';

const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;
export const CROSSOVER_DAYS = 30;

export interface RelativeBucket {
  /** Past the crossover — the caller renders an absolute date instead. */
  isAbsolute: boolean;
  /** Under a minute — `Intl.RelativeTimeFormat` would say "0 minutes ago", which reads
   *  as a bug, not a value; the caller substitutes a localized "just now". */
  isJustNow: boolean;
  unit?: Intl.RelativeTimeFormatUnit;
  /** Signed: negative is past, positive is future (a briefing can be generated a few
   *  seconds ahead of a reader's clock skew — `numeric: 'auto'` phrases that too). */
  value?: number;
}

/** `now` is a parameter, never `Date.now()` read internally, so this stays a pure
 *  function a test can pin to an exact instant. */
export function bucketRelativeTime(value: string | Date, now: number): RelativeBucket {
  const deltaSec = Math.round((new Date(value).getTime() - now) / 1000);
  const abs = Math.abs(deltaSec);
  if (abs >= CROSSOVER_DAYS * DAY) return { isAbsolute: true, isJustNow: false };
  if (abs < MINUTE) return { isAbsolute: false, isJustNow: true };
  if (abs < HOUR) return { isAbsolute: false, isJustNow: false, unit: 'minute', value: Math.round(deltaSec / MINUTE) };
  if (abs < DAY) return { isAbsolute: false, isJustNow: false, unit: 'hour', value: Math.round(deltaSec / HOUR) };
  return { isAbsolute: false, isJustNow: false, unit: 'day', value: Math.round(deltaSec / DAY) };
}

/** The full reading-form text: relative inside the crossover, an absolute date past it
 *  (the same `dayLabel` shape `DateCell` renders, so the stamp and the cell agree about
 *  what a day is called — including under the week-bearing DATE_LABELS modes),
 *  "just now" under a minute. `justNowLabel` is resolved by the caller
 *  (`t(locale, 'justNow')`) so this stays free of an i18n import. `dateLabels` defaults
 *  to today's behaviour so a caller that has no reader context still renders a date. */
export function relativeTimeText(
  value: string | Date,
  now: number,
  locale: Locale,
  justNowLabel: string,
  dateLabels: DateLabelMode = 'date',
): string {
  const bucket = bucketRelativeTime(value, now);
  if (bucket.isAbsolute) return dayLabel(value, locale, dateLabels, { year: true });
  if (bucket.isJustNow) return justNowLabel;
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(bucket.value!, bucket.unit!);
}
