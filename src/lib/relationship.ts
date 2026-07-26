import { parseHealth, type Health } from './health';
import { t, type Locale, type StringKey } from './i18n';

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

/**
 * The ONE numeric → qualitative-word mapping (#111). A relationship reading is a
 * WORD everywhere a human reads prose — "Steady", never "3/5". The numeral is the
 * axis coordinate the colorless scale is drawn on; it is legible on the face, the
 * picker and the legend, and nowhere else.
 *
 * `null` is its own case ("Not rated") rather than a mid-scale 3: no reading yet is
 * not a health class (#129, the reason `deriveScore` refuses `null`).
 *
 * Every call site goes through here — an inline `t(locale, REL_KEY[score])` ternary
 * repeated per surface is exactly how the six labels drift apart (AGENTS lesson 7).
 */
export function relScoreLabel(locale: Locale, score: RelScore | null): string {
  return score === null ? t(locale, 'relNotRated') : t(locale, REL_KEY[score]);
}

/**
 * The language the AI's EVIDENCE is written in. The model is prompted in English and
 * the stored health strings are English by construction (`i18n.ts`: for health, `en`
 * MUST equal the stored value), so an evidence line asks for the English label
 * explicitly rather than inheriting a viewer's locale — the brief is generated once
 * and read by everyone.
 */
export const EVIDENCE_LOCALE: Locale = 'en';

// ---- Deep-link fragments -------------------------------------------------------
// A partner's health record lives in the DETAIL popover on its partner page — there
// is no standalone page (`/history/partner/:id` was retired 2026-07-20). The popover
// IS a URL, exactly as a phase's is (`lib/phase.ts`), and this family mirrors that
// one: `#relationship-history` opens the log, `#relationship-update-:id` opens it AND
// surfaces one update. The prefix is shared so a reader who knows one can guess the
// other, and neither can match the other's target.
//
// The hash never reaches the server, so resolution is necessarily client-side —
// `RelationshipScale` listens via `subscribeLocationChange` (#40).

/** Opens the partner-health log. */
export const RELATIONSHIP_HISTORY_HASH = 'relationship-history';

/** Opens the log AND surfaces one update, addressed by its `PartnerState.id`. */
export const relUpdateHash = (stateId: number): string => `relationship-update-${stateId}`;

/** `PartnerState.id` out of a `#relationship-update-:id` fragment (with or without
 *  the `#`), or null when the fragment addresses no single update. */
export const parseRelUpdateHash = (hash: string): number | null => {
  const m = /^#?relationship-update-(\d+)$/.exec(hash);
  return m ? parseInt(m[1], 10) : null;
};

/** Does this fragment ask for the partner-health popover at all — the log itself or
 *  one update within it? */
export const isRelationshipHash = (hash: string): boolean =>
  hash === `#${RELATIONSHIP_HISTORY_HASH}` ||
  hash === RELATIONSHIP_HISTORY_HASH ||
  parseRelUpdateHash(hash) !== null;

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
 * Takes a row, NEVER `null` — a partner with no reading has no score, and answering a
 * mid-scale 3 made it indistinguishable from one deliberately rated 3 (#129). Callers
 * pass `state ? deriveScore(state) : null`. `relationshipMix` below is the model: it
 * returns `unrated` separately, because no reading yet is not a health class.
 */
export function deriveScore(state: { relationshipScore?: number | null; theNeedle?: string | null }): RelScore {
  const stored = parseScore(state.relationshipScore);
  if (stored !== null) return stored;
  const h = parseHealth(state.theNeedle);
  return h === 'On Track' ? 4 : h === 'Some Risk' ? 3 : 2;
}
