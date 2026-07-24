// Shared readers for the CSS-text ratchets (pageGutter, focusRing, …). Each of
// those tests walks the stylesheets and has to decide what counts as code rather
// than commentary; three hand-rolled copies of that had already accumulated
// (AGENTS lesson 7), so the walking and the comment handling live here. Rule
// PARSING deliberately does not: each ratchet needs a different cut (all rules,
// the rule at an offset, every brace block with its line) and one accessor
// serving all three would fit none of them.
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
