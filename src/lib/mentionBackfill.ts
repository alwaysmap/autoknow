import { prisma } from './db';
import { extractDigestEntities, geminiConfigured, isQuotaError } from './gemini';
import { personDirectorySelect } from './people';
import { deriveMentions, mentionWriteOps } from './mentions';

// #177 — fill ContextMention for rows whose digest predates mention persistence (or was
// ingested keyless). Run with `npm run db:backfill:context-mentions`; like its siblings
// it is deliberately NOT part of `migrate deploy` (docs/CHANGE_PLAYBOOK.md): it spends
// model calls and produces a report an operator reads.
//
// TWO PASSES, priced differently:
//
//   1. RE-RESOLVE (free, always runs): mentions stored with `personId: null` are
//      resolved again against TODAY's directory, through the same `deriveMentions`
//      floor the writers use. A person added after a document mentioned them claims
//      those mentions here — the same recovery path as re-running owner-person after
//      affiliation-email.
//
//   2. EXTRACT (model spend, needs a key): rows with `mentionsExtractedAt: null` get a
//      small entities-only Gemini call over their STORED DIGEST — the digest is the
//      record we retain; re-reading originals is the freshness cron's job. Batched
//      (`limit`, default 50), stops early on a quota refusal (AGENTS lesson 5), and an
//      unusable answer leaves the marker unset so a later run retries. Keyless runs
//      skip this pass and say so rather than marking anything extracted.
//
//      KNOW WHAT PASS 2 CAN RECOVER: the summarizer routinely abstracts people OUT of
//      digests ("bring-up leads", not names — observed live 2026-08-14, three digests
//      in a row nameless), so this pass recovers only what a digest happened to keep,
//      and a low written count over old rows is the expected honest outcome, not a
//      fault. A WATCHED row heals better than this pass can: its next real change
//      re-extracts from FULL text at the ingest/refresh boundary. A snapshot's digest
//      is all it will ever have.
//
// Idempotent by construction: pass 1's WHERE requires personId to still be null, and
// pass 2 only ever touches rows whose marker is still unset.

export interface MentionBackfillReport {
  geminiConfigured: boolean;
  /** Previously-unresolved mentions that now match exactly one person. */
  reResolved: number;
  /** Unresolved mentions remaining after pass 1 (ambiguous or unknown names). */
  stillUnresolved: number;
  /** Rows with `mentionsExtractedAt: null` before this run. */
  eligible: number;
  /** Rows pass 2 attempted this run (≤ limit). */
  scanned: number;
  /** Rows whose model call produced a usable entities object and were written. */
  extracted: number;
  /** Rows with no digest text — marked extracted without spend (nothing to read, ever). */
  emptyDigest: number;
  /** Model call failed or answered unusably; marker left unset so a re-run retries. */
  unusable: number;
  mentionsWritten: number;
  /** Pass 2 stopped early on a quota/spend-cap refusal; re-run later. */
  quotaStopped: boolean;
}

