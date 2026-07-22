import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { jsonError, serverError } from '../../../../../lib/api';
import { requireRouteAuth } from '../../../../../lib/routeAuth';
import { parseBody, phaseStateApiSchema } from '../../../../../lib/schemas';
import { parseHealth } from '../../../../../lib/health';
import { destructiveDbAllowed } from '../../../../../lib/dbSafety';

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

    const parsed = parseBody(phaseStateApiSchema, await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { theNeedle, hillChartProgress, notes, source, sourceUrl, timestamp } = parsed.data;

    // Same seed-only backdate rule as the phase-state route: fail closed, and refuse
    // rather than silently ignore (docs/CRITICAL_CHAIN_VIEW_PLAN.md §6).
    if (timestamp !== undefined && !destructiveDbAllowed()) {
      return jsonError('timestamp override is only permitted on seed/test databases', 403);
    }

    const proj = await prisma.project.findUnique({ where: { id: projectId } });
    if (!proj) {
      return jsonError('Project not found', 404);
    }

    const finalNeedle = theNeedle ? parseHealth(theNeedle) : proj.theNeedle;
    const finalProgress = hillChartProgress ?? proj.hillChartProgress;

    // Column update and state log commit together: partnerPrograms reads "current"
    // from the column and "previous" from states[1] — a crash between the two
    // writes would render an incoherent pair.
    const [updatedProject] = await prisma.$transaction([
      prisma.project.update({
        where: { id: projectId },
        data: {
          theNeedle: finalNeedle,
          hillChartProgress: finalProgress
        }
      }),
      prisma.projectState.create({
        data: {
          projectId,
          theNeedle: finalNeedle,
          hillChartProgress: finalProgress,
          notes: notes ?? null,
          source: source ?? 'API',
          sourceUrl: sourceUrl ?? null,
          ...(timestamp !== undefined ? { timestamp } : {}),
        }
      }),
    ]);

    return NextResponse.json({ project: updatedProject }, { status: 200 });
  } catch (error) {
    return serverError(error, 'POST /api/projects/[id]/needle');
  }
}
