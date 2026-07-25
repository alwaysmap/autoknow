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

import { readFileSync } from 'node:fs';
import { sourceFiles, stripComments } from './helpers/sourceFiles';

// Domain nouns that appeared in the fabricated panel — partner/program names from
// `src/lib/seed.ts` and phase names from `src/lib/builtinTemplates.ts`. NOT "everything
// in the seed": every entry is a value a rendered component must receive as data and
// must never assert for itself. When the seed gains a partner worth guarding, add it
// here — entries are literal text and are escaped before matching.
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

/** Entries are literal text, so anything regex-special in them must be escaped. */
const escapeForRegex = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const scannedFiles = (dir: string): string[] => sourceFiles(dir).filter((f) => !EXEMPT.test(f));

/** Comments come off via the shared stripper; import lines come off here, because only
 *  THIS scan cares about them — an import may legitimately name anything. (The sibling
 *  scan in dataTableConvention deliberately keeps them.) */
const code = (file: string): string =>
  stripComments(readFileSync(file, 'utf8'))
    .split('\n')
    .filter((l) => !/^\s*(import|export .* from)/.test(l))
    .join('\n');

describe('no seed entity name is hard-coded into a rendered surface (#129)', () => {
  it('finds none in src/app or src/components', () => {
    const hits: string[] = [];
    for (const root of ROOTS) {
      for (const file of scannedFiles(root)) {
        const body = code(file);
        for (const name of SEED_ENTITIES) {
          // Quoted or as JSX text — both are the component asserting the value itself.
          // \b at each end so "Ford" does not trip on "Bradford".
          if (new RegExp(`['"\`>][^'"\`<>]*\\b${escapeForRegex(name)}\\b`).test(body)) {
            hits.push(`${file} → "${name}"`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
