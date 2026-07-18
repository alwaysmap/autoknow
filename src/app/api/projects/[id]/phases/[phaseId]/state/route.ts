import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/db';
import { jsonError, serverError } from '../../../../../../../lib/api';
import { parseHealth } from '../../../../../../../lib/health';
import { hillStatus } from '../../../../../../../lib/phase';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const { phaseId } = await props.params;
    const pId = parseInt(phaseId, 10);
    if (isNaN(pId)) {
      return jsonError('Invalid phase ID', 400);
    }

    const body = await req.json();
    const { theNeedle, hillChartProgress, notes, source } = body;

    // A notes/risk-only update must not move the dot: the newest PhaseState is the
    // phase's current progress everywhere, so default to the latest value, not 0
    // (same rule as actions/hill.ts).
    const latest = await prisma.phaseState.findFirst({
      where: { phaseId: pId },
      orderBy: { timestamp: 'desc' },
      select: { hillChartProgress: true },
    });
    const progress =
      hillChartProgress !== undefined
        ? parseInt(hillChartProgress, 10)
        : latest?.hillChartProgress ?? 0;
    if (isNaN(progress) || progress < 0 || progress > 100) {
      return jsonError('hillChartProgress must be 0-100', 400);
    }

    const phaseState = await prisma.phaseState.create({
      data: {
        phaseId: pId,
        // Status is always derived from the hill position — any status in the request
        // body is ignored (it was never authoritative; see lib/phase.hillStatus).
        status: hillStatus(progress),
        theNeedle: parseHealth(theNeedle),
        hillChartProgress: progress,
        notes: notes || null,
        source: source || 'API'
      }
    });

    return NextResponse.json({ phaseState }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects/[id]/phases/[phaseId]/state');
  }
}
