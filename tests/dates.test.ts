import { isoDate, isoWeekLabel } from '../src/lib/dates';

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
});
