// SOP-target math — pure and client-safe. Every program must carry a target SOP
// (month + year minimum; we assume the LAST DAY of that month). Combined with the
// notional remaining phase weeks (the critical chain), this is THE on-track signal,
// and it drives the ecosystem capacity chart: when units come online, with/without GAS.

import { deriveProgramStatus } from './lifecycle';

export const DAY_MS = 86_400_000;

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

/** The health tone of a program's forecast finish against its SOP (#21), from the
 *  ledger's own numbers so the header and the Critical chain section never disagree.
 *  A MISSED SOP is worse than a forecast miss, which is what the two bad tones say:
 *    - overshoot (buffer < 0) and the SOP date has already passed → 'blown'  (Concerned)
 *    - overshoot and the SOP is still ahead                        → 'atRisk' (Some Risk)
 *    - a POSITIVE buffer below the 50%-rule reserve                → 'atRisk' (near the line)
 *    - otherwise                                                   → 'onTrack'
 */
export type SopForecastTone = 'onTrack' | 'atRisk' | 'blown';
export function sopForecastTone(args: {
  bufferDays: number | null;
  guidelineDays: number | null;
  sopMs: number | null;
  now: number;
}): SopForecastTone {
  const { bufferDays, guidelineDays, sopMs, now } = args;
  if (bufferDays != null && bufferDays < 0) {
    return sopMs != null && Number.isFinite(sopMs) && sopMs < now ? 'blown' : 'atRisk';
  }
  if (bufferDays != null && guidelineDays != null && bufferDays < guidelineDays) return 'atRisk';
  return 'onTrack';
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

export interface SopBufferRisk {
  /** Programs whose remaining chain work no longer fits before the SOP target. */
  late: number;
  /** Active programs carrying a target SOP — the denominator `late` is drawn from. */
  assessable: number;
  /** Active programs with no target SOP: not assessable, which is its own problem. */
  undated: number;
}

/** The SOP-outlook class of ONE program, from the deterministic critical-chain buffer
 *  (never the Monte Carlo forecast). These tokens are what the /programs "SOP outlook"
 *  column filters on. */
export type SopBufferCategory = 'late' | 'ontrack' | 'nosop' | 'na';

/**
 * A program's SOP outlook. The buffer is the room between the SOP target and
 * `now + remaining critical-chain work`; when it goes negative the buffer is exhausted
 * and the date slips.
 *   late    — active, buffer gone: the forecast finish overruns the target SOP.
 *   ontrack — active, buffer intact.
 *   nosop   — active but no target SOP (can't be assessed; SOP is required, so its
 *             absence is its own problem — never silently "safe").
 *   na      — not active (Done / Cancelled / Archived): the SOP outlook is moot.
 * Only Active programs get a real reading — lib/lifecycle is the visibility boundary.
 */
export function sopBufferCategory(p: SopBufferProgram, now: number): SopBufferCategory {
  if (deriveProgramStatus(p) !== 'Active') return 'na';
  if (!p.sopDate) return 'nosop';
  return sopOutlook(p.chainRemainingDays, p.sopDate, now).onTrack ? 'ontrack' : 'late';
}

/**
 * How many active programs are projected to blow their SOP date — the per-ecosystem
 * tally of sopBufferCategory, so the leadership tile's count and the /programs
 * ?sopOutlook=late filter can never drift apart. Same signal the at-risk table's
 * Forecast column renders per row (sopOutlook).
 */
export function sopBufferRisk(programs: SopBufferProgram[], now: number): SopBufferRisk {
  let late = 0;
  let assessable = 0;
  let undated = 0;
  for (const p of programs) {
    switch (sopBufferCategory(p, now)) {
      case 'late':
        late += 1;
        assessable += 1;
        break;
      case 'ontrack':
        assessable += 1;
        break;
      case 'nosop':
        undated += 1;
        break;
      // 'na' — not active, not counted
    }
  }
  return { late, assessable, undated };
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
