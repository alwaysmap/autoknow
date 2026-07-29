/** @jest-environment node */
// #171 — pure bucket/format math, pinned to an exact `now` so nothing here depends on
// the wall clock. The React half (the hydration-safe swap, the shared ticker) is
// exercised by tests/relativeTimeComponent.test.tsx; this file is the arithmetic a
// freshness stamp's "is this current?" answer stands on.
import { bucketRelativeTime, relativeTimeText, CROSSOVER_DAYS } from '../src/lib/relativeTime';

const NOW = new Date('2026-07-26T12:00:00.000Z').getTime();
const minutesAgo = (n: number) => new Date(NOW - n * 60_000).toISOString();
const hoursAgo = (n: number) => new Date(NOW - n * 3_600_000).toISOString();
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe('bucketRelativeTime', () => {
  it('calls anything under a minute "just now"', () => {
    expect(bucketRelativeTime(new Date(NOW).toISOString(), NOW)).toEqual({ isAbsolute: false, isJustNow: true });
    expect(bucketRelativeTime(minutesAgo(0.5), NOW)).toEqual({ isAbsolute: false, isJustNow: true });
  });

  it('phrases future instants too — a briefing a few seconds ahead of clock skew', () => {
    const future = new Date(NOW + 5 * 60_000).toISOString();
    const b = bucketRelativeTime(future, NOW);
    expect(b).toMatchObject({ isAbsolute: false, isJustNow: false, unit: 'minute' });
    expect(b.value).toBeGreaterThan(0);
  });

  it('buckets minutes under an hour', () => {
    expect(bucketRelativeTime(minutesAgo(20), NOW)).toEqual({ isAbsolute: false, isJustNow: false, unit: 'minute', value: -20 });
    expect(bucketRelativeTime(minutesAgo(59), NOW)).toMatchObject({ unit: 'minute' });
  });

  it('buckets hours under a day', () => {
    expect(bucketRelativeTime(hoursAgo(3), NOW)).toEqual({ isAbsolute: false, isJustNow: false, unit: 'hour', value: -3 });
    expect(bucketRelativeTime(hoursAgo(23), NOW)).toMatchObject({ unit: 'hour' });
  });

  it('buckets days up to the crossover', () => {
    expect(bucketRelativeTime(daysAgo(1), NOW)).toEqual({ isAbsolute: false, isJustNow: false, unit: 'day', value: -1 });
    expect(bucketRelativeTime(daysAgo(CROSSOVER_DAYS - 1), NOW)).toMatchObject({ unit: 'day' });
  });

  it('falls back to absolute at and past the 30-day crossover', () => {
    expect(bucketRelativeTime(daysAgo(CROSSOVER_DAYS), NOW)).toEqual({ isAbsolute: true, isJustNow: false });
    expect(bucketRelativeTime(daysAgo(90), NOW)).toEqual({ isAbsolute: true, isJustNow: false });
  });

  it('is symmetric around the boundary — 29d59m59s is still relative, 30d0m0s is not', () => {
    const justUnder = new Date(NOW - (CROSSOVER_DAYS * 86_400_000 - 1000)).toISOString();
    expect(bucketRelativeTime(justUnder, NOW).isAbsolute).toBe(false);
    const exactly = new Date(NOW - CROSSOVER_DAYS * 86_400_000).toISOString();
    expect(bucketRelativeTime(exactly, NOW).isAbsolute).toBe(true);
  });
});

describe('relativeTimeText', () => {
  const JUST_NOW = 'just now';

  it('renders "just now" for a fresh instant', () => {
    expect(relativeTimeText(new Date(NOW).toISOString(), NOW, 'en', JUST_NOW)).toBe(JUST_NOW);
  });

  it('renders Intl.RelativeTimeFormat text inside the crossover', () => {
    expect(relativeTimeText(minutesAgo(20), NOW, 'en', JUST_NOW)).toBe('20 minutes ago');
    expect(relativeTimeText(hoursAgo(3), NOW, 'en', JUST_NOW)).toBe('3 hours ago');
    expect(relativeTimeText(daysAgo(5), NOW, 'en', JUST_NOW)).toBe('5 days ago');
  });

  it('renders a locale-short absolute date past the crossover, not a duration', () => {
    const text = relativeTimeText(daysAgo(90), NOW, 'en', JUST_NOW);
    expect(text).not.toMatch(/ago/);
    expect(text).toMatch(/\d{4}/); // carries the year, unlike the in-crossover form
  });

  it('formats in the caller\'s locale', () => {
    expect(relativeTimeText(minutesAgo(20), NOW, 'de', JUST_NOW)).toContain('vor');
    expect(relativeTimeText(hoursAgo(3), NOW, 'ja', JUST_NOW)).toMatch(/前/);
  });
});
