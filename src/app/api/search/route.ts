import { NextResponse } from 'next/server';
import { prisma } from '../../../lib/db';
import { generateDeterministicEmbedding } from '../../../lib/vector';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';

    if (!query.trim()) {
      return NextResponse.json({ partners: [], projects: [], people: [] });
    }

    const cleanQuery = query.trim();
    const queryEmbedding = generateDeterministicEmbedding(cleanQuery);
    const vectorStr = `[${queryEmbedding.join(',')}]`;

    // 1. Vector search partners
    const rawPartners = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, name, type, (1 - (embedding <=> $1::vector)) as similarity 
       FROM "Partner" 
       WHERE embedding IS NOT NULL 
       ORDER BY embedding <=> $1::vector 
       LIMIT 5`,
      vectorStr
    );
    const partners = rawPartners.filter(p => p.similarity > 0.15);

    // 2. Vector search projects
    const rawProjects = await prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.name, p."partnerId", p."isArchived", 
              pt.name as "partnerName",
              (1 - (p.embedding <=> $1::vector)) as similarity 
       FROM "Project" p
       JOIN "Partner" pt ON p."partnerId" = pt.id
       WHERE p."isArchived" = false AND p.embedding IS NOT NULL 
       ORDER BY p.embedding <=> $1::vector 
       LIMIT 5`,
      vectorStr
    );
    const projects = rawProjects.filter(p => p.similarity > 0.15).map(p => ({
      ...p,
      partner: { name: p.partnerName }
    }));

    // 3. Vector search people
    const rawPeople = await prisma.$queryRawUnsafe<any[]>(
      `SELECT pe.id, pe.name, pe.email, pe.notes,
              pt.name as "partnerName",
              (1 - (pe.embedding <=> $1::vector)) as similarity 
       FROM "Person" pe
       JOIN "Partner" pt ON pe."currentPartnerId" = pt.id
       WHERE pe.embedding IS NOT NULL 
       ORDER BY pe.embedding <=> $1::vector 
       LIMIT 5`,
      vectorStr
    );
    const people = rawPeople.filter(p => p.similarity > 0.15).map(p => ({
      ...p,
      currentPartner: { name: p.partnerName }
    }));

    return NextResponse.json({
      partners,
      projects,
      people
    });
  } catch (err) {
    console.error('Search failed:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
