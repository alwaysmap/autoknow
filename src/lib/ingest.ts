import 'server-only';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from './db';
import {
  embedText,
  summarizeDocument,
  classifyContext,
  classifyWithinAnchor,
  digestToText,
  type Classification,
  type DocDigest,
} from './gemini';
import { parseGoogleDocId, fetchGoogleDocText } from './google-docs';
import {
  inferSource,
  canonicalizeUrl,
  normalizeText,
  htmlToText,
  isForbiddenHost,
  looksLikeAuthWall,
  type SourceInfo,
  type TrackingMode,
} from './sources';

export interface IngestAnchor {
  projectId?: number | null;
  partnerId?: number | null;
  phaseId?: number | null;
}

export interface IngestResult {
  ok: boolean;
  error?: string;
  title?: string;
  digest?: DocDigest;
  attachedTo?: { kind: 'project' | 'partner' | 'none'; id: number | null; name: string | null };
  contextUrlId?: number;
  /** Set when the sourceRef already exists — the UI points at the existing item. */
  duplicateOf?: { contextUrlId: number; title: string | null };
  mode?: TrackingMode;
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return (firstLine || 'Untitled document').slice(0, 120);
}

export function hashContent(text: string): string {
  return createHash('sha256').update(normalizeText(text)).digest('hex');
}

export interface IngestContentOptions {
  url: string;
  title?: string;
  text: string;
  source: SourceInfo;
  mode: TrackingMode; // possibly user-corrected from the inferred default
  modeSource: 'inferred' | 'user';
  sourceVersion?: string | null; // Drive version / ETag
  anchor?: IngestAnchor | null; // host-page anchor: skips global classification
  addedBy?: string | null; // who brought this in (user handle / Drive sharer)
}

/**
 * Distill, attach, embed, and store one document as a ContextUrl (plan §3, §5).
 * Anchored ingests attach deterministically and run only constrained enrichment;
 * unanchored ingests keep the global classifier. sourceRef dedupe happens first —
 * one source, one row.
 */
