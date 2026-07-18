import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { jsonError, serverError } from '../../../lib/api';
import { indexEntity } from '../../../lib/search';
import { parseBody, personApiSchema } from '../../../lib/schemas';
import { requireRouteAuth } from '../../../lib/routeAuth';

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
    const { name, email, currentPartnerId, notes } = parsed.data;

    const person = await prisma.person.create({
      data: {
        name,
        email,
        currentPartnerId,
        notes: notes ?? null
      }
    });
    await indexEntity('person', person.id);

    return NextResponse.json({ person }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/people');
  }
}
