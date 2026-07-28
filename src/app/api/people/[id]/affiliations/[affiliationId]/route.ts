import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../lib/db';
import { jsonError, serverError } from '../../../../../../lib/api';
import { requireRouteAuth } from '../../../../../../lib/routeAuth';

// The remedy the overlap refusal in ../route.ts names (autoknow-2of): POST /api/people
// auto-opens a "Member from today" period the caller never asked for, so laying down a
// real career means removing that period — which nothing exposed until this route.
// Deleting a person's ONLY period is legal on purpose: it is the first step of exactly
// that sequence, and a gap is a real career state (#124 §2), not an error.
//
// `Person.currentPartnerId` is left alone. It is a non-nullable cache read only by
// `deletePartner` as an FK-breakage check (ADR
// currentpartnerid-is-a-cache-affiliations-are-the-truth); no display path reads it, and
// there is no "no partner" value for it to take.
export async function DELETE(
  req: Request,
  props: { params: Promise<{ id: string; affiliationId: string }> }
) {
  try {
    if (!(await requireRouteAuth(req))) return jsonError('Unauthorized', 401);

    const { id, affiliationId: rawAffiliationId } = await props.params;
    const personId = parseInt(id, 10);
    const affiliationId = parseInt(rawAffiliationId, 10);
    if (isNaN(personId)) return jsonError('Invalid person ID', 400);
    if (isNaN(affiliationId)) return jsonError('Invalid affiliation ID', 400);

    // Parentage verified like the nested phase routes — one compound where, so a period
    // that exists but belongs to another person is a 404, never a cross-person delete.
    const affiliation = await prisma.personAffiliation.findFirst({
      where: { id: affiliationId, personId },
    });
    if (!affiliation) return jsonError('Affiliation not found', 404);

    await prisma.personAffiliation.delete({ where: { id: affiliationId } });
    return NextResponse.json({ affiliation });
  } catch (error) {
    return serverError(error, 'DELETE /api/people/[id]/affiliations/[affiliationId]');
  }
}
