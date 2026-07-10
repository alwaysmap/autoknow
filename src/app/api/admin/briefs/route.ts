import { NextRequest, NextResponse } from 'next/server';
import { generateDueBriefs } from '../../../../lib/brief';
import { adminOperationsAllowed, jsonError, serverError } from '../../../../lib/api';
import { geminiConfigured } from '../../../../lib/gemini';

// The daily trigger (spec §2.12): batch-generate briefs for every non-archived program
// with activity newer than its last brief. Invoked by an external scheduler (no cron
// infra in-repo) — e.g. curl -X POST -H "x-admin-token: $ADMIN_TOKEN" /api/admin/briefs
export async function POST(req: NextRequest) {
  if (!adminOperationsAllowed(req)) {
    return jsonError('Unauthorized: admin operations are disabled in this environment', 403);
  }
  try {
    if (!geminiConfigured) {
      return jsonError('Gemini is not configured (GEMINI_API_KEY missing)', 503);
    }
    const result = await generateDueBriefs();
    return NextResponse.json(result);
  } catch (error) {
    return serverError(error, 'POST /api/admin/briefs');
  }
}
