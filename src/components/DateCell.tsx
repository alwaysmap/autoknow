'use client';

import { isoDate, isoWeekLabel, localDate } from '../lib/dates';
import { useLocale } from './LocaleProvider';

// The one way tables render dates (issue #153).
//
// The machine form and the reading form are BOTH here, on the same element:
//   • `dateTime` stays ISO — that is what assistive tech announces, what a copy-paste
//     of the element yields, and what `<time>` is for.
//   • the VISIBLE text is locale-short — "Jun 1, 2018", not "2018-06-01". `day:'numeric'`,
//     never '2-digit': "Jun 1", not "Jun 01".
//   • hover still reveals the ISO calendar week ("W22").
//
// §6 used to forbid this outright ("locale-formatted dates misalign and mis-sort"). The
// mis-sort half no longer holds: DataTable sorts the ROW VALUE, not the rendered node,
// and the server ships full ISO strings. The misalign half partly does — "Jun 1" and
// "Sep 30" differ in day-field width — so tabular-nums and nowrap stay; they buy digit
// alignment within the day and year fields even though the fields themselves can shift.
//
// 'use client' because the reading form needs a LOCALE, and the locale reaches
// components through LocaleProvider's context. `localDate` pins the timezone to UTC, so
// the server render and the hydrated render name the same day either side of midnight.

export default function DateCell({
  value,
  fallback = '—',
}: {
  value: string | Date | null | undefined;
  fallback?: string;
}) {
  const locale = useLocale();
  if (!value) return <span style={{ color: 'var(--muted, #888)' }}>{fallback}</span>;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span style={{ color: 'var(--muted, #888)' }}>{fallback}</span>;
  return (
    <time
      dateTime={isoDate(d)}
      title={isoWeekLabel(d)}
      style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {localDate(d, locale, { year: 'numeric', month: 'short', day: 'numeric' })}
    </time>
  );
}
