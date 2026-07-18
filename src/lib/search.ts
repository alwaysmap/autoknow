import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { embedText } from './gemini';
import { FEED_TYPES, type FeedType, type FeedScope, type FeedItem } from './feed';

// Unified search over everything in AutoKnow. Every searchable thing is tagged with
// a type (partner | program | person | context) in its table's own vector(768) column.
// One UNION query searches across the requested types, filtered by scope (ecosystem /
// a partner / a project). Returns the shared FeedItem shape.
//
// Retrieval is blended: a lexical pass (exact / prefix / word-start / substring over
// names and key text fields) and a semantic pgvector pass score every row, and the
// stronger signal wins. Lexical is the precision channel — an exact name match always
// outranks a fuzzy semantic hit, and a record that has not been embedded yet is still
// findable. Semantic is the recall channel — descriptive queries ("german tier-1
// brake supplier") reach records whose words never appear in the query.

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

async function entityIndexText(kind: FeedType, id: number): Promise<{ table: 'Partner' | 'Project' | 'Person' | 'ContextUrl'; text: string } | null> {
  switch (kind) {
    case 'partner': {
      const p = await prisma.partner.findUnique({
        where: { id },
        select: { name: true, summary: true, type: { select: { name: true } } },
      });
      return p && { table: 'Partner', text: [p.name, p.type?.name, p.summary].filter(Boolean).join('. ') };
    }
    case 'program': {
      const p = await prisma.project.findUnique({ where: { id }, select: { name: true, ownerName: true } });
      return p && { table: 'Project', text: [p.name, p.ownerName].filter(Boolean).join('. ') };
    }
    case 'person': {
      const p = await prisma.person.findUnique({ where: { id }, select: { name: true, email: true, notes: true } });
      return p && { table: 'Person', text: [p.name, p.email, p.notes].filter(Boolean).join('. ') };
    }
    case 'context': {
      const c = await prisma.contextUrl.findUnique({ where: { id }, select: { title: true, ingestedText: true } });
      return c && { table: 'ContextUrl', text: [c.title, c.ingestedText].filter(Boolean).join('. ') };
    }
  }
}

/**
 * Embed one entity into its vector column. Called from create/update flows; never
 * throws — a failed embedding must not fail the write, and the record still matches
 * lexically until the next reindex picks it up.
 */
export async function indexEntity(kind: FeedType, id: number): Promise<void> {
  try {
    const target = await entityIndexText(kind, id);
    if (target) await setEmbedding(target.table, id, target.text);
  } catch (err) {
    console.error(`indexEntity(${kind}, ${id}) failed:`, err);
  }
}

/**
 * (Re)embed every searchable record into its vector column so search works.
 * Batched reads (one query per table, not a findUnique per record) and a small
 * embed-concurrency pool: the serial version was a 5+ minute request at ~1.5k
 * records; unbounded parallelism would trip Gemini rate limits instead.
 */
