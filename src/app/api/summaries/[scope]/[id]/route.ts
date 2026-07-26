import { NextRequest, NextResponse } from 'next/server';
import { getSummary, createSummary } from '../../../../../lib/summaries';
import { geminiConfigured } from '../../../../../lib/gemini';
import { quotaBlocked } from '../../../../../lib/geminiQuota';
import { isSummaryScope } from '../../../../../lib/summaryPrompts';
import { serverError, jsonError } from '../../../../../lib/api';
import { requireRouteAuth } from '../../../../../lib/routeAuth';

// The structured-summary API. GET returns the cached summary (with a staleness flag);
// POST regenerates from current evidence and returns the fresh one. Scopes:
//   /api/summaries/ecosystem/0
//   /api/summaries/partner/<partnerId>
//   /api/summaries/program/<projectId>
// Body shape: { configured, summary: { tldr, body: { sections: [{ key, bullets:
// [{ text, citations: [{ label, href, external }] }] }] }, generatedAt, stale, … } }

function parseParams(scope: string, id: string): { scope: 'ecosystem' | 'partner' | 'program'; targetId: number } | null {
  if (!isSummaryScope(scope)) return null;
  const targetId = parseInt(id, 10);
  if (isNaN(targetId) || targetId < 0) return null;
  if (scope === 'ecosystem' && targetId !== 0) return null;
  return { scope, targetId };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ scope: string; id: string }> }) {
  const { scope, id } = await ctx.params;
  const parsed = parseParams(scope, id);
  if (!parsed) return jsonError('Unknown summary scope or id', 404);
  try {
    const summary = await getSummary(parsed.scope, parsed.targetId);
    return NextResponse.json({ configured: geminiConfigured, summary });
  } catch (error) {
    return serverError(error, `GET /api/summaries/${scope}/${id}`);
  }
}

export async function POST(_req: NextRequest, ctx: { params: Promise<{ scope: string; id: string }> }) {
  // Regeneration burns a Gemini call — session/token required (fail-closed even if
  // the proxy perimeter is misconfigured).
  if (!(await requireRouteAuth(_req))) return jsonError('Unauthorized', 401);
  const { scope, id } = await ctx.params;
  const parsed = parseParams(scope, id);
  if (!parsed) return jsonError('Unknown summary scope or id', 404);
  try {
    if (!geminiConfigured) return jsonError('Gemini is not configured (GEMINI_API_KEY missing)', 503);
    // Same preflight as quick-ingest: decline before spending rather than fail partway.
    // 503, not 500 — a temporary refusal to spend, with the existing summary untouched and
    // still served by GET.
    const blocked = quotaBlocked();
    if (blocked) {
      return jsonError(
        'Gemini is over its quota or spending cap — the existing summary is unchanged. Check ai.studio/spend.',
        503,
      );
    }
    const created = await createSummary(parsed.scope, parsed.targetId, 'manual');
    if (created == null) return jsonError('Nothing to summarize for this scope', 404);
    const summary = await getSummary(parsed.scope, parsed.targetId);
    return NextResponse.json({ configured: true, summary });
  } catch (error) {
    return serverError(error, `POST /api/summaries/${scope}/${id}`);
  }
}
