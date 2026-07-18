import { z } from 'zod';

// Defensive parsers for Gemini responses. responseSchema constrains what the model
// *tries* to return, but a blocked, empty, or truncated response still reaches us as
// '' or partial JSON — and a raw `JSON.parse(...) as X` would crash the pipeline with
// a TypeError far from the cause. Policy per call site:
//   - document digest: throw a readable error (the refresh cycle counts it and
//     retries later) rather than fabricate an empty digest;
//   - classification: degrade to "none" — it is best-effort by design;
//   - leadership summary: degrade to null — callers render an honest empty state.
// Client-safe: zod only, no Node imports (mirrors lib/schemas.ts).

import type { Classification, DocDigest, RawSummary } from './gemini';

const zStrArr = z.array(z.string()).catch([]);

const zDigest = z.object({
  summary: z.string().catch(''),
  keyTopics: zStrArr,
  decisions: zStrArr,
  openQuestions: zStrArr,
  entities: z
    .object({ partners: zStrArr, programs: zStrArr, people: zStrArr })
    .catch({ partners: [], programs: [], people: [] }),
  sourceStatus: z.enum(['open', 'resolved', 'not-applicable']).catch('not-applicable'),
  delta: z.string().optional().catch(undefined),
});

function tryJson(text: string | undefined): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function parseDocDigest(text: string | undefined): DocDigest & { delta?: string } {
  const parsed = zDigest.safeParse(tryJson(text));
  if (!parsed.success || !parsed.data.summary.trim()) {
    throw new Error(`Gemini returned an unusable digest (${(text ?? '').slice(0, 120) || 'empty response'})`);
  }
  return parsed.data;
}

const NO_CLASSIFICATION: Classification = { kind: 'none', id: null, name: null, confidence: 0 };

const zClassification = z.object({
  kind: z.enum(['project', 'partner', 'none']),
  id: z.number().nullable().catch(null),
  name: z.string().nullable().catch(null),
  confidence: z.number().catch(0),
});

export function parseClassification(text: string | undefined): Classification {
  const parsed = zClassification.safeParse(tryJson(text));
  return parsed.success ? parsed.data : NO_CLASSIFICATION;
}

const zBullets = z
  .array(
    z
      .object({ text: z.string(), evidence: z.array(z.number()).catch([]) })
      .or(z.any().transform(() => null)),
  )
  .transform((arr) => arr.filter((b): b is { text: string; evidence: number[] } => b !== null))
  .catch([]);

const zRawSummary = z.object({
  tldr: z.string(),
  progress: zBullets,
  risks: zBullets,
  themes: zBullets,
  actions: zBullets,
});

export function parseRawSummary(text: string | undefined): RawSummary | null {
  const parsed = zRawSummary.safeParse(tryJson(text));
  return parsed.success ? parsed.data : null;
}
