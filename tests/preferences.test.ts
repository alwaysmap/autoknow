// #31: the preferences registry is the single source of truth for every preference's key,
// default, and validator. This proves each parser falls back to the default on garbage,
// that every key is namespaced, that only locale is a cookie, and — the key guarantee —
// that the pre-paint boot script is built from the SAME keys and default the toggles use,
// so the §8c "the default lives in two places that must agree" landmine can't recur.
import {
  THEME,
  STYLE,
  LOCALE,
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
    expect(ROWS_PER_TABLE.parse('50')).toBe(50);
    expect(ROWS_PER_TABLE.parse('7')).toBe(25);
    expect(ROWS_PER_TABLE.parse(null)).toBe(25);
    expect(COLLAPSED_SECTIONS.parse(null)).toEqual([]);
    expect(COLLAPSED_SECTIONS.parse('')).toBe(COLLAPSED_SECTIONS.default);
    // The stored form is `String(array)` (comma-joined) — writeLocalPref's encoding —
    // so a round-trip must give back the same ids in order.
    expect(COLLAPSED_SECTIONS.parse('programs:chain,partners:activity')).toEqual(['programs:chain', 'partners:activity']);
    expect(COLLAPSED_SECTIONS.parse(String(['programs:chain', 'partners:activity']))).toEqual(['programs:chain', 'partners:activity']);
    // Garbage entries are dropped, not kept: ids follow the `page:section` grammar.
    expect(COLLAPSED_SECTIONS.parse('programs:chain,<script>,UPPER:case,')).toEqual(['programs:chain']);
    expect(COLLAPSED_SECTIONS.parse('total nonsense')).toBe(COLLAPSED_SECTIONS.default);
  });

  test('each default is itself a valid value', () => {
    for (const p of ALL_PREFERENCES) {
      expect(p.parse(String(p.default))).toBe(p.default);
      if (p.values) expect(p.values as readonly unknown[]).toContain(p.default);
    }
  });

  test('only locale is a cookie (the server reads it for SSR); the rest are client-only', () => {
    expect(LOCALE.storage).toBe('cookie');
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
