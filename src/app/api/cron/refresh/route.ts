import { NextRequest, NextResponse } from 'next/server';
import { runRefreshCycle } from '../../../../lib/refresh';
import { runDriveSync } from '../../../../lib/driveSync';
import { runSummaryCycle } from '../../../../lib/summaries';
import { getIngestionSettings } from '../../../../lib/ingestionSettings';
import {
  perCycleBudget,
  perCycleRequests,
  requestsForDocs,
  summariesAffordable,
} from '../../../../lib/ingestBudget';
import { recordCycle } from '../../../../lib/ingestionHealth';
import { secretsEqual, serverError } from '../../../../lib/api';
import { withSingleFlight, REFRESH_LOCK_KEY } from '../../../../lib/singleFlight';

export const dynamic = 'force-dynamic';

// The refresh worker's entry point (plan §6): hit on a schedule (external cron,
// launchd, GitHub action — anything that can send a header). Guarded by CRON_SECRET;
// without one configured the route refuses rather than running open. The secret is
// accepted ONLY as a bearer token — query strings land in Funnel/relay/access logs.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Refresh worker is off — set CRON_SECRET and pass it as a bearer token.' },
      { status: 503 },
    );
  }
  const provided = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secretsEqual(provided, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Drive first (discovery + metadata-gate refreshes), then the generic refresh
  // cycle, then summaries — so freshly ingested/refreshed content lands in the same
  // cycle's summaries instead of waiting an hour.
  //
  // #38: one daily Gemini budget (the admin's setting) is spread over the cycles and
  // SHARED across all three stages — Drive spends first, web takes what's left, summaries
  // take what survives that — so total daily spend stays under the free tier by
  // construction. recordCycle then logs the reports to Cloud Logging (the drain alarm's
  // source) and upserts the bounded health summary.
  //
  // Why one pool, and why this order: lib/ingestBudget's header.
  try {
    // Single-flight (#57): an overlapping tick acquires nothing and skips, so two
    // instances never double-spend the budget. Why it can't go through `prisma`:
    // lib/singleFlight.
    const result = await withSingleFlight(REFRESH_LOCK_KEY, async () => {
      const { dailyReingestBudgetDocs } = await getIngestionSettings();
      const docBudget = perCycleBudget(dailyReingestBudgetDocs);
      const requestBudget = perCycleRequests(dailyReingestBudgetDocs);

      const drive = await runDriveSync({ maxIngests: docBudget });
      const report = await runRefreshCycle({ maxRefreshes: Math.max(0, docBudget - drive.spent) });
      await recordCycle(drive, report);

      // Only documents that were actually (re)ingested cost Gemini — a doc whose hash is
      // unchanged short-circuits before any call (lib/refresh Gate 1), which is why a
      // quiet cycle hands its whole allowance to summaries.
      //
      // `report.spent`, NOT `report.changed`: a doc whose digest reads `resolved` spends
      // both calls and then reports 'frozen', so counting 'changed' would hand summaries an
      // allowance ingestion had already used — reintroducing the double-spend this whole
      // change exists to remove, in a cycle where every changed doc happens to resolve.
      const spentRequests = requestsForDocs(drive.spent + report.spent);
      const summaries = await runSummaryCycle({
        maxRequests: summariesAffordable(requestBudget - spentRequests),
      });
      return { ...report, drive, summaries };
    });
    // 200, not an error: a skipped tick is the guard working, and a non-2xx would make
    // Cloud Scheduler retry — which is the very thing that produces the overlap.
    if (!result.ran) return NextResponse.json({ skipped: true, reason: 'already-running' });
    return NextResponse.json(result.value);
  } catch (error) {
    return serverError(error, 'GET /api/cron/refresh');
  }
}
