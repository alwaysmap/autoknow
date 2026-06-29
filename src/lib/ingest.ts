import 'server-only';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import {
  embedText,
  summarizeDocument,
  classifyContext,
  digestToText,
  type Classification,
  type DocDigest,
} from './gemini';
import { parseGoogleDocId, fetchGoogleDocText } from './google-docs';

export interface IngestResult {
  ok: boolean;
  error?: string;
  title?: string;
  digest?: DocDigest;
  attachedTo?: { kind: 'project' | 'partner' | 'none'; id: number | null; name: string | null };
  contextUrlId?: number;
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return (firstLine || 'Untitled document').slice(0, 120);
}

/** Distill, classify, embed, and store one document's digest as a ContextUrl. */
async function ingestText(opts: { url: string; title: string; text: string }): Promise<IngestResult> {
  const digest = await summarizeDocument(opts.text);
  const digestText = digestToText(digest);

  const [projects, partners] = await Promise.all([
    prisma.project.findMany({ where: { isArchived: false }, select: { id: true, name: true } }),
    prisma.partner.findMany({ select: { id: true, name: true } }),
  ]);

  const classification = await classifyContext(digest, projects, partners);

  // Trust the classifier's *choice of entity* only if the id actually exists.
  let projectId: number | null = null;
  let partnerId: number | null = null;
  let attached: Classification = { kind: 'none', id: null, name: null, confidence: classification.confidence };

  if (classification.kind === 'project' && projects.some((p) => p.id === classification.id)) {
    projectId = classification.id;
    attached = { ...classification, name: projects.find((p) => p.id === classification.id)!.name };
  } else if (classification.kind === 'partner' && partners.some((p) => p.id === classification.id)) {
    partnerId = classification.id;
    attached = { ...classification, name: partners.find((p) => p.id === classification.id)!.name };
  }

  const vectorStr = `[${(await embedText(digestText)).join(',')}]`;

  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    INSERT INTO "ContextUrl" ("projectId", "partnerId", "url", "type", "title", "ingestedText", "embedding")
    VALUES (${projectId}, ${partnerId}, ${opts.url}, ${'Doc'}, ${opts.title}, ${digestText}, ${vectorStr}::vector)
    RETURNING id
  `);

  return {
    ok: true,
    title: opts.title,
    digest,
    attachedTo: { kind: attached.kind, id: attached.id, name: attached.name },
    contextUrlId: rows[0]?.id,
  };
}

/** Full pipeline for a pasted Google Doc URL using the user's Drive token. */
export async function ingestGoogleDoc(url: string, accessToken: string): Promise<IngestResult> {
  const docId = parseGoogleDocId(url);
  if (!docId) return { ok: false, error: 'Could not find a Google Doc id in that URL.' };

  let text: string;
  try {
    text = await fetchGoogleDocText(docId, accessToken);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!text.trim()) return { ok: false, error: 'That document exported as empty text.' };

  return ingestText({ url, title: deriveTitle(text), text });
}
