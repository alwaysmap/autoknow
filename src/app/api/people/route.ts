import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { jsonError, serverError } from '../../../lib/api';
import { indexEntity } from '../../../lib/search';

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
    const body = await req.json();
    const { name, email, currentPartnerId, notes } = body;

    if (!name || !email || !currentPartnerId) {
      return jsonError('Missing name, email, or currentPartnerId', 400);
    }

    const person = await prisma.person.create({
      data: {
        name,
        email,
        currentPartnerId: parseInt(currentPartnerId, 10),
        notes: notes || null
      }
    });
    await indexEntity('person', person.id);

    return NextResponse.json({ person }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/people');
  }
}
