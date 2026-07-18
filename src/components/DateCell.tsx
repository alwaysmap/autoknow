import { isoDate, isoWeekLabel } from '../lib/dates';

// The one way tables render dates: ISO for scanability and lexicographic
// sortability, calendar week ("W29") on hover. Pure — usable from server and
// client components alike.

export default function DateCell({
  value,
  fallback = '—',
}: {
  value: string | Date | null | undefined;
  fallback?: string;
}) {
  if (!value) return <span style={{ color: 'var(--muted, #888)' }}>{fallback}</span>;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return <span style={{ color: 'var(--muted, #888)' }}>{fallback}</span>;
  return (
    <time
      dateTime={isoDate(d)}
      title={isoWeekLabel(d)}
      style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
    >
      {isoDate(d)}
    </time>
  );
}
