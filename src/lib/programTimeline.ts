import { deriveProgramStatus } from './lifecycle';

// The portfolio whisker chart's layout (#159), as pure data: which programs get a mark,
// where each mark's three dates sit on a shared time window, and what ORDER the rows go in.
// One row per program, most urgent first — see `sortByUrgency`, which replaced greedy lane
// packing. Zero DOM, so it unit-tests without a browser — the convention of
// `labelPlacement`, `phaseTrackLayout` and `focusWindow`.
//
// The component over this is a pure renderer. It does not query, does not derive, and does
// not know which page it is on; each surface decides WHICH programs it plots and hands the
// same shape across (#159's "one shape, two pages").

const DAY_MS = 86_400_000;

/** The structural subset both page shapes already satisfy — the convention
 *  `phaseTrackLayout` set ("operates on a structural subset of PhaseTrackRow").
 *
 *  `DashboardProject` satisfies this as it stands (`dashboardData.ts`). `/programs`'s
 *  serialized project does NOT yet: it computes `chain.remainingDays` only to pass into
 *  `sopBufferCategory` and drops it from the object it returns, so wiring that page to this
 *  chart adds `chainRemainingDays: chain.remainingDays` there. One line, but not zero —
 *  tracked as autoknow-ws1. */
export interface TimelineProgram {
  id: number;
  name: string;
  theNeedle: string;
  sopDate: string | null;
  chainRemainingDays: number;
  isArchived: boolean;
  lifecycle: string;
  hillChartProgress: number;
}

export interface TimelineMark {
  id: number;
  name: string;
  /** Raw `theNeedle`; the component inks it via `healthColor()`, so the colour rule has one
   *  home and this module stays free of anything visual. */
  health: string;
  /**
   * The target SOP, or null when the program has none.
   *
   * NOT a reason to drop the program (2026-08-03, user call). The chart's job is to show
   * everything in flight, and a program without a target date is still in flight — it is
   * arguably the one most worth seeing. It simply has no SOP dot: its start and forecast
   * finish still place it on the axis, and the absent dot is itself the reading.
   */
  sopMs: number | null;
  startMs: number | null;
  finishMs: number | null;
  /**
   * Row index. y carries no meaning beyond separating programs.
   *
   * A FIRST-PAINT value. The component re-sorts and re-assigns rows on every render (it has
   * to: hiding a health band must close its rows rather than leave gaps), so this is what
   * SSR paints and what the tests assert, not a number the client trusts afterwards.
   */
  lane: number;
}

export interface TimelineLayout {
  marks: TimelineMark[];
  /** Window bounds, snapped out to month boundaries. */
  windowMinMs: number;
  windowMaxMs: number;
  laneCount: number;
  /** The `now` the marks were built against, carried so the component's "today" rule and
   *  its forecast dots come from ONE snapshot. Taken per request on the server, which is
   *  also what keeps SSR and hydration agreeing (a `Date.now()` in render would do neither). */
  nowMs: number;
  /** Programs that could not be placed because they carry NO date at all — no SOP, no
   *  start, no forecast. There is nowhere on a time axis to put them, which is a different
   *  fact from "no SOP" and is why it is counted separately and stated in the UI. */
  excludedNoDates: number;
}

const monthFloor = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
};

const monthCeil = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
};

/**
 * Build the marks and pack them into lanes.
 *
 * @param startById program id → earliest phase start, from the grouped SQL aggregate. A
 *   program missing from the map simply has no start dot.
 */
