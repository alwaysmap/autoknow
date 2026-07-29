import { NextRequest, NextResponse } from 'next/server';
import { wipeAllData, seedCoreData, seedMockData } from '../../../../lib/seed';
import { adminOperationsAllowed, jsonError, serverError } from '../../../../lib/api';

export async function POST(req: NextRequest) {
  if (!adminOperationsAllowed(req)) {
    return jsonError('Unauthorized: admin operations are disabled in this environment', 403);
  }
  try {
    const body = await req.json();
    const { mode } = body;

    if (!mode) {
      return NextResponse.json({ error: 'Missing "mode" parameter' }, { status: 400 });
    }

    if (mode === 'wipe') {
      await wipeAllData();
      return NextResponse.json({ message: 'Database wiped successfully.' });
    } else if (mode === 'core') {
      await seedCoreData();
      return NextResponse.json({ message: 'Core data seeded successfully.' });
    } else if (mode === 'mock') {
      // 200 with a per-document count, never an opaque 500: a corpus document Gemini
      // refused is a gap in the demo's sources, not a failed seed — every partner,
      // program, phase and state row is there (autoknow-j81 / AGENTS lesson 5). The
      // reasons ride along so the operator learns "over the spend cap" from the response
      // instead of from the server log.
      const report = await seedMockData();
      const { ingested, skipped } = report.corpus;
      return NextResponse.json({
        message:
          skipped.length === 0
            ? `Mock data seeded successfully. Ingested ${ingested} sources.`
            : `Mock data seeded. Ingested ${ingested} sources; ${skipped.length} could not be ingested.`,
        corpus: { ingested, skipped },
      });
    } else {
      return NextResponse.json({ error: `Invalid mode: ${mode}. Expected 'wipe', 'core', or 'mock'.` }, { status: 400 });
    }
  } catch (error) {
    return serverError(error, 'POST /api/admin/seed');
  }
}
