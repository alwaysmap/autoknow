import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { jsonError, serverError } from '../../../lib/api';
import { escalationApiSchema, parseBody } from '../../../lib/schemas';
import { requireRouteAuth } from '../../../lib/routeAuth';
import { isClosed, type EscalationStatus } from '../../../lib/escalation';

// The escalation collection route (#245 part a), mirroring `api/partners/route.ts`.
//
// It exists so the SEEDS have a mutation boundary to go through rather than a raw
// `prisma.escalation.create` — the same reason every other seeded entity has one
// (docs/CRITICAL_CHAIN_VIEW_PLAN.md §6): seeded data then inherits zod validation and the
// referential checks below, so it is correct by construction instead of by whoever wrote
// the fixture. It is also what part (b)'s chat trigger writes through.

export async function GET() {
  try {
    const escalations = await prisma.escalation.findMany({
      include: {
        partner: { select: { id: true, name: true } },
        project: { select: { id: true, name: true } },
        ownerPerson: { select: { id: true, name: true } },
        decisionMakerPerson: { select: { id: true, name: true } },
        requestedOfPerson: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ escalations });
  } catch (error) {
    return serverError(error, 'GET /api/escalations');
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireRouteAuth(req))) return jsonError('Unauthorized', 401);
    const parsed = parseBody(escalationApiSchema, await req.json());
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { status, ...data } = parsed.data;

    // Referential checks the schema cannot make: zod proves an id is a positive integer,
    // never that it names a row. An unknown id is a 400 and never a silent null — the
    // `partnerApiSchema` rule for unknown NAMES, applied to ids, and it matters more here
    // because a dropped `partnerId` would leave an escalation attached to nothing while
    // reporting 201.
    const refs: Array<[string, number | null | undefined, () => Promise<unknown>]> = [
      ['partnerId', data.partnerId, () => prisma.partner.findUnique({ where: { id: data.partnerId! }, select: { id: true } })],
      ['projectId', data.projectId, () => prisma.project.findUnique({ where: { id: data.projectId! }, select: { id: true } })],
      ['ownerPersonId', data.ownerPersonId, () => prisma.person.findUnique({ where: { id: data.ownerPersonId! }, select: { id: true } })],
      ['decisionMakerPersonId', data.decisionMakerPersonId, () => prisma.person.findUnique({ where: { id: data.decisionMakerPersonId! }, select: { id: true } })],
      ['requestedOfPersonId', data.requestedOfPersonId, () => prisma.person.findUnique({ where: { id: data.requestedOfPersonId! }, select: { id: true } })],
      ['contextUrlId', data.contextUrlId, () => prisma.contextUrl.findUnique({ where: { id: data.contextUrlId! }, select: { id: true } })],
      ['duplicateOfId', data.duplicateOfId, () => prisma.escalation.findUnique({ where: { id: data.duplicateOfId! }, select: { id: true } })],
    ];
    for (const [field, value, lookup] of refs) {
      if (value == null) continue;
      if (!(await lookup())) return jsonError(`Unknown ${field}: ${value}`, 400);
    }

    const escalation = await prisma.escalation.create({
      data: {
        ...data,
        status,
        // Derived, never accepted: an escalation created already-closed is a real case
        // (seeding a resolved one), and its `closedAt` is a fact about that write, not a
        // field a caller supplies. Same rule as the status action.
        closedAt: status && isClosed(status as EscalationStatus) ? new Date() : null,
      },
    });

    return NextResponse.json({ escalation }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/escalations');
  }
}
