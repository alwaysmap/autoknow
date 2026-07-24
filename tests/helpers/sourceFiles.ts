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
