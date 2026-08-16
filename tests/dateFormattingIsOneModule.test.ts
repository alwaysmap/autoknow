// ONE place turns a date into text, and it is `src/lib/dates.ts`.
//
// A prose rule would not have held: before this test there were seven other formatting
// sites, and two of them (`monthLong` in ChainSchedule and in ChainLedger) were
// byte-identical copies that existed only because the second author could not see the
// first. That is the shape of the failure this guards — not one wrong date, but two
// surfaces free to drift into writing the same value differently, or one of them
// forgetting the UTC pin and hydrating to a different day than the server rendered
// (AGENTS lesson 2: enforce it in software, and lesson 7: fix the pattern, not the
// instance).
//
// The rule is checked two ways, because either alone is easy to satisfy vacuously:
// nothing outside the module may CALL Intl's date APIs, and the module may not EXPORT the
// raw options-taking helper that would let a caller do it at one remove.
import { readFileSync } from 'node:fs';
import { sourceFiles, stripComments } from './helpers/sourceFiles';

const DATES = 'src/lib/dates.ts';
const RELATIVE_TIME = 'src/lib/relativeTime.ts';

/**
 * Turning a DATE into text. Two deliberate exclusions, both stated so the next person does
 * not "tighten" the pattern back into a false positive:
 *   • `Intl.RelativeTimeFormat` — a DURATION is not a date, and design.md §6 gives it its
 *     own module for a stated reason (a STAMP answers "is this current", a CELL answers
 *     "when did this happen").
 *   • bare `toLocaleString` — in this codebase that is overwhelmingly Number's, formatting
 *     volumes and counts in a dozen components, and a syntactic scan cannot see the
 *     receiver's type. `Date.prototype.toLocaleString` therefore slips this net; the
 *     non-export of `localDate` below is what closes that gap, since a caller reaching for
 *     it has no options-taking helper to reach for and would have to write the Intl call
 *     out in full, which the first half DOES catch.
 */
const DATE_FORMATTER = /toLocaleDateString|toLocaleTimeString|new Intl\.DateTimeFormat/;

const code = (file: string): string => stripComments(readFileSync(file, 'utf8'));

describe('date formatting lives in exactly one module', () => {
  const all = [...sourceFiles('src/lib'), ...sourceFiles('src/app'), ...sourceFiles('src/components')];

  test('the scan reaches a real corpus', () => {
    // The emptiness guard every source-scan ratchet here owes: a walker pointed at a
    // renamed directory returns [] and passes everything.
    expect(all.length).toBeGreaterThan(100);
    expect(all).toContain(DATES);
  });

  test('nothing outside lib/dates.ts formats a date', () => {
    const offenders = all.filter((f) => f !== DATES && DATE_FORMATTER.test(code(f)));
    expect(offenders).toEqual([]);
  });

  test('lib/dates.ts really does format one — the scan can find what it is looking for', () => {
    // The partner assertion the rule above is worthless without: a pattern that could not
    // match the one legitimate site would pass every other file vacuously.
    expect(DATE_FORMATTER.test(code(DATES))).toBe(true);
  });

  test('the options-taking helper is NOT exported, so a caller cannot format at one remove', () => {
    // This is the half that makes the rule stick. `localDate(value, locale, opts)` takes
    // raw Intl options; exported, it would let any call site invent a shape — which is how
    // six of the seven original offenders were written. Callers get the NAMED functions
    // instead, each of which says what KIND of value it is naming.
    const src = code(DATES);
    expect(src).toMatch(/^function localDate\(/m);
    expect(src).not.toMatch(/^export function localDate\(/m);
    for (const named of ['dayLabel', 'monthLabel', 'dayLabelTitle', 'isoDate', 'isoDateTime', 'isoWeekLabel']) {
      expect(src).toMatch(new RegExp(`^export function ${named}\\(`, 'm'));
    }
  });

  test('relativeTime.ts formats a DURATION and hands the absolute case back', () => {
    // Named explicitly rather than left as a hole in the scan: the exemption is for
    // `Intl.RelativeTimeFormat` only, and the moment that module needs an absolute date it
    // must come back through `dayLabel` rather than growing a formatter of its own.
    const src = code(RELATIVE_TIME);
    expect(src).toContain('Intl.RelativeTimeFormat');
    expect(DATE_FORMATTER.test(src)).toBe(false);
    expect(src).toContain('dayLabel(');
  });
});
