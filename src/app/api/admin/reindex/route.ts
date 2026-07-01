import { NextResponse } from 'next/server';
import { adminOperationsAllowed, jsonError, serverError } from '../../../../lib/api';
import { reindexAll } from '../../../../lib/search';

// Rebuild the search index: (re)embed every partner, program, person, and context
// record. Guarded like the other admin/dev operations.
export async function POST(req: Request) {
  if (!adminOperationsAllowed(req)) {
    return jsonError('Unauthorized: admin operations are disabled in this environment', 403);
  }
  try {
    const counts = await reindexAll();
    return NextResponse.json({ message: 'Reindexed.', counts });
  } catch (error) {
    return serverError(error, 'POST /api/admin/reindex');
  }
}
