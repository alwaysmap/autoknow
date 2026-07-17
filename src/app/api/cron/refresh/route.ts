import { NextRequest, NextResponse } from 'next/server';
import { runRefreshCycle } from '../../../../lib/refresh';
import { runDriveSync } from '../../../../lib/driveSync';

export const dynamic = 'force-dynamic';

// The refresh worker's entry point (plan §6): hit on a schedule (external cron,
// launchd, GitHub action — anything that can GET a URL). Guarded by CRON_SECRET;
// without one configured the route refuses rather than running open.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: 'Refresh worker is off — set CRON_SECRET and pass it as ?secret= or a bearer token.' },
      { status: 503 },
    );
  }
  const provided =
    req.nextUrl.searchParams.get('secret') ||
    (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (provided !== secret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Drive first (discovery + metadata-gate refreshes), then the generic cycle.
  const drive = await runDriveSync();
  const report = await runRefreshCycle();
  return NextResponse.json({ ...report, drive });
}
