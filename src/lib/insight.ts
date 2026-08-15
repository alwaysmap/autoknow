import type { StringKey } from './i18n';

// The one shape for "here is something derived that is worth your attention" —
// what lib/feed's FeedItem is for activity, and deliberately NOT the same type:
// an activity is something that HAPPENED, an insight is something derived about
// NOW. Same trick though: a stable envelope (id / source / scope / severity /
// href) plus structured fields, so a new finding is a producer rather than a
// fourth hand-rolled row type with its own ranking scalar and its own way of
// saying "nothing to report".
//
// Nothing here produces prose. `symptom` and `action` carry i18n KEYS and their
// {var} values; the renderer calls lib/i18n's t(). That is what lets a list of
// these be sorted, filtered and built server-side — the reason the /ecosystem
// "Consider:" line cannot be today (it builds React nodes at render time).
//
// ADR an-insight-separates-symptom-from-action carries the decision and the
// rejected alternatives. SHAPE ONLY: no producers live here yet, by design —
// a shape validated by one caller is a guess, so the first callers (#148, #140)
// bring their own mapping and this file stays a contract.

/**
 * WHAT produced this — the discriminant, as FeedKind is for the feed. Declared as
 * an ordered array because `compareInsights` GROUPS by this order and derives
 * `SOURCE_RANK` from it; a union written separately would let the two disagree.
 */
export const INSIGHT_SOURCES = [
  'critical-chain', // chainLedger Situations, live constraints
  'resource-load', // one calendar across many programs
  'relationship', // partner health / score movement
  'ingestion', // freshness, failures
] as const;

export type InsightSource = (typeof INSIGHT_SOURCES)[number];

/** WHO/WHAT it is about, so one list can be filtered or rolled up. */
export type InsightScope =
  | { kind: 'ecosystem' }
  | { kind: 'program'; id: number; name: string }
  | { kind: 'partner'; id: number; name: string }
  | { kind: 'person'; id: number; name: string }
  | { kind: 'phase'; id: number; name: string; programId: number };

/**
 * How far to trust the number in `symptom.measure`. Not decoration: `overPct`
 * derives from a typed-in `forecastedDuration`, so "40% over" is over a GUESS.
 * A surface that cannot tell these apart presents a measurement and an opinion
 * in the same ink. `asserted` = a human said so.
 */
export type InsightBasis = 'measured' | 'estimated' | 'asserted';

/**
 * Ordering across mixed sources — an enum, not a score. `BusiestRow.exposure` is
 * `days × units`: two incommensurate units multiplied into a number no reader
 * can interpret. A cross-source numeric rank would be that mistake at portfolio
 * scale. Declared in the order it sorts.
 */
export type InsightSeverity = 'act' | 'watch' | 'clear';

/** Localizable text: a catalog key plus its {var} values — never a built sentence. */
export interface InsightText {
  key: StringKey;
  values?: Record<string, string | number>;
}

/**
 * WHAT IS OBSERVED. `measure` is the one number this insight ranks on WITHIN its
 * source; it is required-and-nullable rather than optional so a producer with no
 * number has to say so, and `basis` sits beside it so the number cannot travel
 * without it.
 */
export interface InsightSymptom extends InsightText {
  measure: number | null;
  basis: InsightBasis;
}

export interface Insight {
  /** Stable within a list, e.g. "chain:overrun:phase-91". */
  id: string;
  source: InsightSource;
  scope: InsightScope;
  symptom: InsightSymptom;

  /**
   * WHAT TO DO — `null` is a first-class answer, not a gap to fill. "We don't
   * know, but this is worth your attention" beats a confident recommendation the
   * data cannot carry; BusiestResources already returns null rather than
   * inventing advice, and this keeps that legal everywhere.
   */
  action: InsightText | null;

  /**
   * SINCE WHEN — ISO, or `null` when genuinely unknown. Required-and-nullable on
   * purpose: optional would give "I don't know" and "I forgot" the same spelling,
   * and the fabricated start date is exactly the failure this field exists to
   * prevent. Do not derive one from a first-seen timestamp.
   */
  since: string | null;

  severity: InsightSeverity;

  /** Where the reader goes to do something about it. */
  href: string;
}

/** The order `severity` sorts in. Exported because a surface that groups insights by
 *  something else FIRST (the constraint panel sorts by severity, then by how many SOPs a
 *  phase gates) still has to agree with `compareInsights` about which severity is worse. */
export const INSIGHT_SEVERITY_RANK: Record<InsightSeverity, number> = { act: 0, watch: 1, clear: 2 };
const SEVERITY_RANK = INSIGHT_SEVERITY_RANK;

/**
 * The order sources GROUP in. Derived from `INSIGHT_SOURCES` rather than written
 * out again, so the order is a fact one array states, not a coupling between two
 * lists that a reader has to keep true by hand (`lib/relationship`'s REL_SCORES →
 * RelScore is the same move). A grouping is NOT a claim that a chain insight
 * outranks a load one; it exists because the alternative is worse — see below.
 */
const SOURCE_RANK: Record<InsightSource, number> = Object.fromEntries(
  INSIGHT_SOURCES.map((s, i) => [s, i]),
) as Record<InsightSource, number>;

/**
 * List order for a mixed set: severity, then source, then `measure` descending —
 * and `measure` is compared ONLY within one source. Across sources the measures
 * are different units (days, percent, units delayed), so comparing them would
 * silently rebuild `exposure`.
 *
 * Sources must GROUP rather than tie, because a comparator that returns 0 across
 * sources is INTRANSITIVE: with cc(5), rl(99), cc(10) all at `act`, cc≡rl and
 * rl≡cc hold while cc(10)<cc(5) does not, so `Array.sort` is free to emit cc(5)
 * before cc(10) — measure ascending, the one thing this function promises never
 * happens. It did, for the input order [cc(5), rl(99), cc(10)]. Grouping first
 * makes the order total, so the promise holds for every permutation.
 */
export function compareInsights(a: Insight, b: Insight): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  const bySource = SOURCE_RANK[a.source] - SOURCE_RANK[b.source];
  if (bySource !== 0) return bySource;
  // A measureless insight has nothing to rank ON, so it sorts to the END of its
  // severity+source group. NOT a tie: `null ≡ 5`, `null ≡ 10`, `10 < 5` is the
  // same intransitivity one level down, and it reordered [5, null, 10] into
  // 5-before-10 exactly as the cross-source tie did. Every branch of this
  // function has to be total, not just the one that was caught first.
  if (a.symptom.measure === null) return b.symptom.measure === null ? 0 : 1;
  if (b.symptom.measure === null) return -1;
  return b.symptom.measure - a.symptom.measure;
}
