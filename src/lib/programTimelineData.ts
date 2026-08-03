import 'server-only';
import { prisma } from './db';

// THE shared server assembly for the portfolio whisker chart (#159), and the reason it is a
// module rather than a few lines inside a page: every surface that renders this chart —
// /programs, /ecosystem, and the popped form — calls this one function.
//
// That is the poppable-charts precondition, not a tidiness preference: the ADR states that
// "the per-chart data assembly lives in the page … so a second entry point duplicates it and
// the two drift", and calls one shared assembly a precondition rather than an option
// (docs/adr/2026-07-22-poppable-charts-a-parameter-a-shared-assembly-and-a-token.md).

/**
 * Earliest real start per program: the minimum, over its phases, of the explicit
 * `Phase.startedAt` or — absent that — the first state whose hill progress left zero.
 *
 * `COALESCE(startedAt, firstProgress)` per phase and THEN a MIN, never `LEAST` of the two.
 * Postgres `LEAST` skips NULLs and would take the EARLIER of the pair, which silently
 * inverts the rule that an explicit Active toggle wins over a derived timestamp — work
 * often starts at a partner well before the first update lands (`Phase.startedAt` in
 * prisma/schema.prisma). Same precedence `chainLedgerData` already applies per phase.
 *
 * One grouped aggregate for the whole page, not a probe per phase: `PhaseState` is
 * append-only and this runs on every request, so the timestamps are aggregated in SQL
 * rather than by materialising each phase's state history — the rule the cycle-time
 * aggregate in `dashboardData` states for itself.
 *
 * Measured (demo data, 250 PhaseState / 97 Phase / 18 Project): 2.2ms, 10 shared buffer
 * hits, one pass. The plan seq-scans `PhaseState` into a HashAggregate and does NOT use
 * `@@index([phaseId, timestamp])`.
 *
 * THE SEQ SCAN IS THE RIGHT PLAN — do not "fix" it. #159 specified that a seq scan here
 * ships a partial index on `("phaseId") WHERE "hillChartProgress" > 0` alongside it. Built
 * at scale (4.8M PhaseState / 16k Phase / 2k Project) that index is a PESSIMIZATION, and
 * the numbers are why this paragraph exists rather than the index:
 *
 *   parallel seq scan + HashAggregate      569 ms
 *   partial covering index, index-only     979 ms   (+72 MB on a 595 MB table)
 *
 * The planner does take the index when offered (Index Only Scan, Heap Fetches: 0) and is
 * still slower, because the query has no selective predicate to exploit: `> 0` matches over
 * half the rows, so every row is read either way, and a GroupAggregate walking an index in
 * phaseId order cannot beat three parallel workers hashing a heap. An index earns its place
 * by letting a query SKIP rows; this one skips none.
 *
 * If this ever needs to get cheaper the lever is reading fewer rows — a date floor, or a
 * materialised first-progress column maintained on write — not another index.
 */
export async function getProgramStartMs(projectIds: number[]): Promise<Map<number, number>> {
  if (projectIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<{ projectId: number; startedAt: Date | null }[]>`
    SELECT ph."projectId", MIN(COALESCE(ph."startedAt", fp."firstProgress")) AS "startedAt"
    FROM "Phase" ph
    LEFT JOIN (
      SELECT "phaseId", MIN("timestamp") AS "firstProgress"
      FROM "PhaseState" WHERE "hillChartProgress" > 0 GROUP BY "phaseId"
    ) fp ON fp."phaseId" = ph.id
    WHERE ph."projectId" = ANY(${projectIds})
    GROUP BY ph."projectId"`;

  const byId = new Map<number, number>();
  for (const r of rows) if (r.startedAt) byId.set(r.projectId, r.startedAt.getTime());
  return byId;
}
