import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { jsonError, serverError } from '../../../lib/api';
import { indexEntity } from '../../../lib/search';
import { parseBody, projectApiSchema } from '../../../lib/schemas';
import { requireRouteAuth } from '../../../lib/routeAuth';
import { NO_OWNER, requireOwner, type OwnerFieldsOrNone } from '../../../lib/owner';

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      where: { isArchived: false }
    });
    return NextResponse.json({ projects });
  } catch (error) {
    return serverError(error, 'GET /api/projects');
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireRouteAuth(req))) return jsonError('Unauthorized', 401);
    const parsed = parseBody(projectApiSchema, await req.json());
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { name, partnerId, ownerName, sopDate, volumeFirstYear } = parsed.data;

    // Owner is an entity reference, not free text: resolve to an existing person or
    // refuse — the same rule the in-app form enforces (lib/owner; the API route had
    // been the unguarded sibling of that boundary). Both owner columns come back
    // together, so this route cannot store the email without the id.
    let owner: OwnerFieldsOrNone = NO_OWNER;
    if (ownerName != null) {
      try {
        owner = await requireOwner(ownerName);
      } catch (e) {
        return jsonError(e instanceof Error ? e.message : 'Owner must be an existing person', 400);
      }
    }

    const project = await prisma.project.create({
      data: {
        name,
        partnerId,
        ...owner,
        sopDate: sopDate ?? null,
        volumeFirstYear: volumeFirstYear ?? 0
      }
    });
    await indexEntity('program', project.id);

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects');
  }
}
