import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';
import { jsonError, serverError } from '../../../../../lib/api';
import { requireRouteAuth } from '../../../../../lib/routeAuth';
import { parseBody, affiliationApiSchema } from '../../../../../lib/schemas';
import { overlappingPeriods } from '../../../../../lib/profiles';

/** A date the way the API speaks them — the day, not the instant. */
const day = (d: Date) => d.toISOString().slice(0, 10);

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
    const { partnerId, role, startDate, endDate, email } = parsed.data;

    // FK targets checked up front: an unknown person/partner is a 404, never a
    // Prisma P2003 surfacing as a 500.
    const [person, partner] = await Promise.all([
      prisma.person.findUnique({ where: { id: personId }, select: { id: true } }),
      prisma.partner.findUnique({ where: { id: partnerId }, select: { id: true } }),
    ]);
    if (!person) return jsonError('Person not found', 404);
    if (!partner) return jsonError('Partner not found', 404);

    // One person holds one job at an instant. Overlaps used to be accepted here and every
    // resolver could only make them deterministic, never correct (autoknow-2of) — this is
    // the fail-closed guard the write should have shipped with, and it names the periods
    // in the way plus the remedy, because /api/people auto-opens a period the caller never
    // asked for and this refusal is where they find out it exists.
    const clashes = await overlappingPeriods(personId, startDate, endDate ?? null);
    if (clashes.length > 0) {
      const named = clashes
        .map((c) => `${c.partner.name} as ${c.role}, ${day(c.startDate)} → ${c.endDate ? day(c.endDate) : 'open'} (affiliation ${c.id})`)
        .join('; ');
      return jsonError(
        `Overlaps an existing period: ${named}. A person holds one job at an instant — ` +
          `end or delete the covering period first (DELETE /api/people/${personId}/affiliations/{affiliationId}).`,
        409
      );
    }

    const affiliation = await prisma.personAffiliation.create({
      data: {
        personId,
        partnerId,
        role,
        startDate,
        endDate: endDate ?? null,
        // The address held during this period (#127 E8). Omitting it records a period
        // whose address is UNKNOWN, which is the honest state for most history and what
        // `db:backfill:affiliation-email` reports rather than guesses at.
        email: email ?? null
      }
    });

    return NextResponse.json({ affiliation }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/people/[id]/affiliations');
  }
}
