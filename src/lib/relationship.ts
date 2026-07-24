import { parseHealth, type Health } from './health';
import type { StringKey } from './i18n';

// Partner relationship health — a discrete 5-point scale, NOT a needle. A needle is a
// progress metaphor; a relationship has no "percent done". The scale is deliberately
// colorless: valence is carried by the pain-scale face and position, not hue.
//
// 1 = critical, 5 = exemplary. Stored per update on PartnerState.relationshipScore;
// theNeedle stays derived-in-sync (scoreToHealth) so the activity feed and any
// health-based filtering keep working. Historical rows from the brief 7-point era
// (values 6/7) and health-only legacy rows both derive a sensible 1..5 score.

export const REL_MIN = 1;
export const REL_MAX = 5;
export const REL_SCORES = [1, 2, 3, 4, 5] as const;
export type RelScore = (typeof REL_SCORES)[number];

export function clampScore(n: number): RelScore {
  const r = Math.round(n);
  return Math.max(REL_MIN, Math.min(REL_MAX, r)) as RelScore;
}

export function parseScore(v: string | number | null | undefined): RelScore | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(v, 10);
  if (Number.isNaN(n)) return null;
  // 7-point-era rows: 6 was "Strong" (new 4), 7 "Exemplary" (new 5).
  if (n === 6) return 4;
  if (n >= 7) return 5;
  return clampScore(n);
}

// Display-only localization; one descriptor per point (EN values are the canon).
export const REL_KEY: Record<RelScore, StringKey> = {
  1: 'relScore1',
  2: 'relScore2',
  3: 'relScore3',
  4: 'relScore4',
  5: 'relScore5',
};

/** Health derived from a score — keeps theNeedle/feed/filters coherent. */
export function scoreToHealth(score: number): Health {
  const s = parseScore(score) ?? 3;
  if (s >= 4) return 'On Track';
  if (s >= 2) return 'Some Risk';
  return 'Concerned';
}

export interface RelMixBucket {
  score: RelScore;
  count: number;
  /** Share of RATED relationships, 0..1. */
  share: number;
}

/**
 * Where the partner book sits on the 1..5 scale — the input to the ecosystem
 * relationship-mix bar. Every point gets a bucket (zero-count included) so the bar
 * always has the same five slots in the same order; position, not hue, is the
 * reading. Unrated partners are excluded from the denominator — "no reading yet" is
 * not a health class — and returned separately so the tile can own up to them.
 */
export function relationshipMix(scores: (string | number | null | undefined)[]): {
  buckets: RelMixBucket[];
  rated: number;
  unrated: number;
} {
  const counts: Record<RelScore, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let unrated = 0;
  for (const raw of scores) {
    const s = parseScore(raw);
    if (s === null) {
      unrated += 1;
      continue;
    }
    counts[s] += 1;
  }
  const rated = REL_SCORES.reduce((n, s) => n + counts[s], 0);
  const buckets = REL_SCORES.map((score) => ({
    score,
    count: counts[score],
    share: rated === 0 ? 0 : counts[score] / rated,
  }));
  return { buckets, rated, unrated };
}

/**
 * Score for a state row: the stored score, else one derived from legacy health.
 *
 * Takes a row, never `null`. It used to accept one and answer `3` — a mid-scale
 * reading indistinguishable from a partner deliberately rated 3, for a partner that
 * has no reading at all (#129). Every caller already guarded (`state ? deriveScore(state)
 * : null`), so that branch was a fabrication waiting for the first caller who forgot;
 * the type now makes it unrepresentable. `relationshipMix` in this file is the model —
 * it returns `unrated` separately, because no reading yet is not a health class.
 */
export function deriveScore(state: { relationshipScore?: number | null; theNeedle?: string | null }): RelScore {
  const stored = parseScore(state.relationshipScore);
  if (stored !== null) return stored;
  const h = parseHealth(state.theNeedle);
  return h === 'On Track' ? 4 : h === 'Some Risk' ? 3 : 2;
}
