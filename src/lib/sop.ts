// SOP-target math — pure and client-safe. Every program must carry a target SOP
// (month + year minimum; we assume the LAST DAY of that month). Combined with the
// notional remaining phase weeks (the critical chain), this is THE on-track signal,
// and it drives the ecosystem capacity chart: when units come online, with/without GAS.

import { deriveProgramStatus } from './lifecycle';

export const DAY_MS = 86_400_000;

/** The UTC midnight starting the day `ms` falls in — the day key every per-day
 *  series and lookup agrees on, so a point and the summary for it cannot land on
 *  different days. Lives beside DAY_MS because it is the same unit's identity. */
export const dayFloor = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

/** "2027-03" (a <input type="month"> value) → the last day of that month (UTC). */
export function monthEndDate(yyyyMm: string): Date {
  const m = /^(\d{4})-(\d{2})$/.exec(yyyyMm);
  if (!m) throw new Error(`Not a yyyy-MM month: ${yyyyMm}`);
  // Day 0 of the NEXT month is the last day of this one.
  return new Date(Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10), 0));
}

/** Normalize a form value to a stored SOP date: yyyy-MM → month end; yyyy-MM-dd kept. */
export function parseSopInput(value: string): Date | null {
  const v = value.trim();
  if (!v) return null;
  if (/^\d{4}-\d{2}$/.test(v)) return monthEndDate(v);
  const d = new Date(`${v}T00:00:00Z`);
  return isNaN(+d) ? null : d;
}

export interface SopOutlook {
  forecastFinishMs: number; // now + remaining chain work
  bufferDays: number; // positive = finishes before SOP, negative = late
  onTrack: boolean;
}

/**
 * THE four-way reading of a forecast finish against a target SOP, and the ONE place
 * those four questions are asked. Every SOP-health surface derives from it — the
 * program header's ink, the /programs column, the ecosystem tile, the at-risk tables —
 * because they had drifted into two branch sets that disagreed: the header said "Some
 * Risk" for a thin buffer while the tile counted the same program on track, its only
 * test being `buffer < 0`
 * ([ADR](../../docs/adr/2026-08-03-a-summary-count-uses-the-threshold-of-the-detail-it-summarizes.md),
 * AGENTS lesson 7).
 *
 *   blown   — the buffer is gone AND the SOP date has already passed. Not a forecast
 *             any more: a fact about a date nobody hit.
 *   late    — the buffer is gone but the SOP is still ahead: the chain overruns the
 *             target on today's numbers. A claim about the future, hence a separate
 *             class — a missed date and a forecast miss are different conversations.
 *   atrisk  — a POSITIVE buffer, but under the 50%-rule reserve (`guidelineFor`).
 *             Goldratt's line: a program holding less than half the remaining chain in
 *             buffer is one ordinary overrun from `late`.
 *   ontrack — everything else, INCLUDING no buffer data at all. Where there is nothing
 *             to compute we never guess a worse answer — the same rule the deleted
 *             Monte Carlo broke, one level down
 *             ([ADR](../../docs/adr/2026-07-24-forecasts-derive-from-the-real-chain-never-a-synthetic-model.md)).
 *
 * Severity runs blown > late > atrisk > ontrack, and the order is load-bearing: the
 * first two branches must be tested before the guideline, or a deeply overshot program
 * with a large notional guideline would read as merely thin.
 */
export type SopBufferClass = 'blown' | 'late' | 'atrisk' | 'ontrack';

export interface SopBufferInputs {
  bufferDays: number | null;
  guidelineDays: number | null;
  sopMs: number | null;
  now: number;
}

export function sopBufferClass({ bufferDays, guidelineDays, sopMs, now }: SopBufferInputs): SopBufferClass {
  if (bufferDays == null) return 'ontrack'; // no chain to read — never a guess
  if (bufferDays < 0) {
    return sopMs != null && Number.isFinite(sopMs) && sopMs < now ? 'blown' : 'late';
  }
  if (guidelineDays != null && bufferDays < guidelineDays) return 'atrisk';
  return 'ontrack';
}

/** The 50%-rule reserve for a stretch of remaining chain work — Goldratt's guideline,
 *  and the one place the "50%" lives. `chainLedger` takes it over the planned schedule's
 *  remaining sum and `sopBufferCategory` over the live chain's; both mean this rule, so
 *  changing it should be one edit rather than a grep for `/ 2`. */
export const guidelineFor = (remainingDays: number): number => Math.round(remainingDays / 2);

/**
 * The health TONE of that reading (#21), for surfaces that paint rather than label —
 * three tones over four classes, because a surface with no room for a NAME can only
 * spend its ink on severity. Callers that show a label use the class instead.
 * A mapping rather than a second branch set, so the two can never disagree about which
 * programs are bad news.
 */
