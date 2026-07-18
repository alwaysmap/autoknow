import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { jsonError, serverError } from '../../../../../lib/api';
import { requireRouteAuth } from '../../../../../lib/routeAuth';
import { parseBody, phaseCreateApiSchema } from '../../../../../lib/schemas';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await requireRouteAuth(req))) return jsonError('Unauthorized', 401);

    const { id } = await props.params;
    const projectId = parseInt(id, 10);
    if (isNaN(projectId)) {
      return jsonError('Invalid project ID', 400);
    }

    const parsed = parseBody(phaseCreateApiSchema, await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { name, forecastedDuration } = parsed.data;

    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!project) return jsonError('Project not found', 404);

    // Phase and its initial state land together — a phase with no state at all
    // reads as broken everywhere states[0] is consumed.
    const phase = await prisma.$transaction(async (tx) => {
      const created = await tx.phase.create({
        data: {
          projectId,
          name,
          forecastedDuration: forecastedDuration ?? 30,
        },
      });
      await tx.phaseState.create({
        data: {
          phaseId: created.id,
          status: 'Not Started',
          theNeedle: 'Low',
          hillChartProgress: 0,
          notes: 'Initial state',
        },
      });
      return created;
    });

    return NextResponse.json({ phase }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects/[id]/phases');
  }
}
