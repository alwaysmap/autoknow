// Initiative derivations (gh-286 part c): how a member partner's copy reads as
// progress toward the initiative, and how members roll up. Pure functions over the
// same authorities every program surface uses — deriveProgramStatus for "done",
// sopBufferCategory for the dated on-track/at-risk call — so an initiative row can
// never disagree with the copy's own page about the same fact (ADR: a summary count
// uses the threshold of the detail it summarizes).

import { deriveProgramStatus } from './lifecycle';
import { sopBufferCategory, isSopFlagged, type SopBufferProgram } from './sop';

/**
 * One member's reading. `complete`/`on-track`/`at-risk`/`no-date` are the four states
 * the initiative surfaces show; `inactive` is the honest answer for a copy that is
 * cancelled or archived (a removed member's history, or an archived copy) — callers
 * showing ACTIVE membership filter those out rather than this function lying about them.
 */
export type MemberStatus = 'complete' | 'on-track' | 'at-risk' | 'no-date' | 'inactive';

/** Workflow completion, 0–100: the mean of the phases' latest hill positions. The
 *  initiative's key criterion is completing the workflow, so every phase weighs the
 *  same — duration-weighting would re-introduce schedule math into a completion number. */
export function copyCompletion(phaseProgresses: number[]): number {
  if (phaseProgresses.length === 0) return 0;
  return Math.round(phaseProgresses.reduce((a, b) => a + b, 0) / phaseProgresses.length);
}

export function memberStatus(copy: SopBufferProgram, now: number): MemberStatus {
  const status = deriveProgramStatus(copy);
  if (status === 'Done') return 'complete';
  if (status !== 'Active') return 'inactive';
  const category = sopBufferCategory(copy, now);
  if (category === 'nosop') return 'no-date';
  // `na` is unreachable here (status is Active), but the type demands the row: fall
  // through to the flagged test, which treats it as not flagged → on-track is wrong
  // for a value that cannot occur, so guard explicitly.
  if (category === 'na') return 'inactive';
  // The SAME constant the SOP tile and /programs filter read: flagged = at risk.
  return isSopFlagged(category) ? 'at-risk' : 'on-track';
}

export interface InitiativeRollup {
  complete: number;
  onTrack: number;
  atRisk: number;
  noDate: number;
  /** Active-membership rows only — equals the member list the surface renders. */
  total: number;
}

/** Distribution over the members a surface shows. `inactive` copies are the caller's
 *  responsibility to exclude (they are not members' current work); passing one throws
 *  rather than silently miscounting — a rollup that disagrees with its list is the
 *  defect the summary-count ADR exists to prevent. */
export function initiativeRollup(statuses: MemberStatus[]): InitiativeRollup {
  const rollup: InitiativeRollup = { complete: 0, onTrack: 0, atRisk: 0, noDate: 0, total: statuses.length };
  for (const s of statuses) {
    if (s === 'complete') rollup.complete++;
    else if (s === 'on-track') rollup.onTrack++;
    else if (s === 'at-risk') rollup.atRisk++;
    else if (s === 'no-date') rollup.noDate++;
    else throw new Error("initiativeRollup: 'inactive' copies must be filtered out by the caller");
  }
  return rollup;
}