export type SopForecastTone = 'onTrack' | 'atRisk' | 'blown';
const SOP_TONE_BY_CLASS: Record<SopBufferClass, SopForecastTone> = {
  blown: 'blown',
  late: 'atRisk',
  atrisk: 'atRisk',
  ontrack: 'onTrack',
};
export function sopForecastTone(args: SopBufferInputs): SopForecastTone {
  return SOP_TONE_BY_CLASS[sopBufferClass(args)];
}

/** The on-track signal: does now + remaining chain weeks land on or before the SOP? */
export function sopOutlook(remainingChainDays: number, sopDate: Date | string, now: number): SopOutlook {
  const sop = typeof sopDate === 'string' ? new Date(sopDate) : sopDate;
  const forecastFinishMs = now + remainingChainDays * DAY_MS;
  const bufferDays = Math.round((+sop - forecastFinishMs) / DAY_MS);
  return { forecastFinishMs, bufferDays, onTrack: bufferDays >= 0 };
}

// ---- capacity over time ----

export interface CapacityProgram {
  sopDate: string | null; // ISO
  volumeFirstYear: number;
  hasGas: boolean;
  hasGbi?: boolean;
  hasDigitalKey?: boolean;
  hasAap?: boolean;
  /** lib/lifecycle boundary: archived programs STAY in this chart (history is
   *  history); only cancelled ones stop counting — those units won't ship. */
  lifecycle?: string | null;
}

// The product dimension of the capacity chart. AAOS is the base platform — every
// program carries it — so its band alone reads as "vehicles online"; the other
// bands are the Google products riding on those vehicles.
export const PRODUCT_KEYS = ['aaos', 'gbi', 'gas', 'digitalKey', 'aap'] as const;
export type ProductKey = (typeof PRODUCT_KEYS)[number];

export const productCarried: Record<ProductKey, (p: CapacityProgram) => boolean> = {
  aaos: () => true,
  gbi: (p) => !!p.hasGbi,
  gas: (p) => !!p.hasGas,
  digitalKey: (p) => !!p.hasDigitalKey,
  aap: (p) => !!p.hasAap,
};

export interface ProductCapacityPoint {
  ms: number; // bucket end (quarter end)
  label: string; // e.g. "Q1 ’27"
  units: Record<ProductKey, number>; // product units in consumer hands
}

const YEAR_MS = 365 * DAY_MS;

/** A program's units-in-consumer-hands at time t: 0 at SOP, ramping linearly to the
 *  full 12-month volume at SOP + 12 months, holding thereafter. */
export function unitsAt(sopMs: number, volumeFirstYear: number, atMs: number): number {
  const frac = (atMs - sopMs) / YEAR_MS;
  return Math.round(volumeFirstYear * Math.max(0, Math.min(1, frac)));
}

const quarterEnd = (year: number, q: number) => new Date(Date.UTC(year, q * 3, 0)); // q: 1..4
const quarterOf = (d: Date) => Math.floor(d.getUTCMonth() / 3) + 1;
const label = (year: number, q: number) => `Q${q} ’${String(year).slice(2)}`;

/**
 * Product units in consumer hands per quarter. volumeFirstYear answers "how many
 * units within 12 months post-SOP?", so each program ramps LINEARLY from 0 at its
 * SOP to full volume at SOP + 12 months, then holds. A vehicle contributes to the
 * band of EVERY product it carries (bands overlap in vehicles, not in product
 * units). Programs without an SOP (or archived) can't be placed on the timeline —
 * counted in `excluded`.
 */
export function buildProductCapacitySeries(programs: CapacityProgram[], now: number): {
  points: ProductCapacityPoint[];
  excluded: number;
} {
  const counted = programs.filter((p) => p.lifecycle !== 'cancelled');
  const dated = counted.filter((p) => p.sopDate && p.volumeFirstYear > 0);
  const excluded = counted.length - dated.length;
  if (dated.length === 0) return { points: [], excluded };

  const sops = dated.map((p) => new Date(p.sopDate!));
  const start = new Date(Math.min(now, Math.min(...sops.map(Number))));
  // run through the last program's FULL ramp: latest SOP + 12 months
  const end = new Date(Math.max(...sops.map(Number)) + YEAR_MS);

  const points: ProductCapacityPoint[] = [];
  let year = start.getUTCFullYear();
  let q = quarterOf(start);
  const stopMs = +quarterEnd(end.getUTCFullYear(), quarterOf(end));
  for (let guard = 0; guard < 80; guard++) {
    const bucketEnd = quarterEnd(year, q);
    const units = Object.fromEntries(PRODUCT_KEYS.map((k) => [k, 0])) as Record<ProductKey, number>;
    for (const p of dated) {
      const u = unitsAt(+new Date(p.sopDate!), p.volumeFirstYear, +bucketEnd);
      for (const k of PRODUCT_KEYS) if (productCarried[k](p)) units[k] += u;
    }
    points.push({ ms: +bucketEnd, label: label(year, q), units });
    if (+bucketEnd >= stopMs) break;
    q += 1;
    if (q > 4) { q = 1; year += 1; }
  }
  return { points, excluded };
}

