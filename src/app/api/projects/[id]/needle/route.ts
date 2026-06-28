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
    const { theNeedle, hillChartProgress, notes, source } = body;

    const proj = await prisma.project.findUnique({ where: { id: projectId } });
    if (!proj) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const finalNeedle = theNeedle || proj.theNeedle;
    const finalProgress = hillChartProgress !== undefined ? parseInt(hillChartProgress, 10) : proj.hillChartProgress;

    const updatedProject = await prisma.project.update({
      where: { id: projectId },
      data: {
        theNeedle: finalNeedle,
        hillChartProgress: finalProgress
      }
    });

    await prisma.projectState.create({
      data: {
        projectId,
        theNeedle: finalNeedle,
        hillChartProgress: finalProgress,
        notes: notes || null,
        source: source || 'API'
      }
    });

    return NextResponse.json({ project: updatedProject }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
