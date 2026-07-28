/** @jest-environment node */
// AGENTS.md's compounding lessons are cited BY NUMBER from code comments, tests,
// ADRs and knowledge notes ("AGENTS lesson 9"). A number is a positional id, so
// deleting or reordering a lesson silently re-points every citation at whatever
// slid into that slot — the citation still reads plausibly, which is what makes
// it dangerous. Nothing else would notice.
//
// This came up the first time the list was de-duplicated against the task skills
// (2026-07-22): six lessons were rewritten and the numbering had to be preserved
// by hand. That is the kind of care that works once and then doesn't.
//
// The rule this enforces: rewrite a lesson's TEXT freely; never renumber the
// list. To retire one, leave its number and mark it retired in place.

import { readFileSync } from 'node:fs';
import { citingFiles } from './helpers/citations';

const AGENTS = 'AGENTS.md';

/** The numbers actually defined by the lessons list. */
const defined = (): number[] => {
  // Bounded at the next heading, not at EOF: anything appended to AGENTS.md below this
  // section — a managed block from another tool, say — otherwise contributes its own
  // numbered list and reads as a renumbering of the lessons (2026-07-26, beads adoption).
  const after = readFileSync(AGENTS, 'utf8').split('# Compounding lessons')[1] ?? '';
  const body = after.split(/^#{1,6} /m)[0];
  return [...body.matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
};

describe('AGENTS.md compounding lessons', () => {
  it('numbers the list contiguously from 1 — a gap means a citation now points at nothing', () => {
    const nums = defined();
    expect(nums.length).toBeGreaterThan(0);
    expect(nums).toEqual(Array.from({ length: nums.length }, (_, i) => i + 1));
  });

  it('resolves every "AGENTS lesson N" citation in the repo', () => {
    const known = new Set(defined());
    const broken: string[] = [];
    for (const f of citingFiles()) {
      for (const m of readFileSync(f, 'utf8').matchAll(/AGENTS lesson (\d+)/g)) {
        if (!known.has(Number(m[1]))) broken.push(`${f} → lesson ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
