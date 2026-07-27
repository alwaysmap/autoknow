import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/db';
import { jsonError, serverError } from '../../../../../../../lib/api';
import { requireRouteAuth } from '../../../../../../../lib/routeAuth';
import { parseBody, actionItemApiSchema } from '../../../../../../../lib/schemas';
import { personDirectorySelect, resolvePerson } from '../../../../../../../lib/people';

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

    const parsed = parseBody(actionItemApiSchema, await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { description, assignedTo, status, nextStep, linkUrl, source, sourceUrl } = parsed.data;

    const phase = await prisma.phase.findFirst({
      where: { id: pId, projectId },
      select: { id: true },
    });
    if (!phase) return jsonError('Phase not found in this project', 404);

    // Link the assignee to a Person when the handle/email/name resolves (the
    // resolvePerson pattern). Best-effort, not a rejection: unlike a program owner,
    // an assignee may legitimately be someone not yet in the people table — the
    // free-text handle is kept either way.
    let assignedToPersonId: number | null = null;
    if (assignedTo) {
      const people = await prisma.person.findMany({ select: personDirectorySelect });
      assignedToPersonId = resolvePerson(people, assignedTo)?.id ?? null;
    }

    const actionItem = await prisma.actionItem.create({
      data: {
        phaseId: pId,
        description,
        assignedTo: assignedTo ?? null,
        assignedToPersonId,
        status,
        nextStep: nextStep ?? 'Undecided',
        linkUrl: linkUrl ?? null,
        source: source ?? null,
        sourceUrl: sourceUrl ?? null
      }
    });

    return NextResponse.json({ actionItem }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects/[id]/phases/[phaseId]/action-items');
  }
}
