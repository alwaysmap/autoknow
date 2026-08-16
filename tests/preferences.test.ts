// #31: the preferences registry is the single source of truth for every preference's key,
// default, and validator. This proves each parser falls back to the default on garbage,
// that every key is namespaced, that only locale is a cookie, and — the key guarantee —
// that the pre-paint boot script is built from the SAME keys and default the toggles use,
// so the §8c "the default lives in two places that must agree" landmine can't recur.
import {
  THEME,
  STYLE,
  LOCALE,
  DATE_LABELS,
  TABLE_DATE_LABELS,
  ROWS_PER_TABLE,
  COLLAPSED_SECTIONS,
  ALL_PREFERENCES,
  appearanceBootScript,
} from '../src/lib/preferences';

describe('#31 preferences registry', () => {
  test('every key is namespaced under autoknow-', () => {
    for (const p of ALL_PREFERENCES) expect(p.key).toMatch(/^autoknow-/);
  });

  test('parsers fall back to the default on missing / invalid input', () => {
    expect(THEME.parse(null)).toBe('system');
    expect(THEME.parse('nonsense')).toBe('system');
    expect(THEME.parse('dark')).toBe('dark');
    expect(STYLE.parse(undefined)).toBe('instrument');
    expect(STYLE.parse('standard')).toBe('standard');
    expect(STYLE.parse('x')).toBe('instrument');
    expect(LOCALE.parse('de')).toBe('de');
    expect(LOCALE.parse('zz')).toBe('en');
    expect(DATE_LABELS.parse('week')).toBe('week');
    expect(DATE_LABELS.parse('date-week')).toBe('date-week');
    expect(DATE_LABELS.parse('weekly')).toBe('date'); // a near-miss is not a match
    expect(DATE_LABELS.parse(null)).toBe('date');
    expect(TABLE_DATE_LABELS.parse('week')).toBe('week');
    expect(TABLE_DATE_LABELS.parse(null)).toBe('date');
    expect(ROWS_PER_TABLE.parse('50')).toBe(50);
    expect(ROWS_PER_TABLE.parse('7')).toBe(25);
    expect(ROWS_PER_TABLE.parse(null)).toBe(25);
    expect(COLLAPSED_SECTIONS.parse(null)).toEqual([]);
    expect(COLLAPSED_SECTIONS.parse('')).toBe(COLLAPSED_SECTIONS.default);
    // The stored form is `String(array)` (comma-joined) — writeLocalPref's encoding —
    // so a round-trip must give back the same ids in order.
    expect(COLLAPSED_SECTIONS.parse('programs:chain,partners:activity')).toEqual(['programs:chain', 'partners:activity']);
    expect(COLLAPSED_SECTIONS.parse(String(['programs:chain', 'partners:activity']))).toEqual(['programs:chain', 'partners:activity']);
    // Garbage entries are dropped, not kept: only members of SECTION_IDS survive, so a
    // stored stray (a retired section, an injected string) can never fork the pref.
    expect(COLLAPSED_SECTIONS.parse('programs:chain,<script>,UPPER:case,')).toEqual(['programs:chain']);
    expect(COLLAPSED_SECTIONS.parse('total nonsense')).toBe(COLLAPSED_SECTIONS.default);
  });

  test('each default is itself a valid value', () => {
    for (const p of ALL_PREFERENCES) {
      expect(p.parse(String(p.default))).toBe(p.default);
      if (p.values) expect(p.values as readonly unknown[]).toContain(p.default);
    }
  });

  test('the cookies are exactly the two the SERVER renders from; the rest are client-only', () => {
    // Locale and date labels are cookies for the same reason: the server has to know them
    // to produce the markup. Date labels has a second reason of its own — chart label
    // placement measures the FORMATTED string in JS, so a client-only read would leave the
    // layout pass sizing text the page is not going to show (see the registry entry).
    expect(LOCALE.storage).toBe('cookie');
    expect(DATE_LABELS.storage).toBe('cookie');
    expect(TABLE_DATE_LABELS.storage).toBe('cookie');
    expect(THEME.storage).toBe('local');
    expect(STYLE.storage).toBe('local');
    expect(ROWS_PER_TABLE.storage).toBe('local');
    expect(COLLAPSED_SECTIONS.storage).toBe('local');
  });

  test('the boot script is built from the registry keys + style default (§8c: no drift)', () => {
    const script = appearanceBootScript();
    expect(script).toContain(JSON.stringify(THEME.key));
    expect(script).toContain(JSON.stringify(STYLE.key));
    expect(script).toContain(JSON.stringify(STYLE.default));
    expect(script).toContain('dataset.theme');
    expect(script).toContain('prefers-color-scheme: dark'); // theme default follows the OS
    expect(script).toContain('dataset.style');
    // tiny + dependency-free: an IIFE with a try/catch, no imports / React
    expect(script).toMatch(/^\(function\(\)\{try\{/);
    expect(script).not.toMatch(/\b(import|require|React)\b/);
  });
});

describe('the two date-label preferences are genuinely separate', () => {
  test('they are distinct keys, so a table setting cannot move prose (or the reverse)', () => {
    // The whole point of splitting them. One key with two readers would be a single
    // control wearing two labels in the user menu, which is worse than one control.
    expect(TABLE_DATE_LABELS.key).not.toBe(DATE_LABELS.key);
    expect(ALL_PREFERENCES).toContain(DATE_LABELS);
    expect(ALL_PREFERENCES).toContain(TABLE_DATE_LABELS); // or reset-all leaves one behind
  });

  test('both start at the app default, so the split changes nothing until a reader asks', () => {
    expect(DATE_LABELS.default).toBe('date');
    expect(TABLE_DATE_LABELS.default).toBe('date');
  });

  test('they share one vocabulary — the SAME array and the SAME parser, not equal copies', () => {
    // Identity, not equality. `toEqual` would pass over two literals that happen to match
    // today, which is the copy this test used to police rather than prevent: a fourth mode
    // added to one and not the other would still be `toEqual`-clean for `parse`.
    expect(TABLE_DATE_LABELS.values).toBe(DATE_LABELS.values);
    expect(TABLE_DATE_LABELS.parse).toBe(DATE_LABELS.parse);
  });
});
