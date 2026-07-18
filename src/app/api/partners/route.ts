import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { jsonError, serverError } from '../../../lib/api';
import { indexEntity } from '../../../lib/search';
import { parseBody, partnerApiSchema } from '../../../lib/schemas';
import { requireRouteAuth } from '../../../lib/routeAuth';

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
    if (!(await requireRouteAuth(req))) return jsonError('Unauthorized', 401);
    const parsed = parseBody(partnerApiSchema, await req.json());
    if (!parsed.ok) return jsonError(parsed.error, 400);
    const { name, type, region, website, internalDetailsUrl, summary } = parsed.data;

    // Names resolve to ids; unknown names are a 400, never a silent null.
    const pType = await prisma.partnerType.findUnique({ where: { name: type } });
    if (!pType) return jsonError(`Unknown partner type: ${type}`, 400);
    const pReg = await prisma.region.findUnique({ where: { name: region } });
    if (!pReg) return jsonError(`Unknown region: ${region}`, 400);

    const partner = await prisma.partner.create({
      data: {
        name,
        typeId: pType.id,
        regionId: pReg.id,
        website: website ?? null,
        internalDetailsUrl: internalDetailsUrl ?? null,
        summary: summary ?? null
      }
    });
    await indexEntity('partner', partner.id);

    return NextResponse.json({ partner }, { status: 201 });
  } catch (error) {
    return serverError(error, 'POST /api/partners');
  }
}
