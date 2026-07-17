import { parseHealth, type Health } from './health';
import type { StringKey } from './i18n';

// Partner relationship health — a discrete 7-point scale, NOT a needle. A needle is a
// progress metaphor; a relationship has no "percent done". The scale is deliberately
// colorless: relative health across partners is read by POSITION on a common axis
// (aligned 1..7 tracks stack into a comparable column), not by hue.
//
// 1 = critical, 7 = exemplary. Stored per update on PartnerState.relationshipScore;
// theNeedle stays derived-in-sync (scoreToHealth) so the activity feed and any
// health-based filtering keep working, and legacy rows without a score derive one
// from their stored health (deriveScore).

export const REL_MIN = 1;
export const REL_MAX = 7;
export const REL_SCORES = [1, 2, 3, 4, 5, 6, 7] as const;
export type RelScore = (typeof REL_SCORES)[number];

export function clampScore(n: number): RelScore {
  const r = Math.round(n);
  return Math.max(REL_MIN, Math.min(REL_MAX, r)) as RelScore;
}

export function parseScore(v: string | number | null | undefined): RelScore | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  return clampScore(n);
}

// Display-only localization; one descriptor per point (EN values are the canon).
export const REL_KEY: Record<RelScore, StringKey> = {
  1: 'relScore1',
  2: 'relScore2',
  3: 'relScore3',
  4: 'relScore4',
  5: 'relScore5',
  6: 'relScore6',
  7: 'relScore7',
};

/** Health derived from a score — keeps theNeedle/feed/filters coherent. */
export function scoreToHealth(score: number): Health {
  const s = clampScore(score);
  if (s >= 6) return 'On Track';
  if (s >= 3) return 'Some Risk';
  return 'Concerned';
}

/** Score for a state row: the stored score, else one derived from legacy health. */
export function deriveScore(state: { relationshipScore?: number | null; theNeedle?: string | null } | null | undefined): RelScore {
  if (!state) return 4;
  const stored = parseScore(state.relationshipScore);
  if (stored !== null) return stored;
  const h = parseHealth(state.theNeedle);
  return h === 'On Track' ? 6 : h === 'Some Risk' ? 4 : 2;
}
