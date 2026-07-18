import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { jsonError, serverError } from '../../../../../lib/api';
import { requireRouteAuth } from '../../../../../lib/routeAuth';
import { parseBody, affiliationApiSchema } from '../../../../../lib/schemas';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    if (!(await requireRouteAuth(req))) return jsonError('Unauthorized', 401);

    const { id } = await props.params;
    const personId = parseInt(id, 10);
    if (isNaN(personId)) {
      return jsonError('Invalid person ID', 400);
    }

    const parsed = parseBody(affiliationApiSchema, await req.json().catch(() => null));
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { partnerId, role, startDate, endDate } = parsed.data;

    // FK targets checked up front: an unknown person/partner is a 404, never a
    // Prisma P2003 surfacing as a 500.
    const [person, partner] = await Promise.all([
      prisma.person.findUnique({ where: { id: personId }, select: { id: true } }),
      prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } }),
    ]);
    if (!person) return jsonError('Person not found', 404);
    if (!partner) return jsonError('Partner not found', 404);

    const affiliation = await prisma.personAffiliation.create({
      data: {
        personId,
        partnerId,
        role,
        startDate,
        endDate: endDate ?? null
      }
    });

    return NextResponse.json({ affiliation }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/people/[id]/affiliations');
  }
}
