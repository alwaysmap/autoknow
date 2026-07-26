import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { jsonError, serverError } from '../../../lib/api';
import { indexEntity } from '../../../lib/search';
import { parseBody, personApiSchema } from '../../../lib/schemas';
import { requireRouteAuth } from '../../../lib/routeAuth';
import { createPersonAt } from '../../../lib/profiles';

export async function GET() {
  try {
    const people = await prisma.person.findMany();
    return NextResponse.json({ people });
  } catch (error) {
    return serverError(error, 'GET /api/people');
  }
}

export async function POST(req: Request) {
  try {
    if (!(await requireRouteAuth(req))) return jsonError('Unauthorized', 401);
    const parsed = parseBody(personApiSchema, await req.json());
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { name, email, currentPartnerId, notes, role, startDate } = parsed.data;

    // Opens the employment period as well as writing the cache. This route used to
    // create the Person alone, so a person added through the API had no affiliation at
    // all — harmless while the cache was what surfaces displayed, and "no company
    // anywhere" once #127 E5 made the period the answer.
    const person = await createPersonAt({ name, email, notes, partnerId: currentPartnerId, role, startDate });
    await indexEntity('person', person.id);

    return NextResponse.json({ person }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/people');
  }
}
