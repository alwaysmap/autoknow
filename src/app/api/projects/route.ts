import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { jsonError, serverError } from '../../../lib/api';

export async function GET() {
  try {
    const projects = await prisma.project.findMany({
      where: { isArchived: false }
    });
    return NextResponse.json({ projects });
  } catch (error) {
    return serverError(error, 'GET /api/projects');
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, partnerId, ownerName, sopDate, volumeFirstYear } = body;
    
    if (!name || !partnerId) {
      return jsonError('Missing name or partnerId', 400);
    }

    const project = await prisma.project.create({
      data: {
        name,
        partnerId: parseInt(partnerId, 10),
        ownerName: ownerName || null,
        sopDate: sopDate ? new Date(sopDate) : null,
        volumeFirstYear: volumeFirstYear ? parseInt(volumeFirstYear, 10) : 0
      }
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/projects');
  }
}
