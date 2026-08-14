import type { Prisma } from '@prisma/client';
import { personDirectorySelect, resolvePersonMatch, type MatchBasis, type PersonLike } from './people';

// #177 — the inferred identity tier. Gemini is already required to extract
// `entities.people` on every digest; these helpers are what stop that answer being
// discarded on the way to the database. `deriveMentions` turns the model's strings into
// ContextMention rows under ONE rule, and both writers (ingest, refresh) plus the
// backfill consume it — a second resolution spelling here is the drift AGENTS lesson 7
// forbids. No 'server-only': the backfill runner executes under plain ts-node, the same
// constraint lib/ownerBackfill lives with.

export interface DerivedMention {
  /** The model's string, verbatim (trimmed). What renders when nothing resolved. */
  rawName: string;
  /** Non-null ONLY when the winning tier held exactly one person — the ownerBackfill
   *  floor. A mention write has no human looking at a form, and a wrong link puts
   *  someone else's document on a named human's page, so ambiguity resolves to
   *  NOTHING rather than to a marked guess (gh-177 acceptance 5). */
  personId: number | null;
  /** Which tier matched — null exactly when personId is. */
  basis: MatchBasis | null;
}

/** A crafted document could have the model emit hundreds of "people"; the row count a
 *  single source may claim is bounded here, not by trusting the model's output. */
const MAX_MENTIONS_PER_SOURCE = 50;

/**
 * Resolve the model's extracted people against the directory. Pure — unit-tested
 * without a database. De-dupes case-insensitively (the model may return one human in
 * two spellings), keeping the first spelling seen; empty strings are dropped.
 */
export function deriveMentions<T extends PersonLike>(
  people: T[],
  rawNames: string[],
): DerivedMention[] {
  const out: DerivedMention[] = [];
  const seen = new Set<string>();
  for (const raw of rawNames) {
    const rawName = raw.trim();
    if (!rawName) continue;
    const key = rawName.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const match = resolvePersonMatch(people, rawName);
    out.push(
      match && match.candidates.length === 1
        ? { rawName, personId: match.candidates[0].id, basis: match.basis }
        : { rawName, personId: null, basis: null },
    );
    if (out.length >= MAX_MENTIONS_PER_SOURCE) break;
  }
  return out;
}

/** The createMany payload for one source's mentions — one spelling of which fields a
 *  mention row carries. */
function mentionRows(
  contextUrlId: number,
  mentions: DerivedMention[],
): Prisma.ContextMentionCreateManyInput[] {
  return mentions.map((m) => ({
    contextUrlId,
    rawName: m.rawName,
    personId: m.personId,
    basis: m.basis,
  }));
}

/**
 * The one spelling of "replace this source's mentions": delete, then recreate, IN THAT
 * ORDER. Returned as lazy PrismaPromises rather than executed, so each writer splices
 * them into its own transaction shape — refresh and the backfill spread them into an
 * array `$transaction`, ingest awaits them sequentially inside its interactive one.
 * `skipDuplicates` because the model can return two spellings that trim to one row.
 */
export function mentionWriteOps(
  db: Pick<Prisma.TransactionClient, 'contextMention'>,
  contextUrlId: number,
  mentions: DerivedMention[],
): Prisma.PrismaPromise<unknown>[] {
  return [
    db.contextMention.deleteMany({ where: { contextUrlId } }),
    ...(mentions.length > 0
      ? [db.contextMention.createMany({ data: mentionRows(contextUrlId, mentions), skipDuplicates: true })]
      : []),
  ];
}

/**
 * `deriveMentions` against the live directory — the one spelling of WHICH directory a
 * mention resolves against (fetched with `personDirectorySelect`, so historical
 * addresses are searched). The ingest and refresh writers use this; the backfill
 * fetches its own directory once and calls `deriveMentions` directly, because it
 * resolves many rows against one snapshot.
 */
export async function deriveMentionsFromDb(
  db: Pick<Prisma.TransactionClient, 'person'>,
  rawNames: string[],
): Promise<DerivedMention[]> {
  return deriveMentions(await db.person.findMany({ select: personDirectorySelect }), rawNames);
}