export async function backfillContextMentions(
  opts?: { limit?: number },
): Promise<MentionBackfillReport> {
  const limit = Math.max(0, opts?.limit ?? 50);
  const people = await prisma.person.findMany({ select: personDirectorySelect });

  const report: MentionBackfillReport = {
    geminiConfigured,
    reResolved: 0,
    stillUnresolved: 0,
    eligible: 0,
    scanned: 0,
    extracted: 0,
    emptyDigest: 0,
    unusable: 0,
    mentionsWritten: 0,
    quotaStopped: false,
  };

  // ---- Pass 1: re-resolve, no model involved ----
  const unresolved = await prisma.contextMention.findMany({
    where: { personId: null },
    select: { id: true, rawName: true },
    orderBy: { id: 'asc' },
  });
  for (const mention of unresolved) {
    // Through `deriveMentions` so the floor has ONE spelling: a link is written only
    // when the winning tier holds exactly one person.
    const [derived] = deriveMentions(people, [mention.rawName]);
    if (derived?.personId) {
      // `personId: null` in the WHERE keeps a concurrent write from being overwritten
      // by this scan's stale view — the ownerBackfill discipline.
      const { count } = await prisma.contextMention.updateMany({
        where: { id: mention.id, personId: null },
        data: { personId: derived.personId, basis: derived.basis },
      });
      report.reResolved += count;
    } else {
      report.stillUnresolved++;
    }
  }

  // ---- Pass 2: extract over stored digests ----
  report.eligible = await prisma.contextUrl.count({ where: { mentionsExtractedAt: null } });
  if (!geminiConfigured) return report; // the runner prints the honest sentence

  const rows = await prisma.contextUrl.findMany({
    where: { mentionsExtractedAt: null },
    select: { id: true, ingestedText: true },
    orderBy: { id: 'asc' },
    take: limit,
  });

  for (const row of rows) {
    report.scanned++;
    const digestText = (row.ingestedText ?? '').trim();
    if (!digestText) {
      // Vacuously complete: there is no text this row will ever yield people from.
      await prisma.contextUrl.update({
        where: { id: row.id },
        data: { mentionsExtractedAt: new Date() },
      });
      report.emptyDigest++;
      continue;
    }

    let entities: Awaited<ReturnType<typeof extractDigestEntities>>;
    try {
      entities = await extractDigestEntities(digestText);
    } catch (e) {
      if (isQuotaError(e)) {
        report.quotaStopped = true;
        break;
      }
      report.unusable++;
      continue;
    }
    if (!entities) {
      report.unusable++;
      continue;
    }

    const mentions = deriveMentions(people, entities.people);
    await prisma.$transaction([
      ...mentionWriteOps(prisma, row.id, mentions),
      prisma.contextUrl.update({
        where: { id: row.id },
        data: { mentionsExtractedAt: new Date() },
      }),
    ]);
    report.extracted++;
    report.mentionsWritten += mentions.length;
  }

  return report;
}

/** The report as the operator reads it — remaining work is a number to act on, never a
 *  failure exit (backfill.sh's epilogue explains the reading). */
export function formatMentionBackfillReport(report: MentionBackfillReport): string {
  const lines = [
    `Pass 1 — re-resolve unresolved mentions against today's directory:`,
    `  re-resolved:      ${report.reResolved}`,
    `  still unresolved: ${report.stillUnresolved} (ambiguous or not in the directory — safe, re-runnable)`,
    ``,
    `Pass 2 — extract entities over stored digests (rows never extracted by a real model):`,
    `  eligible: ${report.eligible}`,
  ];
  if (!report.geminiConfigured) {
    lines.push(
      `  SKIPPED — GEMINI_API_KEY is not set. Nothing was marked extracted; re-run with a key.`,
    );
    return lines.join('\n');
  }
  lines.push(
    `  scanned:      ${report.scanned}`,
    `  extracted:    ${report.extracted} (${report.mentionsWritten} mentions written)`,
    `  empty digest: ${report.emptyDigest} (marked complete — nothing to read)`,
    `  unusable:     ${report.unusable} (left unmarked; a re-run retries them)`,
  );
  if (report.extracted > 0 && report.mentionsWritten === 0) {
    lines.push(
      `  (0 written over ${report.extracted} extracted is the expected outcome when digests`,
      `   abstracted names away — watched rows re-extract from FULL text on their next real`,
      `   change; a snapshot's digest is all it will ever have.)`,
    );
  }
  if (report.quotaStopped) {
    lines.push(``, `Stopped early on a Gemini quota/spend-cap refusal — re-run later to continue.`);
  } else if (report.eligible > report.scanned) {
    lines.push(``, `${report.eligible - report.scanned} rows remain — run again (the batch limit bounds each run's spend).`);
  }
  return lines.join('\n');
}