export async function ingestContent(opts: IngestContentOptions): Promise<IngestResult> {
  // Dedupe before any model spend (plan §5).
  if (opts.source.sourceRef) {
    const existing = await prisma.contextUrl.findUnique({
      where: { sourceRef: opts.source.sourceRef },
      select: { id: true, title: true },
    });
    if (existing) {
      return { ok: true, duplicateOf: { contextUrlId: existing.id, title: existing.title } };
    }
  }

  const digest = await summarizeDocument(opts.text);
  const digestText = digestToText(digest);
  const title = opts.title || deriveTitle(opts.text);

  let projectId: number | null = opts.anchor?.projectId ?? null;
  let partnerId: number | null = opts.anchor?.partnerId ?? null;
  let phaseId: number | null = opts.anchor?.phaseId ?? null;
  let attached: Classification = { kind: 'none', id: null, name: null, confidence: 1 };

  if (opts.anchor && (projectId || partnerId)) {
    // The host page IS the anchor; enrichment only picks WITHIN it (plan §3).
    if (projectId) {
      const project = await prisma.project.findUnique({
        where: { id: projectId },
        select: { name: true, phases: { select: { id: true, name: true } } },
      });
      attached = { kind: 'project', id: projectId, name: project?.name ?? null, confidence: 1 };
      if (!phaseId && project && project.phases.length > 0) {
        phaseId = await classifyWithinAnchor(digest, project.phases, 'phase');
      }
    } else if (partnerId) {
      const partner = await prisma.partner.findUnique({
        where: { id: partnerId },
        select: { name: true, projects: { where: { isArchived: false }, select: { id: true, name: true } } },
      });
      attached = { kind: 'partner', id: partnerId, name: partner?.name ?? null, confidence: 1 };
      if (partner && partner.projects.length > 0) {
        projectId = await classifyWithinAnchor(digest, partner.projects, 'program');
      }
    }
  } else {
    // Unanchored (global /ingest, Chat @mention): classify across the portfolio.
    const [projects, partners] = await Promise.all([
      prisma.project.findMany({ where: { isArchived: false }, select: { id: true, name: true } }),
      prisma.partner.findMany({ select: { id: true, name: true } }),
    ]);
    const classification = await classifyContext(digest, projects, partners);
    attached = { kind: 'none', id: null, name: null, confidence: classification.confidence };
    if (classification.kind === 'project' && projects.some((p) => p.id === classification.id)) {
      projectId = classification.id;
      attached = { ...classification, name: projects.find((p) => p.id === classification.id)!.name };
    } else if (classification.kind === 'partner' && partners.some((p) => p.id === classification.id)) {
      partnerId = classification.id;
      attached = { ...classification, name: partners.find((p) => p.id === classification.id)!.name };
    }
  }

  const vectorStr = `[${(await embedText(digestText)).join(',')}]`;
  const hash = hashContent(opts.text);
  const now = new Date();
  const legacyType = opts.source.kind === 'chat' ? 'Chat' : opts.source.kind === 'tracker' ? 'Gerrit' : 'Doc';

  const rows = await prisma.$queryRaw<{ id: number }[]>(Prisma.sql`
    INSERT INTO "ContextUrl" (
      "projectId", "partnerId", "phaseId", "url", "type", "title", "ingestedText", "embedding",
      "mode", "modeSource", "sourceRef", "sourceVersion", "contentHash", "sourceStatus",
      "addedBy", "lastCheckedAt", "lastChangedAt"
    )
    VALUES (
      ${projectId}, ${partnerId}, ${phaseId}, ${opts.url}, ${legacyType}, ${title}, ${digestText}, ${vectorStr}::vector,
      ${opts.mode}, ${opts.modeSource}, ${opts.source.sourceRef}, ${opts.sourceVersion ?? null}, ${hash}, ${digest.sourceStatus},
      ${opts.addedBy ?? null}, ${now}, ${now}
    )
    RETURNING id
  `);
  const contextUrlId = rows[0]?.id;

  // The initial revision (delta null) so history starts at ingest.
  if (contextUrlId) {
    await prisma.contextRevision.create({
      data: {
        contextUrlId,
        sourceVersion: opts.sourceVersion ?? null,
        contentHash: hash,
        sourceStatus: digest.sourceStatus,
        digest: digestText,
        delta: null,
      },
    });
  }

  return {
    ok: true,
    title,
    digest,
    attachedTo: { kind: attached.kind, id: attached.id, name: attached.name },
    contextUrlId,
    mode: opts.mode,
  };
}

/** Full pipeline for a pasted Google Doc URL using the user's Drive token. */
export async function ingestGoogleDoc(
  url: string,
  accessToken: string,
  extra?: { anchor?: IngestAnchor | null; mode?: TrackingMode; modeSource?: 'inferred' | 'user'; addedBy?: string | null },
): Promise<IngestResult> {
  const docId = parseGoogleDocId(url);
  if (!docId) return { ok: false, error: 'Could not find a Google Doc id in that URL.' };

  let text: string;
  try {
    text = await fetchGoogleDocText(docId, accessToken);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!text.trim()) return { ok: false, error: 'That document exported as empty text.' };

  const source: SourceInfo = { kind: 'drive', mode: 'watched', sourceRef: `drive:${docId}` };
  return ingestContent({
    url,
    text,
    source,
    mode: extra?.mode ?? source.mode,
    modeSource: extra?.modeSource ?? 'inferred',
    anchor: extra?.anchor ?? null,
    addedBy: extra?.addedBy ?? null,
  });
}

export interface WebFetchResult {
  ok: boolean;
  error?: string;
  status?: number; // HTTP status on failure (404 → freeze as deleted)
  authWall?: boolean;
  text?: string;
  title?: string;
  etag?: string | null;
  finalUrl?: string;
  notModified?: boolean;
}

