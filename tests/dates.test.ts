import { dayLabel, dayLabelTitle, isoDate, isoWeekLabel, isoWeekYearLabel } from '../src/lib/dates';

describe('table date rendering', () => {
  test('isoDate is yyyy-mm-dd', () => {
    expect(isoDate('2026-07-18T14:22:00Z')).toBe('2026-07-18');
  });

  test('isoWeekLabel follows ISO-8601 week rules', () => {
    expect(isoWeekLabel('2026-07-18')).toBe('W29');
    expect(isoWeekLabel('2026-01-01')).toBe('W1'); // Thursday → week 1
    expect(isoWeekLabel('2024-12-30')).toBe('W1'); // Monday belonging to 2025-W01
    expect(isoWeekLabel('2026-12-28')).toBe('W53');
  });

  test('a week is qualified by its WEEK-numbering year, not its calendar year', () => {
    expect(isoWeekYearLabel('2026-07-18')).toBe('W29 2026');
    // The whole reason the two travel together: this Monday is in 2024 and in 2025-W01.
    // A label built from getUTCFullYear() would read "W1 2024" — a week that never existed.
    expect(isoWeekYearLabel('2024-12-30')).toBe('W1 2025');
    // The mirror case: a Thursday-first year start pulls Jan 1 back into the prior year.
    expect(isoWeekYearLabel('2027-01-01')).toBe('W53 2026');
  });
});

describe('dayLabel — the one way a DAY is written (DATE_LABELS)', () => {
  const d = '2026-07-18T09:00:00Z'; // a Saturday in W29

  test("'date' is exactly what shipped before the preference existed", () => {
    expect(dayLabel(d, 'en-US', 'date')).toBe('Jul 18');
    expect(dayLabel(d, 'en-US', 'date', { year: true })).toBe('Jul 18, 2026');
    expect(dayLabel(d, 'en-US', 'date', { year: true, month: 'long' })).toBe('July 18, 2026');
  });

  test("'date-week' appends the week and never repeats the year", () => {
    expect(dayLabel(d, 'en-US', 'date-week')).toBe('Jul 18 · W29');
    // NOT "Jul 18, 2026 · W29 2026" — the calendar year is already in the date beside it.
    expect(dayLabel(d, 'en-US', 'date-week', { year: true })).toBe('Jul 18, 2026 · W29');
  });

  test("'week' replaces the date, and takes the year exactly where the date would have", () => {
    expect(dayLabel(d, 'en-US', 'week')).toBe('W29');
    expect(dayLabel(d, 'en-US', 'week', { year: true })).toBe('W29 2026');
    // `month: 'long'` is a shape for the DATE half; with no date there is nothing to widen.
    expect(dayLabel(d, 'en-US', 'week', { year: true, month: 'long' })).toBe('W29 2026');
  });

  test('the label is UTC-pinned in every mode (SSR and hydration must name the same day)', () => {
    // 23:30 UTC is the previous day in every zone west of Greenwich; a formatter reading
    // the machine's zone would hydrate to Jul 18 on a server in UTC and Jul 17 in AMER.
    expect(dayLabel('2026-07-18T23:30:00Z', 'en-US', 'date')).toBe('Jul 18');
    expect(dayLabel('2026-07-18T23:30:00Z', 'en-US', 'week')).toBe('W29');
  });

  test('the title carries whatever the visible text does not', () => {
    expect(dayLabelTitle(d, 'date')).toBe('W29 2026');
    expect(dayLabelTitle(d, 'date-week')).toBe('W29 2026');
    // Week-only: the DATE is the half a reader can no longer see, so hover recovers it.
    expect(dayLabelTitle(d, 'week')).toBe('2026-07-18');
  });

  test('a locale changes the date half and leaves the ISO week alone', () => {
    expect(dayLabel(d, 'de-DE', 'date-week', { year: true })).toContain('· W29');
    expect(dayLabel(d, 'ja-JP', 'week')).toBe('W29');
  });
});
