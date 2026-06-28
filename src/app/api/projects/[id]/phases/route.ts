import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const projectId = parseInt(id, 10);
    if (isNaN(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const body = await req.json();
    const { name, forecastedDuration } = body;

    if (!name) {
      return NextResponse.json({ error: 'Missing phase name' }, { status: 400 });
    }

    const phase = await prisma.phase.create({
      data: {
        projectId,
        name,
        forecastedDuration: forecastedDuration ? parseInt(forecastedDuration, 10) : 30
      }
    });

    await prisma.phaseState.create({
      data: {
        phaseId: phase.id,
        status: 'Not Started',
        theNeedle: 'Low',
        hillChartProgress: 0,
        notes: 'Initial state'
      }
    });

    return NextResponse.json({ phase }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
