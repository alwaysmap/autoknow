import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { jsonError, serverError } from '../../../../../lib/api';
import { requireRouteAuth } from '../../../../../lib/routeAuth';
import { parseBody, phaseCreateApiSchema } from '../../../../../lib/schemas';
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

    const parsed = parseBody(phaseCreateApiSchema, await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { name, forecastedDuration, stateTimestamp } = parsed.data;

    // Seed-only backdate for the auto-created initial state: without it, a seeded
    // phase's dated history would sit BEHIND a "Not Started" row stamped at seed
    // time, and latest-timestamp-wins would erase the whole story
    // (docs/CRITICAL_CHAIN_VIEW_PLAN.md §6). Fail closed, refuse over ignore.
    if (stateTimestamp !== undefined && !destructiveDbAllowed()) {
      return jsonError('stateTimestamp override is only permitted on seed/test databases', 403);
    }

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
          // Canonical health label — 'Low' was a legacy risk value the in-app
          // addPhase action (actions/programPhases) had already moved off.
          theNeedle: 'On Track',
          hillChartProgress: 0,
          notes: 'Initial state',
          ...(stateTimestamp !== undefined ? { timestamp: stateTimestamp } : {}),
        },
      });
      return created;
    });

    return NextResponse.json({ phase }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects/[id]/phases');
  }
}