// ---- SOP buffer exhaustion ----

export interface SopBufferProgram {
  isArchived: boolean;
  lifecycle?: string | null;
  hillChartProgress: number;
  sopDate: string | null;
  /** Remaining forecast days along the critical chain (lib/criticalChain). */
  chainRemainingDays: number;
}

/** The SOP-outlook class of ONE program, from the deterministic critical-chain buffer
 *  (never the Monte Carlo forecast). These tokens are what the /programs "SOP outlook"
 *  column filters on, so they are URL vocabulary and outlive a rename (AGENTS lesson 15). */
export type SopBufferCategory = SopBufferClass | 'nosop' | 'na';

/** The classes the "SOP at risk" tile counts and its deep link selects. Reading ONE
 *  constant is what makes the tile's figure and the list it opens the same set by
 *  construction, rather than two literals somebody keeps in sync. Severity order, so
 *  the link reads worst-first. */
export type SopFlaggedClass = Exclude<SopBufferClass, 'ontrack'>;
export const SOP_FLAGGED_CLASSES: readonly SopFlaggedClass[] = ['blown', 'late', 'atrisk'];
export const isSopFlagged = (c: SopBufferCategory): c is SopFlaggedClass =>
  (SOP_FLAGGED_CLASSES as readonly string[]).includes(c);

/** One counter per flagged class, keyed by the class token itself, plus the headline
 *  total and the two denominators. */
export interface SopBufferRisk extends Record<SopFlaggedClass, number> {
  /** blown + late + atrisk — the headline figure. */
  flagged: number;
  /** Active programs carrying a target SOP — the denominator `flagged` is drawn from. */
  assessable: number;
  /** Active programs with no target SOP: not assessable, which is its own problem. */
  undated: number;
}

/**
 * A program's SOP outlook. The buffer is the room between the SOP target and
 * `now + remaining critical-chain work`; `sopBufferClass` reads it, and the two
 * non-class answers are about whether there is a reading to be had at all:
 *   nosop — active but no target SOP (can't be assessed; SOP is required, so its
 *           absence is its own problem — never silently "safe").
 *   na    — not active (Done / Cancelled / Archived): the SOP outlook is moot.
 * Only Active programs get a real reading — lib/lifecycle is the visibility boundary.
 *
 * The reserve is taken against the SAME remaining-chain quantity the buffer is measured
 * from, so the two halves of the comparison agree. Note this is the LIVE
 * longest-remaining path, while `chainLedger.guidelineDays` applies the same rule to the
 * PLANNED chain's schedule — near-identical in practice, not identical by construction,
 * and the deeper split (two answers to "when does this finish") is autoknow-9jd, not this
 * function's to resolve.
 */
export function sopBufferCategory(p: SopBufferProgram, now: number): SopBufferCategory {
  if (deriveProgramStatus(p) !== 'Active') return 'na';
  if (!p.sopDate) return 'nosop';
  return sopBufferClass({
    bufferDays: sopOutlook(p.chainRemainingDays, p.sopDate, now).bufferDays,
    guidelineDays: guidelineFor(p.chainRemainingDays),
    sopMs: +new Date(p.sopDate),
    now,
  });
}

/**
 * The per-ecosystem tally of sopBufferCategory, so the leadership tile's count and the
 * /programs SOP-outlook filter can never drift apart — and, since `SopOutlookCell` inks
 * the same class, so the at-risk tables agree with both.
 */
export function sopBufferRisk(programs: SopBufferProgram[], now: number): SopBufferRisk {
  const risk: SopBufferRisk = { blown: 0, late: 0, atrisk: 0, flagged: 0, assessable: 0, undated: 0 };
  for (const p of programs) {
    const c = sopBufferCategory(p, now);
    if (c === 'na') continue;
    if (c === 'nosop') {
      risk.undated += 1;
      continue;
    }
    risk.assessable += 1;
    if (isSopFlagged(c)) {
      risk[c] += 1;
      risk.flagged += 1;
    }
  }
  return risk;
}

// ---- risk ranking ----

/**
 * Risk score for ranking: health severity dominates (0/1/2 per lib/health), SOP
 * lateness breaks ties — a Concerned program that's also late outranks one that
 * isn't. Missing SOP contributes no lateness (it's flagged separately: SOP is
 * required, so absence is its own problem).
 */
export function riskScore(healthOrderValue: number, bufferDays: number | null): number {
  const lateDays = bufferDays == null ? 0 : Math.max(0, -bufferDays);
  return healthOrderValue * 100_000 + Math.min(99_999, lateDays);
}
