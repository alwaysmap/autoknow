import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { embedText } from './gemini';
import { FEED_TYPES, type FeedType, type FeedScope, type FeedItem } from './feed';

// Unified semantic search over everything in AutoKnow. Every searchable thing is
// tagged with a type (partner | program | person | context) in its table's own
// vector(768) column. One UNION query searches across the requested types, filtered
// by scope (ecosystem / a partner / a project). Returns the shared FeedItem shape.

// ---------- Indexing ("tagging" core entities) ----------

async function setEmbedding(
  table: 'Partner' | 'Project' | 'Person' | 'ContextUrl',
  id: number,
  text: string,
) {
  if (!text.trim()) return;
  const vec = `[${(await embedText(text)).join(',')}]`;
  await prisma.$executeRawUnsafe(`UPDATE "${table}" SET embedding = $1::vector WHERE id = $2`, vec, id);
}

/** (Re)embed every searchable record into its vector column so search works. */
export async function reindexAll(): Promise<{ partners: number; programs: number; people: number; context: number }> {
  const partners = await prisma.partner.findMany({
    select: { id: true, name: true, summary: true, type: { select: { name: true } } },
  });
  for (const p of partners) {
    await setEmbedding('Partner', p.id, [p.name, p.type?.name, p.summary].filter(Boolean).join('. '));
  }

  const projects = await prisma.project.findMany({ select: { id: true, name: true, ownerName: true } });
  for (const p of projects) {
    await setEmbedding('Project', p.id, [p.name, p.ownerName].filter(Boolean).join('. '));
  }

  const people = await prisma.person.findMany({ select: { id: true, name: true, email: true, notes: true } });
  for (const p of people) {
    await setEmbedding('Person', p.id, [p.name, p.email, p.notes].filter(Boolean).join('. '));
  }

  const context = await prisma.contextUrl.findMany({ select: { id: true, title: true, ingestedText: true } });
  for (const c of context) {
    await setEmbedding('ContextUrl', c.id, [c.title, c.ingestedText].filter(Boolean).join('. '));
  }

  return {
    partners: partners.length,
    programs: projects.length,
    people: people.length,
    context: context.length,
  };
}

// ---------- Unified search ----------

function branchSql(type: FeedType, vec: string, scope: FeedScope): Prisma.Sql {
  const v = Prisma.sql`${vec}::vector`;
  const partnerId = scope.kind === 'partner' ? scope.id : undefined;
  const projectId = scope.kind === 'project' ? scope.id : undefined;

  switch (type) {
    case 'partner': {
      const where =
        partnerId != null
          ? Prisma.sql`p.id = ${partnerId}`
          : projectId != null
            ? Prisma.sql`p.id = (SELECT "partnerId" FROM "Project" WHERE id = ${projectId})`
            : Prisma.sql`TRUE`;
      return Prisma.sql`
        SELECT 'partner' AS type, p.id, p.name AS title, COALESCE(pt.name, 'Partner') AS subtitle,
               ('/partners/' || p.id) AS url, FALSE AS external, (p.embedding <=> ${v}) AS dist
        FROM "Partner" p LEFT JOIN "PartnerType" pt ON pt.id = p."typeId"
        WHERE p.embedding IS NOT NULL AND ${where}`;
    }
    case 'program': {
      const where =
        projectId != null
          ? Prisma.sql`pr.id = ${projectId}`
          : partnerId != null
            ? Prisma.sql`pr."partnerId" = ${partnerId}`
            : Prisma.sql`TRUE`;
      return Prisma.sql`
        SELECT 'program' AS type, pr.id, pr.name AS title, COALESCE(pa.name, 'Program') AS subtitle,
               ('/projects/' || pr.id) AS url, FALSE AS external, (pr.embedding <=> ${v}) AS dist
        FROM "Project" pr LEFT JOIN "Partner" pa ON pa.id = pr."partnerId"
        WHERE pr.embedding IS NOT NULL AND ${where}`;
    }
    case 'person': {
      const where =
        partnerId != null
          ? Prisma.sql`pe."currentPartnerId" = ${partnerId}`
          : projectId != null
            ? Prisma.sql`FALSE`
            : Prisma.sql`TRUE`;
      return Prisma.sql`
        SELECT 'person' AS type, pe.id, pe.name AS title, pe.email AS subtitle,
               ('/people/' || pe.id) AS url, FALSE AS external, (pe.embedding <=> ${v}) AS dist
        FROM "Person" pe
        WHERE pe.embedding IS NOT NULL AND ${where}`;
    }
    case 'context': {
      const where =
        partnerId != null
          ? Prisma.sql`(c."partnerId" = ${partnerId} OR c."projectId" IN (SELECT id FROM "Project" WHERE "partnerId" = ${partnerId}))`
          : projectId != null
            ? Prisma.sql`(c."projectId" = ${projectId} OR c."phaseId" IN (SELECT id FROM "Phase" WHERE "projectId" = ${projectId}))`
            : Prisma.sql`TRUE`;
      return Prisma.sql`
        SELECT 'context' AS type, c.id, COALESCE(c.title, 'Untitled') AS title, c.type AS subtitle,
               c.url AS url, TRUE AS external, (c.embedding <=> ${v}) AS dist
        FROM "ContextUrl" c
        WHERE c.embedding IS NOT NULL AND ${where}`;
    }
  }
}

export async function unifiedSearch(
  query: string,
  opts: { types?: FeedType[]; scope?: FeedScope; limit?: number } = {},
): Promise<FeedItem[]> {
  if (!query.trim()) return [];
  const types = opts.types?.length ? opts.types : FEED_TYPES;
  const limit = opts.limit ?? 20;
  const scope = opts.scope ?? { kind: 'ecosystem' };

  try {
    const vec = `[${(await embedText(query)).join(',')}]`;
    const branches = types.map((t) => branchSql(t, vec, scope));
    const unioned = Prisma.join(branches, ' UNION ALL ');

    const rows = await prisma.$queryRaw<
      { type: FeedType; id: number; title: string; subtitle: string | null; url: string; external: boolean; dist: number }[]
    >(Prisma.sql`
      SELECT type, id, title, subtitle, url, external, dist
      FROM ( ${unioned} ) AS hits
      ORDER BY dist ASC
      LIMIT ${limit}
    `);

    return rows.map((r) => ({
      id: `${r.type}-${r.id}`,
      kind: r.type,
      title: r.title,
      subtitle: r.subtitle,
      detail: null,
      href: r.url,
      external: r.external,
      timestamp: null,
      score: 1 - r.dist,
    }));
  } catch (err) {
    console.error('Unified search failed:', err);
    return [];
  }
}
