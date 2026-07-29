/** @jest-environment node */
// .env.sample is the template a first checkout copies, and it had silently drifted
// from reality: it documented GOOGLE_SERVICE_ACCOUNT_JSON while the working .env
// used GOOGLE_APPLICATION_CREDENTIALS, and said nothing at all about GOOGLE_SA_EMAIL,
// GOOGLE_SHARE_ADDRESS or AUTH_URL — three variables production genuinely runs on.
// "Copy the sample and fill it in" therefore did not produce a working environment,
// which is a bad first hour for whoever next clones this repo.
//
// Prose cannot hold that line, so this test does (AGENTS lesson 2 — enforce in
// software): every variable the code reads must be documented, and every variable
// documented must be one something reads.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['src', 'scripts', 'tests', 'prisma'];
const CODE_EXT = new Set(['.ts', '.tsx', '.mts', '.js', '.mjs']);

// Injected by the platform, never written into a .env — a stale hand-written value
// is worse than none. NODE_ENV is Next's, CI is GitHub Actions', K_SERVICE is how
// the app knows it is on Cloud Run, GIT_SHA is stamped by the build, and
// TEST_PARALLEL_INDEX / JEST_WORKER_ID are the two runners' per-worker slots: setting
// either by hand would point every worker at one worker's database, which is the exact
// collision the lane suffix exists to prevent.
const PLATFORM_INJECTED = new Set([
  'NODE_ENV', 'CI', 'K_SERVICE', 'GIT_SHA', 'TEST_PARALLEL_INDEX', 'JEST_WORKER_ID',
]);

// Consumed by a dependency rather than by our own `process.env` reads, so the scan
// below cannot see them. Each one still has to be documented, hence this list.
const CONSUMED_BY_LIBRARY = new Set(['AUTH_URL']); // Auth.js reads it directly

const walk = (dir: string): string[] => {
  let out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (CODE_EXT.has(extname(full))) out.push(full);
  }
  return out;
};

// Root-level config files are scanned by LISTING the root, never from a hardcoded
// list: next.config.ts is where NEXT_DIST_DIR is read, and a hand-maintained list
// missed it — a list that must be remembered is the same drift this test exists to
// stop, one level up.
const rootCodeFiles = (): string[] =>
  readdirSync('.').filter((f) => CODE_EXT.has(extname(f)) && statSync(f).isFile());

const envNamesReadByCode = (): Set<string> => {
  const files = [...ROOTS.flatMap((r) => walk(r)), ...rootCodeFiles()];
  const found = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z_][A-Z0-9_]*)/g)) found.add(m[1]);
    for (const m of src.matchAll(/process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]\]/g)) found.add(m[1]);
  }
  return found;
};

// Real assignments only — the commented "never set these" roll-call at the bottom of
// the sample must NOT count as documenting anything.
const envNamesDeclaredInSample = (): Set<string> =>
  new Set(
    readFileSync('.env.sample', 'utf8')
      .split('\n')
      .map((line) => /^([A-Z_][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((n): n is string => !!n),
  );

describe('.env.sample stays true to the code', () => {
  it('documents every variable the code reads', () => {
    const declared = envNamesDeclaredInSample();
    const undocumented = [...envNamesReadByCode()]
      .filter((n) => !PLATFORM_INJECTED.has(n))
      .filter((n) => !declared.has(n))
      .sort();

    expect(undocumented).toEqual([]);
  });

  it('declares nothing the code never reads', () => {
    const read = envNamesReadByCode();
    const stale = [...envNamesDeclaredInSample()]
      .filter((n) => !read.has(n))
      .filter((n) => !CONSUMED_BY_LIBRARY.has(n))
      .sort();

    expect(stale).toEqual([]);
  });

  it('never invites a hand-written value for a platform-injected variable', () => {
    const declared = envNamesDeclaredInSample();
    expect([...PLATFORM_INJECTED].filter((n) => declared.has(n))).toEqual([]);
  });
});
