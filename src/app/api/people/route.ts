import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';

export async function GET() {
  try {
    const people = await prisma.person.findMany();
    return NextResponse.json({ people });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, currentPartnerId, notes } = body;

    if (!name || !email || !currentPartnerId) {
      return NextResponse.json({ error: 'Missing name, email, or currentPartnerId' }, { status: 400 });
    }

    const person = await prisma.person.create({
      data: {
        name,
        email,
        currentPartnerId: parseInt(currentPartnerId, 10),
        notes: notes || null
      }
    });

    return NextResponse.json({ person }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
