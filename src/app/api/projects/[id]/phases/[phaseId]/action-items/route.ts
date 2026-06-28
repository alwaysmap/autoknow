import { NextResponse } from 'next/server';
import { prisma } from '../../../../../../../lib/db';

export async function POST(
  req: Request,
  props: { params: Promise<{ id: string; phaseId: string }> }
) {
  try {
    const { phaseId } = await props.params;
    const pId = parseInt(phaseId, 10);
    if (isNaN(pId)) {
      return NextResponse.json({ error: 'Invalid phase ID' }, { status: 400 });
    }

    const body = await req.json();
    const { description, assignedTo, status, nextStep, linkUrl } = body;

    if (!description || !status) {
      return NextResponse.json({ error: 'Missing description or status' }, { status: 400 });
    }

    const actionItem = await prisma.actionItem.create({
      data: {
        phaseId: pId,
        description,
        assignedTo: assignedTo || null,
        status,
        nextStep: nextStep || 'Undecided',
        linkUrl: linkUrl || null
      }
    });

    return NextResponse.json({ actionItem }, { status: 201 });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
