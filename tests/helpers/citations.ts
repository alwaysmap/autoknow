// Every file in this repo that could CITE something the repo also OWNS — a knowledge
// note, an ADR, an AGENTS lesson number. Three tests each carried their own copy of
// this walk, and all three had drifted to a different answer: one knew about `.github`
// and `.yml`, one knew about `Dockerfile`, none knew about `.sh`. So the citations that
// PR #226 added in `.github/workflows/ci.yml` and `scripts/ci/disk-guard.sh` were
// unprotected against a rename, which is the single thing these checks exist to stop.
//
// One list, so a widening lands everywhere at once (AGENTS lesson 7 — the same reason
// `./sourceFiles` exists for the component-code ratchets).
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Where citations live. Deliberately a UNION of what the three callers used, not an
 * intersection: a root scanned for one kind of citation and not another is exactly the
 * asymmetry that produced the gap.
 */
const ROOTS = ['docs', 'src', 'tests', 'scripts', '.claude', '.github'];

/**
 * Plus every file sitting at the repo root, which is where the configs live. Named
 * individually until `playwright.config.ts` picked up a knowledge citation and the
 * list did not have it — the same whack-a-mole that produced the original gap, so the
 * root is enumerated instead. `Dockerfile` has no extension and is matched by name.
 */
const rootFiles = (): string[] =>
  readdirSync('.', { withFileTypes: true })
    .filter((e) => e.isFile() && (CITES.test(e.name) || e.name === 'Dockerfile'))
    .map((e) => e.name);

/**
 * Prose, code, workflows and shell — anything that carries a comment or a link.
 * A new file type that can cite something is added HERE, never in a caller; adding
 * it in one caller is how the three lists diverged in the first place.
 */
const CITES = /\.(md|ts|tsx|mjs|js|yml|yaml|sh)$/;

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    return e.isDirectory() ? walk(full) : CITES.test(e.name) ? [full] : [];
  });

/** Every file a citation check should read. */
export const citingFiles = (): string[] => [...ROOTS.filter(existsSync).flatMap(walk), ...rootFiles()];
