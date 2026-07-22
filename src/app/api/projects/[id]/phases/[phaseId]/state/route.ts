import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/db';
import { jsonError, serverError } from '../../../../../../../lib/api';
import { requireRouteAuth } from '../../../../../../../lib/routeAuth';
import { parseBody, phaseStateApiSchema } from '../../../../../../../lib/schemas';
import { parseHealth } from '../../../../../../../lib/health';
import { hillStatus } from '../../../../../../../lib/phase';
import { destructiveDbAllowed } from '../../../../../../../lib/dbSafety';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    if (!(await requireRouteAuth(req))) return jsonError('Unauthorized', 401);

    const { id, phaseId } = await props.params;
    const projectId = parseInt(id, 10);
    const pId = parseInt(phaseId, 10);
    if (isNaN(projectId) || isNaN(pId)) {
      return jsonError('Invalid project or phase ID', 400);
    }

    const parsed = parseBody(phaseStateApiSchema, await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { theNeedle, hillChartProgress, notes, source, sourceUrl, timestamp } = parsed.data;

    // Backdating is a seeding affordance (dated demo histories feed the buffer-trend
    // replay — docs/CRITICAL_CHAIN_VIEW_PLAN.md §6). Fail closed, and refuse rather
    // than silently ignore: dropping the timestamp would record WRONG history.
    if (timestamp !== undefined && !destructiveDbAllowed()) {
      return jsonError('timestamp override is only permitted on seed/test databases', 403);
    }

    // Parentage check: the phase must belong to the project in the URL — a
    // mismatched pair is a 404, never a silent write to someone else's phase.
    const phase = await prisma.phase.findFirst({
      where: { id: pId, projectId },
      select: { id: true },
    });
    if (!phase) return jsonError('Phase not found in this project', 404);

    // A notes/risk-only update must not move the dot: the newest PhaseState is the
    // phase's current progress everywhere, so default to the latest value, not 0
    // (same rule as actions/hill.ts).
    const latest = await prisma.phaseState.findFirst({
      where: { phaseId: pId },
      orderBy: { timestamp: 'desc' },
      select: { hillChartProgress: true },
    });
    const progress = hillChartProgress ?? latest?.hillChartProgress ?? 0;

    const phaseState = await prisma.phaseState.create({
      data: {
        phaseId: pId,
        // Status is always derived from the hill position — any status in the request
        // body is ignored (it was never authoritative; see lib/phase.hillStatus).
        status: hillStatus(progress),
        theNeedle: parseHealth(theNeedle),
        hillChartProgress: progress,
        notes: notes ?? null,
        source: source ?? 'API',
        sourceUrl: sourceUrl ?? null,
        // Omitted → the column default (write time) applies.
        ...(timestamp !== undefined ? { timestamp } : {}),
      }
    });

    return NextResponse.json({ phaseState }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects/[id]/phases/[phaseId]/state');
  }
}
