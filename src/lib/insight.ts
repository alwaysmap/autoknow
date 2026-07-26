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

/** WHAT produced this — the discriminant, as FeedKind is for the feed. */
export type InsightSource =
  | 'critical-chain' // chainLedger Situations, live constraints
  | 'resource-load' // one calendar across many programs
  | 'relationship' // partner health / score movement
  | 'ingestion'; // freshness, failures

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

/** The order `severity` sorts in. Private: `compareInsights` is the whole API. */
const SEVERITY_RANK: Record<InsightSeverity, number> = { act: 0, watch: 1, clear: 2 };

/**
 * List order for a mixed set: severity first (the deliberately coarse cross-source
 * rank), then `measure` descending — but ONLY between two insights from the SAME
 * source. Across sources the measures are different units (days, percent, units
 * delayed), and comparing them would silently rebuild `exposure`. Ties return 0,
 * so a producer's own order survives a stable sort.
 */
export function compareInsights(a: Insight, b: Insight): number {
  const bySeverity = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
  if (bySeverity !== 0) return bySeverity;
  if (a.source !== b.source) return 0;
  if (a.symptom.measure === null || b.symptom.measure === null) return 0;
  return b.symptom.measure - a.symptom.measure;
}

/** Narrows a scope to one kind — the union is closed, so this is the read path. */
export function scopeIs<K extends InsightScope['kind']>(
  scope: InsightScope,
  kind: K,
): scope is Extract<InsightScope, { kind: K }> {
  return scope.kind === kind;
}
