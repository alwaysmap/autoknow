/** @jest-environment node */
// AGENTS lesson 5: never render a faked result. The expensive instance (#129) was a
// panel headed "Flow constraint diagnosis" whose five phase names and day counts were
// typed into JSX — seed-flavoured prose that never changed when the data did, sitting
// under a heading that claims measurement.
//
// That is how fabricated panels get built: someone types the demo data they are looking
// at into the component to see the layout, and it ships. The cheap mechanical tell is
// the SEED ENTITY NAMES, because a real render gets those from the database and only a
// hard-coded one has them in the source. This ratchet is the guard that ships with the
// rule (AGENTS lesson 2) — it would have caught the panel on the day it was written.
//
// It does NOT try to detect fabrication in general (undecidable). It catches this one
// disguise, which is the one that actually happened, twice.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Names that only exist as seeded/demo data. A real component receives these as props.
// Deliberately narrow: every entry is a value a component must never assert for itself.
const SEED_ENTITIES = [
  'Ford', 'Bosch', 'Evos', 'VHAL', 'Audio HAL', 'BSP & Power-on',
  'Compliance Testing', 'Car Service Integration', 'Ultifi', 'Ioniq',
];

const ROOTS = ['src/app', 'src/components'];
// Authored content that legitimately contains domain nouns:
//   builtinTemplates — the phase library itself
//   i18n.ts         — the translation table
//   admin/page.tsx  — example curl payloads in a docs block, framed as examples and
//                     never presented as readings (#129 adjudicated these as clean).
// The /admin exemption is per-FILE, so a genuine fabrication added to that page would
// not be caught. Accepted: it is an internal ops page whose job is showing API examples.
const EXEMPT = /builtinTemplates|i18n\.ts|app\/admin\/page\.tsx/;

const sourceFiles = (dir: string): string[] => {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(full) && !EXEMPT.test(full)) out.push(full);
  }
  return out;
};

/** Source with comments and import lines removed — those may name anything. */
const code = (file: string): string =>
  readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(\/\/|import|export .* from)/.test(l))
    .join('\n');

describe('no seed entity name is hard-coded into a rendered surface (#129)', () => {
  it('finds none in src/app or src/components', () => {
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const body = code(file);
        for (const name of SEED_ENTITIES) {
          // Quoted or as JSX text — both are the component asserting the value itself.
          if (new RegExp(`['"\`>][^'"\`<>]*\\b${name.replace(/[&]/g, '\\$&')}\\b`).test(body)) {
            hits.push(`${file} → "${name}"`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
