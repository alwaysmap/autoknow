/** @jest-environment node */
// Source-scan ratchet on the ONE asymmetry autoknow-679 and autoknow-9l4 kept finding:
// an action file that has adopted `parseForm` and then reads the same FormData by hand
// somewhere else in itself. Two philosophies about who owns shape, in one file.
//
// It is worth a rule rather than a review habit because the two halves look identical at
// a glance and the difference is invisible until something writes a value the schema
// would have refused (AGENTS lesson 2, and lesson 7 — the same bug in a second file in a
// different disguise). Every instance found so far was real:
//
//   • `addPhasePartner` hand-rolled three ids its person twin parsed — autoknow-679.
//   • `updatePhaseHill` hand-rolled a percentage its program twin BOUNDED to 0..100,
//     so 150 was writable and drew a dot off the end of the scale — autoknow-9l4.
//   • `updateProjectMetrics` wrote the same ProjectState row as `updateNeedleStatus`
//     with unbounded progress and unvalidated notes — autoknow-9l4.
//
// The rule is deliberately blunt: in a file that uses `parseForm`, ANY `formData.get` is
// a violation. Nothing subtler survives contact — `parseInt(formData.get(x))` and
// `const s = formData.get(x) as string; parseInt(s)` are the same defect two lines apart,
// and a regex that only catches the first reports success on the second (the truncation
// trap tests/dataTableConvention.test.ts documents). A file that has not adopted
// `parseForm` at all is out of scope here: that is a different judgement — see the
// "leave alone" list on autoknow-9l4, which argues each one — and this scan makes no
// claim about it.

import { readFileSync } from 'node:fs';
import { sourceFiles, stripComments } from './helpers/sourceFiles';

/**
 * Files that still hold both philosophies, each with the bead that resolves it. This
 * list only ever SHRINKS: it is the debt the rule was written against, not a set of
 * permanent exemptions, and a new entry needs a bead of its own.
 */
const KNOWN_MIXED: Record<string, string> = {
  'src/app/actions/phasePartners.ts': 'autoknow-1tm — the REMOVE half still hand-parses; its projectId reaches revalidatePath unvalidated',
  'src/app/actions/phasePeople.ts': 'autoknow-1tm — the same remove half, in the mirror file',
  'src/app/actions/hill.ts': 'autoknow-iwb — setPhaseStarted still hand-parses, beside the converted updatePhaseHill',
  'src/app/programs/[id]/actions.ts': 'autoknow-iwb — archive/delete/addPhase/deletePhase, beside two converted neighbours',
};

/** Both philosophies in one file — NOT "hand-parses", which is a different and much
 *  larger set this scan says nothing about. A file with no `parseForm` at all is
 *  uniformly hand-rolled, which is a judgement call rather than a contradiction. */
const holdsBothPhilosophies = (file: string): boolean => {
  const code = stripComments(readFileSync(file, 'utf8'));
  return code.includes('parseForm(') && code.includes('formData.get(');
};

// `.ts` AND `.tsx` under src/app. A server action is defined by `'use server'`, not by its
// directory or its extension — `createProject` is inline in `programs/new/page.tsx` — so a
// walk that filtered to `.ts` would carry a blind spot exactly where the next instance is
// most likely to appear. No `.tsx` file uses `parseForm` today, which is why widening the
// corpus adds no entries below and costs nothing.
const appModules = sourceFiles('src/app');

describe('a file that uses parseForm does not also read the form by hand', () => {
  it('finds modules to scan at all', () => {
    // A scan whose corpus is empty passes vacuously and pins nothing — assert the walk
    // works before believing anything it reports.
    expect(appModules.some((f) => f.includes('actions'))).toBe(true);
    expect(appModules.some((f) => f.endsWith('.tsx'))).toBe(true);
    expect(appModules.length).toBeGreaterThan(5);
  });

  // EQUALITY, not containment, which is what makes the list a ratchet in both directions:
  // a newly mixed file shows up on the left, and a file whose bead landed without deleting
  // its line here drops off the left. Without the second half a stale exemption would sit
  // there forever and the next regression in that file would pass.
  it('has no mixed file outside the tracked list, and no stale entry in it', () => {
    const mixed = appModules.filter(holdsBothPhilosophies).sort();
    expect(mixed).toEqual(Object.keys(KNOWN_MIXED).sort());
  });
});
