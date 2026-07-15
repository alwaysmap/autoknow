// SOP-target math — pure and client-safe. Every program must carry a target SOP
// (month + year minimum; we assume the LAST DAY of that month). Combined with the
// notional remaining phase weeks (the critical chain), this is THE on-track signal,
// and it drives the ecosystem capacity chart: when units come online, with/without GAS.

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
  slackDays: number; // positive = finishes before SOP, negative = late
  onTrack: boolean;
}

/** The on-track signal: does now + remaining chain weeks land on or before the SOP? */
export function sopOutlook(remainingChainDays: number, sopDate: Date | string, now: number): SopOutlook {
  const sop = typeof sopDate === 'string' ? new Date(sopDate) : sopDate;
  const forecastFinishMs = now + remainingChainDays * DAY_MS;
  const slackDays = Math.round((+sop - forecastFinishMs) / DAY_MS);
  return { forecastFinishMs, slackDays, onTrack: slackDays >= 0 };
}

// ---- capacity over time ----

export interface CapacityProgram {
  sopDate: string | null; // ISO
  volumeFirstYear: number;
  hasGas: boolean;
  isArchived?: boolean;
}

export interface CapacityPoint {
  ms: number; // bucket end (quarter end)
  label: string; // e.g. "Q1 ’27"
  withGas: number; // units in consumer hands running AAOS + GAS
  withoutGas: number; // units in consumer hands running AAOS without GAS
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
 * Units in consumer hands per quarter, split by GAS. volumeFirstYear answers "how
 * many units within 12 months post-SOP?", so each program ramps LINEARLY from 0 at
 * its SOP to full volume at SOP + 12 months, then holds. Programs without an SOP
 * (or archived) can't be placed on the timeline — counted in `excluded`.
 */
export function buildCapacitySeries(programs: CapacityProgram[], now: number): {
  points: CapacityPoint[];
  excluded: number;
} {
  const dated = programs.filter((p) => !p.isArchived && p.sopDate && p.volumeFirstYear > 0);
  const excluded = programs.filter((p) => !p.isArchived).length - dated.length;
  if (dated.length === 0) return { points: [], excluded };

  const sops = dated.map((p) => new Date(p.sopDate!));
  const start = new Date(Math.min(now, Math.min(...sops.map(Number))));
  // run through the last program's FULL ramp: latest SOP + 12 months
  const end = new Date(Math.max(...sops.map(Number)) + YEAR_MS);

  const points: CapacityPoint[] = [];
  let year = start.getUTCFullYear();
  let q = quarterOf(start);
  const stopMs = +quarterEnd(end.getUTCFullYear(), quarterOf(end));
  for (let guard = 0; guard < 80; guard++) {
    const bucketEnd = quarterEnd(year, q);
    let withGas = 0, withoutGas = 0;
    for (const p of dated) {
      const u = unitsAt(+new Date(p.sopDate!), p.volumeFirstYear, +bucketEnd);
      if (p.hasGas) withGas += u;
      else withoutGas += u;
    }
    points.push({ ms: +bucketEnd, label: label(year, q), withGas, withoutGas });
    if (+bucketEnd >= stopMs) break;
    q += 1;
    if (q > 4) { q = 1; year += 1; }
  }
  return { points, excluded };
}

// ---- risk ranking ----

/**
 * Risk score for ranking: health severity dominates (0/1/2 per lib/health), SOP
 * lateness breaks ties — a Concerned program that's also late outranks one that
 * isn't. Missing SOP contributes no lateness (it's flagged separately: SOP is
 * required, so absence is its own problem).
 */
export function riskScore(healthOrderValue: number, slackDays: number | null): number {
  const lateDays = slackDays == null ? 0 : Math.max(0, -slackDays);
  return healthOrderValue * 100_000 + Math.min(99_999, lateDays);
}