export function buildTimelineMarks(
  programs: readonly TimelineProgram[],
  startById: Map<number, number>,
  now: number,
): TimelineLayout {
  const placed: TimelineMark[] = [];
  let excludedNoDates = 0;

  for (const p of programs) {
    const sopMs = p.sopDate ? new Date(p.sopDate).getTime() : null;
    const startMs = startById.get(p.id) ?? null;

    // The forecast is `now + remaining chain days` — the SAME arithmetic `sopOutlook` does
    // (`lib/sop`: `forecastFinishMs = now + remainingChainDays * DAY_MS`), and so the SAME
    // quantity the page's own SOP-outlook column reads. NOT the ledger's cascade.
    //
    // Inlined rather than called, because `sopOutlook` requires a `sopDate` in order to
    // return a buffer we do not want, and this chart plots programs that have no SOP at all.
    // If that formula ever moves, `lib/sop` is the definition of record and this follows it.
    // The ledger is the better forecast and is what a program's own page prints, but a
    // chart that used it would draw a whisker overshooting its SOP on a row whose outlook
    // cell three columns away says On track. A page must not contradict itself.
    //
    // Only for programs still Active: a Done or Cancelled one has no remaining chain, so a
    // "forecast finish" for it would be a date nobody is working toward. Same boundary
    // `sopBufferCategory` applies before it reports anything at all.
    const active = deriveProgramStatus(p) === 'Active';
    const finishMs = active && p.chainRemainingDays > 0
      ? now + p.chainRemainingDays * DAY_MS
      : null;

    if (sopMs == null && startMs == null && finishMs == null) {
      excludedNoDates += 1;
      continue;
    }
    placed.push({ id: p.id, name: p.name, health: p.theNeedle, sopMs, startMs, finishMs, lane: 0 });
  }

  if (placed.length === 0) {
    const floor = monthFloor(now);
    return { marks: [], windowMinMs: floor, windowMaxMs: monthCeil(now), laneCount: 0, nowMs: now, excludedNoDates };
  }

  const lo = (m: TimelineMark) => Math.min(...dates(m));
  const hi = (m: TimelineMark) => Math.max(...dates(m));

  // The window spans everything drawn, plus today — a chart of future SOPs that did not
  // show "now" would give the reader no anchor for how far off any of it is.
  const windowMinMs = monthFloor(Math.min(now, ...placed.map(lo)));
  const windowMaxMs = monthCeil(Math.max(now, ...placed.map(hi)));

  const order = sortByUrgency(placed);
  order.forEach((m, i) => { m.lane = i; });
  return { marks: order, windowMinMs, windowMaxMs, laneCount: order.length, nowMs: now, excludedNoDates };
}

/**
 * ONE ROW PER PROGRAM, most urgent first. Returns a new array; the caller assigns lanes.
 *
 * NOT greedy lane-packing, which is what this used to do. Packing puts unrelated programs
 * on one row whenever their dates do not overlap — which is denser, and which makes "the
 * things that will SOP soonest are at the top" impossible to say, because a row is then not
 * a program. With a row per program the chart also SCROLLS honestly at portfolio scale: the
 * axis is anchored outside the scrollport, so a reader with 100 programs pages through
 * records against a time axis that never moves (2026-08-03, user call).
 *
 * The order, worst first:
 *   1. OVERRUN — the forecast lands after the SOP. Sorted by how far over, biggest first;
 *      that is the whole point of the red segment, so the reddest rows are the ones you see
 *      without scrolling.
 *   2. On track with a target, by soonest SOP — what lands next is what you plan around.
 *   3. No target SOP at all. Last, because there is no date to be urgent about — but still
 *      present, which is the point of plotting them.
 *
 * Ties break on id, so the row order is fully determined by the data and never by the
 * position a mark happened to arrive in. Otherwise adding an `orderBy` to a query three
 * modules away silently reshuffles this chart, and nothing tells you it moved.
 */
export function sortByUrgency(marks: TimelineMark[]): TimelineMark[] {
  const overrunMs = (m: TimelineMark) =>
    m.sopMs != null && m.finishMs != null && m.finishMs > m.sopMs ? m.finishMs - m.sopMs : 0;
  const band = (m: TimelineMark) => (overrunMs(m) > 0 ? 0 : m.sopMs != null ? 1 : 2);

  return [...marks].sort((a, b) =>
    band(a) - band(b)
    || overrunMs(b) - overrunMs(a)
    || (a.sopMs ?? Infinity) - (b.sopMs ?? Infinity)
    || a.id - b.id);
}

/** The dates a mark actually carries — every one of them optional except that at least one
 *  must exist, which `buildTimelineMarks` guarantees before a mark is created. */
function dates(m: TimelineMark): number[] {
  return [m.sopMs, m.startMs, m.finishMs].filter((d): d is number => d != null);
}

/** Month boundaries across the window, for the axis strip. Thinned to `max` ticks so the
 *  labels cannot collide — the chart has no other text, so this is the whole label story.
 *
 *  `max` is REQUIRED, deliberately. A default here would be a second home for a number the
 *  component's phone breakpoint is also written against, free to drift out of step with it. */
export function monthTicks(windowMinMs: number, windowMaxMs: number, max: number): number[] {
  const all: number[] = [];
  for (let ms = windowMinMs; ms <= windowMaxMs; ms = monthCeil(ms)) all.push(ms);
  if (all.length <= max) return all;
  const step = Math.ceil(all.length / max);
  return all.filter((_, i) => i % step === 0);
}