export async function reindexAll(): Promise<{ partners: number; programs: number; people: number; context: number }> {
  const [partners, projects, people, context] = await Promise.all([
    prisma.partner.findMany({ select: { id: true, name: true, summary: true, type: { select: { name: true } } } }),
    prisma.project.findMany({ select: { id: true, name: true, ownerName: true } }),
    prisma.person.findMany({ select: { id: true, name: true, email: true, notes: true } }),
    prisma.contextUrl.findMany({ select: { id: true, title: true, ingestedText: true } }),
  ]);

  const joined = (parts: (string | null | undefined)[]) => parts.filter(Boolean).join('. ');
  const jobs: { table: 'Partner' | 'Project' | 'Person' | 'ContextUrl'; id: number; text: string }[] = [
    ...partners.map((p) => ({ table: 'Partner' as const, id: p.id, text: joined([p.name, p.type?.name, p.summary]) })),
    ...projects.map((p) => ({ table: 'Project' as const, id: p.id, text: joined([p.name, p.ownerName]) })),
    ...people.map((p) => ({ table: 'Person' as const, id: p.id, text: joined([p.name, p.email, p.notes]) })),
    ...context.map((c) => ({ table: 'ContextUrl' as const, id: c.id, text: joined([c.title, c.ingestedText]) })),
  ];

  const CONCURRENCY = 4;
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await setEmbedding(job.table, job.id, job.text);
      } catch (err) {
        // One failed record must not abort the sweep; it stays lexically findable.
        console.error(`reindex ${job.table}#${job.id} failed:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, () => worker()));

  return {
    partners: partners.length,
    programs: projects.length,
    people: people.length,
    context: context.length,
  };
}

// ---------- Unified search ----------

/** Escape LIKE/ILIKE wildcards so the user's query matches literally. */
function likeLiteral(q: string): string {
  return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Lexical relevance in [0,1]. The primary column (the record's display name) is
 * graded exact > prefix > word-start > substring; secondary text columns count as
 * weaker substring evidence. NULL columns fall through to 0.
 */
function lexSql(q: string, primary: Prisma.Sql, secondaries: Prisma.Sql[]): Prisma.Sql {
  const literal = likeLiteral(q);
  const contains = `%${literal}%`;
  const primaryScore = Prisma.sql`
    CASE
      WHEN lower(${primary}) = lower(${q}) THEN 1.0
      WHEN ${primary} ILIKE ${`${literal}%`} THEN 0.92
      WHEN ${primary} ILIKE ${`% ${literal}%`} THEN 0.85
      WHEN ${primary} ILIKE ${contains} THEN 0.75
      ELSE 0.0
    END`;
  const secondaryScores = secondaries.map(
    (col) => Prisma.sql`CASE WHEN ${col} ILIKE ${contains} THEN 0.6 ELSE 0.0 END`,
  );
  return Prisma.sql`GREATEST(${Prisma.join([primaryScore, ...secondaryScores], ', ')})::float8`;
}

/** Semantic relevance in [0,1]: cosine similarity, 0 when the row is not embedded yet. */
function semSql(embedding: Prisma.Sql, v: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`CASE WHEN ${embedding} IS NULL THEN 0.0::float8
                         ELSE GREATEST(0.0, 1.0 - (${embedding} <=> ${v}))::float8 END`;
}

function branchSql(type: FeedType, q: string, vec: string, scope: FeedScope): Prisma.Sql {
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
      const lex = lexSql(q, Prisma.sql`p.name`, [Prisma.sql`pt.name`, Prisma.sql`p.summary`]);
      const sem = semSql(Prisma.sql`p.embedding`, v);
      return Prisma.sql`
        SELECT 'partner' AS type, p.id, p.name AS title, COALESCE(pt.name, 'Partner') AS subtitle,
               ('/partners/' || p.id) AS url, FALSE AS external, GREATEST(${lex}, ${sem}) AS score
        FROM "Partner" p LEFT JOIN "PartnerType" pt ON pt.id = p."typeId"
        WHERE (p.embedding IS NOT NULL OR ${lex} > 0) AND ${where}`;
    }
    case 'program': {
      const where =
        projectId != null
          ? Prisma.sql`pr.id = ${projectId}`
          : partnerId != null
            ? Prisma.sql`pr."partnerId" = ${partnerId}`
            : Prisma.sql`TRUE`;
      const lex = lexSql(q, Prisma.sql`pr.name`, [Prisma.sql`pr."ownerName"`, Prisma.sql`pa.name`]);
      const sem = semSql(Prisma.sql`pr.embedding`, v);
      return Prisma.sql`
        SELECT 'program' AS type, pr.id, pr.name AS title, COALESCE(pa.name, 'Program') AS subtitle,
               ('/programs/' || pr.id) AS url, FALSE AS external, GREATEST(${lex}, ${sem}) AS score
        FROM "Project" pr LEFT JOIN "Partner" pa ON pa.id = pr."partnerId"
        WHERE (pr.embedding IS NOT NULL OR ${lex} > 0) AND ${where}`;
    }
    case 'person': {
      const where =
        partnerId != null
          ? Prisma.sql`pe."currentPartnerId" = ${partnerId}`
          : projectId != null
            ? Prisma.sql`FALSE`
            : Prisma.sql`TRUE`;
      const lex = lexSql(q, Prisma.sql`pe.name`, [Prisma.sql`pe.email`, Prisma.sql`pe.notes`]);
      const sem = semSql(Prisma.sql`pe.embedding`, v);
      return Prisma.sql`
        SELECT 'person' AS type, pe.id, pe.name AS title, pe.email AS subtitle,
               ('/people/' || pe.id) AS url, FALSE AS external, GREATEST(${lex}, ${sem}) AS score
        FROM "Person" pe
        WHERE (pe.embedding IS NOT NULL OR ${lex} > 0) AND ${where}`;
    }
    case 'context': {
      const where =
        partnerId != null
          ? Prisma.sql`(c."partnerId" = ${partnerId} OR c."projectId" IN (SELECT id FROM "Project" WHERE "partnerId" = ${partnerId}))`
          : projectId != null
            ? Prisma.sql`(c."projectId" = ${projectId} OR c."phaseId" IN (SELECT id FROM "Phase" WHERE "projectId" = ${projectId}))`
            : Prisma.sql`TRUE`;
      const lex = lexSql(q, Prisma.sql`COALESCE(c.title, '')`, [Prisma.sql`c."ingestedText"`]);
      const sem = semSql(Prisma.sql`c.embedding`, v);
      return Prisma.sql`
        SELECT 'context' AS type, c.id, COALESCE(c.title, 'Untitled') AS title, c.type AS subtitle,
               c.url AS url, TRUE AS external, GREATEST(${lex}, ${sem}) AS score
        FROM "ContextUrl" c
        WHERE (c.embedding IS NOT NULL OR ${lex} > 0) AND ${where}`;
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
    const q = query.trim();
    const vec = `[${(await embedText(q)).join(',')}]`;
    const branches = types.map((t) => branchSql(t, q, vec, scope));
    const unioned = Prisma.join(branches, ' UNION ALL ');

    const rows = await prisma.$queryRaw<
      { type: FeedType; id: number; title: string; subtitle: string | null; url: string; external: boolean; score: number }[]
    >(Prisma.sql`
      SELECT type, id, title, subtitle, url, external, score
      FROM ( ${unioned} ) AS hits
      ORDER BY score DESC, title ASC
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
      score: Math.max(0, Math.min(1, r.score)),
    }));
  } catch (err) {
    console.error('Unified search failed:', err);
    return [];
  }
}
