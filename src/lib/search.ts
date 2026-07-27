import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { embedForStorage, embedForQuery, geminiConfigured } from './gemini';
import { personIsAtPartnerAsOfSql } from './profiles';
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
  // Storage: throws rather than substituting the pedestal (see embedForStorage).
  const vec = `[${(await embedForStorage(text)).join(',')}]`;
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

// ---- Result-quality gating (why "Honda" surfaced under a "Volvo" search) ----
// A SEMANTIC-ONLY hit — one the query's own words touch nowhere, matched purely by
// embedding proximity — is the only source of that noise: a lexical hit contains the
// query text, so it is never an unrelated brand. So the floors below gate ONLY
// semantic-only rows; a lexical row is always kept, and searching a common word still
// returns every record that literally contains it.
//   - SEM_MIN     absolute floor: under it a semantic match is too weak to show at all.
//   - REL_FACTOR  relative floor (× the top score): when a strong match exists (an
//     exact name is 1.0) everything far beneath it reads as noise and drops; when the
//     whole set is weak-but-even (a descriptive query with no lexical anchor) the floor
//     sinks with the top score and recall is preserved.
// Deliberately conservative — tune against real query telemetry, not upward by guess.
const SEM_MIN = 0.4;
const REL_FACTOR = 0.65;

// The deterministic dev/test fallback embedding (lib/embedding-fallback) is an
// all-positive vector, so EVERY record sits ~0.75 cosine from EVERY query regardless
// of text — a uniform pedestal, not signal. When Gemini is unconfigured we therefore
// switch the semantic channel off entirely rather than threshold that pedestal, which
// would otherwise bury the lexical ranking under unrelated rows.
function blend(
  lex: Prisma.Sql,
  embedding: Prisma.Sql,
  v: Prisma.Sql,
  semantic: boolean,
): { score: Prisma.Sql; eligible: Prisma.Sql } {
  if (!semantic) return { score: lex, eligible: Prisma.sql`${lex} > 0` };
  const sem = semSql(embedding, v);
  return {
    score: Prisma.sql`GREATEST(${lex}, ${sem})`,
    eligible: Prisma.sql`(${embedding} IS NOT NULL OR ${lex} > 0)`,
  };
}

// An explicitly empty scope. A scope with no defined predicate must match NOTHING; the
// failure mode this exists to prevent is falling through to `TRUE` and silently widening
// a narrowed query to the whole ecosystem.
const MATCHES_NOTHING = Prisma.sql`FALSE`;

function branchSql(type: FeedType, q: string, vec: string, scope: FeedScope, semantic: boolean): Prisma.Sql {
  const v = Prisma.sql`${vec}::vector`;
  const partnerId = scope.kind === 'partner' ? scope.id : undefined;
  const projectId = scope.kind === 'project' ? scope.id : undefined;
  // A person scope narrows by ACTOR, and only ONE of the four searchable types has a
  // defined answer to "…within this person": the person themself. The other three would
  // each need a rule nobody has agreed (every partner she has been at? every program she
  // touched?), and the alias filter the activity feed uses is not expressible here
  // without a second query per search — so they match nothing.
  //
  // No in-app surface reaches these arms: the person page has no scoped entity search,
  // because design.md §2b allows exactly one search surface and it is `/`. The real
  // caller is `/api/search?personId=` WITHOUT a `q`, and that path is activity, not this
  // function. autoknow-0f8 covers giving the three a meaning, or deleting these arms.
  const personId = scope.kind === 'person' ? scope.id : undefined;

  switch (type) {
    case 'partner': {
      const where =
        partnerId != null
          ? Prisma.sql`p.id = ${partnerId}`
          : projectId != null
            ? Prisma.sql`p.id = (SELECT "partnerId" FROM "Project" WHERE id = ${projectId})`
            : personId != null
              ? MATCHES_NOTHING
              : Prisma.sql`TRUE`;
      const lex = lexSql(q, Prisma.sql`p.name`, [Prisma.sql`pt.name`, Prisma.sql`p.summary`]);
      const { score, eligible } = blend(lex, Prisma.sql`p.embedding`, v, semantic);
      return Prisma.sql`
        SELECT 'partner' AS type, p.id, p.name AS title, COALESCE(pt.name, 'Partner') AS subtitle,
               ('/partners/' || p.id) AS url, FALSE AS external, ${score} AS score, (${lex} > 0) AS "lexHit"
        FROM "Partner" p LEFT JOIN "PartnerType" pt ON pt.id = p."typeId"
        WHERE ${eligible} AND ${where}`;
    }
    case 'program': {
      const where =
        projectId != null
          ? Prisma.sql`pr.id = ${projectId}`
          : partnerId != null
            ? Prisma.sql`pr."partnerId" = ${partnerId}`
            : personId != null
              ? MATCHES_NOTHING
              : Prisma.sql`TRUE`;
      const lex = lexSql(q, Prisma.sql`pr.name`, [Prisma.sql`pr."ownerName"`, Prisma.sql`pa.name`]);
      const { score, eligible } = blend(lex, Prisma.sql`pr.embedding`, v, semantic);
      return Prisma.sql`
        SELECT 'program' AS type, pr.id, pr.name AS title, COALESCE(pa.name, 'Program') AS subtitle,
               ('/programs/' || pr.id) AS url, FALSE AS external, ${score} AS score, (${lex} > 0) AS "lexHit"
        FROM "Project" pr LEFT JOIN "Partner" pa ON pa.id = pr."partnerId"
        WHERE ${eligible} AND ${where}`;
    }
    case 'person': {
      // Who is at this partner TODAY (#127 E5). This was `pe."currentPartnerId" = …` — a
      // cache, and one the member/property lint selectors could never have seen, because
      // inside `Prisma.sql` a column name is just text; that is exactly why the guard
      // also carries a `TemplateElement` selector. Searching a partner's scope returned
      // people who had not started and missed people who had. The predicate is
      // `lib/profiles`', not spelled again here.
      const where =
        partnerId != null
          ? personIsAtPartnerAsOfSql(Prisma.sql`pe.id`, partnerId)
          : projectId != null
            ? MATCHES_NOTHING
            : personId != null
              // The one type a person scope CAN answer: themself.
              ? Prisma.sql`pe.id = ${personId}`
              : Prisma.sql`TRUE`;
      const lex = lexSql(q, Prisma.sql`pe.name`, [Prisma.sql`pe.email`, Prisma.sql`pe.notes`]);
      const { score, eligible } = blend(lex, Prisma.sql`pe.embedding`, v, semantic);
      return Prisma.sql`
        SELECT 'person' AS type, pe.id, pe.name AS title, pe.email AS subtitle,
               ('/people/' || pe.id) AS url, FALSE AS external, ${score} AS score, (${lex} > 0) AS "lexHit"
        FROM "Person" pe
        WHERE ${eligible} AND ${where}`;
    }
    case 'context': {
      const where =
        partnerId != null
          ? Prisma.sql`(c."partnerId" = ${partnerId} OR c."projectId" IN (SELECT id FROM "Project" WHERE "partnerId" = ${partnerId}))`
          : projectId != null
            ? Prisma.sql`(c."projectId" = ${projectId} OR c."phaseId" IN (SELECT id FROM "Phase" WHERE "projectId" = ${projectId}))`
            : personId != null
              ? MATCHES_NOTHING
              : Prisma.sql`TRUE`;
      const lex = lexSql(q, Prisma.sql`COALESCE(c.title, '')`, [Prisma.sql`c."ingestedText"`]);
      const { score, eligible } = blend(lex, Prisma.sql`c.embedding`, v, semantic);
      return Prisma.sql`
        SELECT 'context' AS type, c.id, COALESCE(c.title, 'Untitled') AS title, c.type AS subtitle,
               c.url AS url, TRUE AS external, ${score} AS score, (${lex} > 0) AS "lexHit"
        FROM "ContextUrl" c
        WHERE ${eligible} AND ${where}`;
    }
  }
}

