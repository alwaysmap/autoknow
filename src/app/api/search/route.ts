import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../lib/db';
import { serverError } from '../../../lib/api';
import { embedText } from '../../../lib/gemini';

export const dynamic = 'force-dynamic';

// Minimum cosine similarity for a vector hit to be surfaced in the header dropdown.
const SIMILARITY_THRESHOLD = 0.15;
const RESULT_LIMIT = 5;

interface PartnerRow {
  id: number;
  name: string;
  type: string | null;
  similarity: number;
}

interface ProjectRow {
  id: number;
  name: string;
  partnerId: number;
  isArchived: boolean;
  partnerName: string;
  similarity: number;
}

interface PersonRow {
  id: number;
  name: string;
  email: string;
  notes: string | null;
  partnerName: string;
  similarity: number;
}

async function toVectorLiteral(text: string): Promise<string> {
  return `[${(await embedText(text)).join(',')}]`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';

    if (!query.trim()) {
      return NextResponse.json({ partners: [], projects: [], people: [] });
    }

    const vectorStr = await toVectorLiteral(query.trim());

    // 1. Vector search partners
    const rawPartners = await prisma.$queryRaw<PartnerRow[]>(Prisma.sql`
      SELECT id, name, type, (1 - (embedding <=> ${vectorStr}::vector)) as similarity
      FROM "Partner"
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${RESULT_LIMIT}
    `);
    const partners = rawPartners.filter((p) => p.similarity > SIMILARITY_THRESHOLD);

    // 2. Vector search projects
    const rawProjects = await prisma.$queryRaw<ProjectRow[]>(Prisma.sql`
      SELECT p.id, p.name, p."partnerId", p."isArchived",
             pt.name as "partnerName",
             (1 - (p.embedding <=> ${vectorStr}::vector)) as similarity
      FROM "Project" p
      JOIN "Partner" pt ON p."partnerId" = pt.id
      WHERE p."isArchived" = false AND p.embedding IS NOT NULL
      ORDER BY p.embedding <=> ${vectorStr}::vector
      LIMIT ${RESULT_LIMIT}
    `);
    const projects = rawProjects
      .filter((p) => p.similarity > SIMILARITY_THRESHOLD)
      .map((p) => ({ ...p, partner: { name: p.partnerName } }));

    // 3. Vector search people
    const rawPeople = await prisma.$queryRaw<PersonRow[]>(Prisma.sql`
      SELECT pe.id, pe.name, pe.email, pe.notes,
             pt.name as "partnerName",
             (1 - (pe.embedding <=> ${vectorStr}::vector)) as similarity
      FROM "Person" pe
      JOIN "Partner" pt ON pe."currentPartnerId" = pt.id
      WHERE pe.embedding IS NOT NULL
      ORDER BY pe.embedding <=> ${vectorStr}::vector
      LIMIT ${RESULT_LIMIT}
    `);
    const people = rawPeople
      .filter((p) => p.similarity > SIMILARITY_THRESHOLD)
      .map((p) => ({ ...p, currentPartner: { name: p.partnerName } }));

    return NextResponse.json({ partners, projects, people });
  } catch (error) {
    return serverError(error, 'GET /api/search');
  }
}
