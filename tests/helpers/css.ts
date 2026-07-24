// Shared readers for every CSS-text ratchet. Each walks the stylesheets and has
// to decide what counts as code rather than commentary; four hand-rolled copies
// of the comment handling had accumulated (AGENTS lesson 7), so it lives here
// and every ratchet now imports it. Deliberately not listing the callers: a
// roll-call nothing pins is a roll-call that goes stale, which is the same trap
// this file exists to close.
//
// Two things deliberately stay local. Rule PARSING: each ratchet needs a
// different cut — all rules (pageGutter), the rule at an offset (focusRing),
// every brace block with its line (vertical-rhythm) — and one accessor serving
// all three would fit none. And WALKING, for the two that use `globSync`: a
// library call is not a hand-rolled duplicate, so only the readdir-based walkers
// merged into `cssFiles`.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every `.css` file under a directory tree, depth-first. Callers narrow further
 *  (e.g. to `.module.css`) themselves. */
export function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) return cssFiles(p);
    return entry.name.endsWith('.css') ? [p] : [];
  });
}

/** Comments removed. For checks that read VALUES out of a rule body and never
 *  report a position — deleting text shifts every offset after it. */
export const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Comments replaced by spaces of equal length. For scanners that report
 *  `file:line`: prose is neutralised — this repo's comments discuss CSS
 *  declarations at length, and a ratchet must not fire on a sentence ABOUT a
 *  declaration — while every offset still points at the real source. */
export const blankComments = (css: string): string =>
  css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