/** Fetch a generic web/tracker URL with the plan's §4 guards (SSRF, auth walls). */
export async function fetchWebUrl(url: string, priorEtag?: string | null): Promise<WebFetchResult> {
  const canonical = canonicalizeUrl(url);
  if (!canonical) return { ok: false, error: 'Not a fetchable http(s) URL.' };
  if (isForbiddenHost(new URL(canonical).hostname)) {
    return { ok: false, error: 'That address is not fetchable from the server.' };
  }

  let res: Response;
  try {
    res = await fetch(canonical, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15000),
      headers: {
        'User-Agent': 'AutoKnow/1.0 (+context ingestion)',
        // Pin the language: auto-localizing sites would otherwise serve per-request
        // variants, breaking hash stability (and titles).
        'Accept-Language': 'en',
        ...(priorEtag ? { 'If-None-Match': priorEtag } : {}),
      },
    });
  } catch (e) {
    return { ok: false, error: `Fetch failed: ${(e as Error).message}` };
  }

  if (res.status === 304) return { ok: true, notModified: true };
  // Post-redirect host must pass the same guard (a public URL can bounce inward).
  const finalUrl = res.url || canonical;
  if (isForbiddenHost(new URL(finalUrl).hostname)) {
    return { ok: false, error: 'That address redirects somewhere not fetchable.' };
  }
  if (res.status === 401 || res.status === 403) return { ok: true, authWall: true, finalUrl };
  if (!res.ok) return { ok: false, status: res.status, error: `Fetch failed with HTTP ${res.status}.` };

  const contentType = res.headers.get('content-type') || '';
  if (!/text\/|json|xml/.test(contentType)) {
    return { ok: false, error: `Unsupported content type (${contentType.split(';')[0] || 'unknown'}).` };
  }

  const raw = (await res.text()).slice(0, 2_000_000);
  const isHtml = /html/.test(contentType);
  const text = isHtml ? htmlToText(raw) : normalizeText(raw);
  if (looksLikeAuthWall(finalUrl, text)) return { ok: true, authWall: true, finalUrl };
  if (!text.trim()) return { ok: false, error: 'The page had no indexable text.' };

  const titleMatch = isHtml ? raw.match(/<title[^>]*>([^<]{1,200})<\/title>/i) : null;
  return {
    ok: true,
    text,
    // htmlToText doubles as the entity decoder for the raw <title> text.
    title: titleMatch ? htmlToText(titleMatch[1]).trim() || undefined : undefined,
    etag: res.headers.get('etag'),
    finalUrl,
  };
}

/**
 * One entry point for a pasted link with host context (QuickIngest + /ingest):
 * routes to the right fetcher by inferred source kind.
 */
export async function ingestLink(opts: {
  url: string;
  mode?: TrackingMode; // user override from the chip
  anchor?: IngestAnchor | null;
  userAccessToken?: string | null; // for Drive fetches
  addedBy?: string | null;
}): Promise<IngestResult> {
  const source = inferSource(opts.url);
  const mode = opts.mode ?? source.mode;
  const modeSource: 'inferred' | 'user' = opts.mode && opts.mode !== source.mode ? 'user' : 'inferred';

  if (source.kind === 'drive') {
    if (!opts.userAccessToken) {
      return { ok: false, error: 'Sign in with Google to fetch Docs, or share the doc with the AutoKnow service account.' };
    }
    return ingestGoogleDoc(opts.url, opts.userAccessToken, { anchor: opts.anchor, mode, modeSource, addedBy: opts.addedBy });
  }

  if (source.kind === 'chat') {
    return {
      ok: false,
      error: 'Chat messages can’t be fetched from a link yet — @mention AutoKnow in the space, or paste the text on the Ingest page.',
    };
  }

  // tracker + generic web
  const fetched = await fetchWebUrl(opts.url);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  if (fetched.authWall) {
    return { ok: false, error: 'That page sits behind a sign-in wall, so it can’t be indexed from here.' };
  }

  return ingestContent({
    url: canonicalizeUrl(opts.url) ?? opts.url,
    title: fetched.title,
    text: fetched.text!,
    source,
    mode,
    modeSource,
    sourceVersion: fetched.etag ?? null,
    anchor: opts.anchor ?? null,
    addedBy: opts.addedBy ?? null,
  });
}
