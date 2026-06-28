import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/db';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const { phaseId } = await props.params;
    const pId = parseInt(phaseId, 10);
    if (isNaN(pId)) {
      return NextResponse.json({ error: 'Invalid phase ID' }, { status: 400 });
    }

    const body = await req.json();
    const { status, theNeedle, hillChartProgress, notes, source } = body;

    if (!status) {
      return NextResponse.json({ error: 'Missing status' }, { status: 400 });
    }

    const phaseState = await prisma.phaseState.create({
      data: {
        phaseId: pId,
        status,
        theNeedle: theNeedle || 'Low',
        hillChartProgress: hillChartProgress !== undefined ? parseInt(hillChartProgress, 10) : 0,
        notes: notes || null,
        source: source || 'API'
      }
    });

    return NextResponse.json({ phaseState }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