// Every search pays one Gemini embedding round trip for the query. Cache the vector
// by normalized query text — searches repeat (same term across scopes, back-button,
// re-filter) and the embedding is deterministic. Bounded so it can't grow unbounded.
const QUERY_EMBED_CACHE = new Map<string, number[]>();
const QUERY_EMBED_CACHE_MAX = 500;
/** Null when no semantic vector is available (unconfigured, or the model refused — a
 *  spend cap, say). The caller then ranks lexical-only rather than failing the search.
 *  Only successes are cached, so a cap does not pin a query to lexical for the rest of
 *  the process once quota returns. */
async function embedQuery(q: string): Promise<number[] | null> {
  const key = q.toLowerCase();
  const hit = QUERY_EMBED_CACHE.get(key);
  if (hit) return hit;
  const vec = await embedForQuery(q);
  if (!vec) return null;
  if (QUERY_EMBED_CACHE.size >= QUERY_EMBED_CACHE_MAX) {
    QUERY_EMBED_CACHE.delete(QUERY_EMBED_CACHE.keys().next().value!); // evict oldest
  }
  QUERY_EMBED_CACHE.set(key, vec);
  return vec;
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
    // Real embeddings only: the dev/test fallback is a uniform pedestal, not signal.
    // The channel is off when Gemini is unconfigured AND when it is configured but the
    // query embed did not come back — a spend cap must degrade the ranking, never fail
    // the search or blend in a constant ~0.75.
    const queryVec = geminiConfigured ? await embedQuery(q) : null;
    const semantic = queryVec !== null;
    const vec = semantic ? `[${queryVec.join(',')}]` : '';
    const branches = types.map((t) => branchSql(t, q, vec, scope, semantic));
    const unioned = Prisma.join(branches, ' UNION ALL ');

    const rows = await prisma.$queryRaw<
      { type: FeedType; id: number; title: string; subtitle: string | null; url: string; external: boolean; score: number; lexHit: boolean }[]
    >(Prisma.sql`
      SELECT type, id, title, subtitle, url, external, score, "lexHit"
      FROM ( ${unioned} ) AS hits
      ORDER BY score DESC, title ASC
      LIMIT ${limit}
    `);

    // Drop semantic-only noise: a row the query's own words never hit must clear the
    // higher of the absolute and top-relative floors. Lexical hits are always kept.
    const top = rows[0]?.score ?? 0;
    const semFloor = Math.max(SEM_MIN, top * REL_FACTOR);
    const kept = rows.filter((r) => r.lexHit || r.score >= semFloor);

    return kept.map((r) => ({
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
