import { NextResponse } from 'next/server';
import { prisma } from '../../../../../lib/db';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await props.params;
    const personId = parseInt(id, 10);
    if (isNaN(personId)) {
      return NextResponse.json({ error: 'Invalid person ID' }, { status: 400 });
    }

    const body = await req.json();
    const { partnerId, role, startDate, endDate } = body;

    if (!partnerId || !role || !startDate) {
      return NextResponse.json({ error: 'Missing partnerId, role, or startDate' }, { status: 400 });
    }

    const affiliation = await prisma.personAffiliation.create({
      data: {
        personId,
        partnerId: parseInt(partnerId, 10),
        role,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null
      }
    });

    return NextResponse.json({ affiliation }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
