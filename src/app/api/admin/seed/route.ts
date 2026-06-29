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
      await seedMockData();
      return NextResponse.json({ message: 'Mock data seeded successfully.' });
    } else {
      return NextResponse.json({ error: `Invalid mode: ${mode}. Expected 'wipe', 'core', or 'mock'.` }, { status: 400 });
    }
  } catch (error) {
    return serverError(error, 'POST /api/admin/seed');
  }
}
