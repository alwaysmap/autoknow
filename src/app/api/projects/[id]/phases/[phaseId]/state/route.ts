import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/db';
import { jsonError, serverError } from '../../../../../../../lib/api';
import { mapNeedleInput } from '../../../../../../../lib/needle';

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
    const { status, theNeedle, hillChartProgress, notes, source } = body;

    if (!status) {
      return jsonError('Missing status', 400);
    }

    const phaseState = await prisma.phaseState.create({
      data: {
        phaseId: pId,
        status,
        theNeedle: mapNeedleInput(theNeedle) || 'Low',
        hillChartProgress: hillChartProgress !== undefined ? parseInt(hillChartProgress, 10) : 0,
        notes: notes || null,
        source: source || 'API'
      }
    });

    return NextResponse.json({ phaseState }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects/[id]/phases/[phaseId]/state');
  }
}
