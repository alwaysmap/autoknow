import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { jsonError, serverError } from '../../../lib/api';
import { indexEntity } from '../../../lib/search';

export async function GET() {
  try {
    const partners = await prisma.partner.findMany({
      include: {
        type: true,
        region: true
      }
    });
    return NextResponse.json({ partners });
  } catch (error) {
    return serverError(error, 'GET /api/partners');
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, type, region, website, internalDetailsUrl, summary, phone } = body;
    
    if (!name || !type) {
      return jsonError('Missing name or type', 400);
    }

    let typeId = null;
    if (type) {
      const pType = await prisma.partnerType.findUnique({ where: { name: type } });
      if (pType) typeId = pType.id;
    }

    let regionId = null;
    if (region) {
      const pReg = await prisma.region.findUnique({ where: { name: region } });
      if (pReg) regionId = pReg.id;
    }

    const partner = await prisma.partner.create({
      data: {
        name,
        typeId,
        regionId,
        website: website || null,
        internalDetailsUrl: internalDetailsUrl || null,
        summary: summary || null,
        phone: phone || null
      }
    });
    await indexEntity('partner', partner.id);

    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/partners');
  }
}
