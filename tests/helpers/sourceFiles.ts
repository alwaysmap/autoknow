// Shared walker for the source-scan ratchets over COMPONENT code (as opposed to the
// CSS-text ones, which walk stylesheets through `./css`). Hand-rolled copies had
// accumulated across tests/ — AGENTS lesson 7, the same reason `cssFiles` exists — so it
// lives here. Deliberately not listing the callers: a roll-call nothing pins goes stale,
// which is the trap `./css` warns about.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Every `.ts`/`.tsx` file under a directory tree, depth-first. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) return sourceFiles(join(dir, entry.name));
    return /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [];
  });
}

/** The `.tsx` subset — the common narrowing, once, rather than in every caller. */
export const tsxFiles = (dir: string): string[] => sourceFiles(dir).filter((f) => f.endsWith('.tsx'));

/**
 * Source with comments removed — a comment ABOUT a thing is not that thing, and a
 * comment explaining a conversion is exactly what a naive scan trips on.
 *
 * LINE comments go FIRST, and for FULL-LINE comments that ordering is the correctness of
 * this function: one mentioning a glob or a regex carries the characters that OPEN a block
 * comment, so stripping blocks first makes that line swallow the file to the next block
 * terminator, and every scan then passes over source it never saw. Safe in the other
 * direction because a line starting with `//` INSIDE a block comment is being deleted
 * either way. Still open, and not worth solving until something needs it: a TRAILING
 * comment (`const x = 1; // ...`) is not full-line, so this pass leaves it, and one
 * carrying a glob would swallow the file exactly as before. There are none in src today.
 * docs/knowledge/a-line-comment-mentioning-a-glob-swallows-the-rest-of-the-file.md.
 *
 * Sibling of `./css`'s `stripComments`, which handles only block comments because CSS
 * has no `//`. Import from the module that matches what you are scanning.
 */
export const stripComments = (src: string): string =>
  src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
