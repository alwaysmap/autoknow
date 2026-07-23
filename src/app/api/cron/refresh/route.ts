import { NextRequest, NextResponse } from 'next/server';
import { runRefreshCycle } from '../../../../lib/refresh';
import { runDriveSync } from '../../../../lib/driveSync';
import { runSummaryCycle } from '../../../../lib/summaries';
import { getIngestionSettings } from '../../../../lib/ingestionSettings';
import { perCycleBudget } from '../../../../lib/ingestBudget';
import { recordCycle } from '../../../../lib/ingestionHealth';
import { secretsEqual, serverError } from '../../../../lib/api';

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
  // SHARED across Drive + web — Drive spends first, web gets what's left — so total daily
  // spend stays under the free tier by construction. recordCycle then logs the reports to
  // Cloud Logging (the drain alarm's source) and upserts the bounded health summary.
  try {
    const budget = perCycleBudget((await getIngestionSettings()).dailyReingestBudgetDocs);
    const drive = await runDriveSync({ maxIngests: budget });
    const report = await runRefreshCycle({ maxRefreshes: Math.max(0, budget - drive.spent) });
    await recordCycle(drive, report);
    const summaries = await runSummaryCycle();
    return NextResponse.json({ ...report, drive, summaries });
  } catch (error) {
    return serverError(error, 'GET /api/cron/refresh');
  }
}
