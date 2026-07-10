import 'server-only';
import { GoogleGenAI, Type } from '@google/genai';
import { generateDeterministicEmbedding } from './embedding-fallback';

// Gemini: distill a document into decision-useful intelligence, classify which entity
// it concerns, and embed the digest. All three degrade gracefully when GEMINI_API_KEY
// is absent so the app still runs (without real intelligence) in dev/test.

const apiKey = process.env.GEMINI_API_KEY;
export const geminiConfigured = !!apiKey;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

// The stable alias tracks the current flash model — pinned ids rot (gemini-2.5-flash
// began 404ing for new API keys mid-2026).
export const SUMMARY_MODEL = 'gemini-flash-latest';
// gemini-embedding-001 is the current embedding model (text-embedding-004 returns 404
// on AI Studio keys). It defaults to 3072 dims, so we request 768 to match the
// pgvector column. Cosine distance (<=>) is scale-invariant, so reduced dims are fine.
const EMBED_MODEL = 'gemini-embedding-001';
const EMBED_DIMS = 768;
const MAX_DOC_CHARS = 30000;

export interface DocDigest {
  summary: string;
  keyTopics: string[];
  decisions: string[];
  openQuestions: string[];
  entities: { partners: string[]; programs: string[]; people: string[] };
}

export interface ClassifyCandidate {
  id: number;
  name: string;
}

export interface Classification {
  kind: 'project' | 'partner' | 'none';
  id: number | null;
  name: string | null;
  confidence: number;
}

/** Render a digest into the text we store + embed (usable narrative, not the raw doc). */
export function digestToText(d: DocDigest): string {
  const parts = [d.summary];
  if (d.keyTopics.length) parts.push(`Key topics: ${d.keyTopics.join('; ')}`);
  if (d.decisions.length) parts.push(`Decisions: ${d.decisions.join('; ')}`);
  if (d.openQuestions.length) parts.push(`Open questions: ${d.openQuestions.join('; ')}`);
  return parts.join('\n');
}

export async function summarizeDocument(text: string): Promise<DocDigest> {
  if (!ai) {
    return {
      summary: text.slice(0, 500),
      keyTopics: [],
      decisions: [],
      openQuestions: [],
      entities: { partners: [], programs: [], people: [] },
    };
  }

  const prompt = `You are an analyst for an Android Automotive (AAOS / Google Automotive Services) partner-program tracker.
Distill the document below into structured, decision-useful intelligence for a Googler who is either prepping for a partner meeting or reviewing a program. Be concise and specific; capture discussion topics even when they do not map to formal program status.

DOCUMENT:
"""
${text.slice(0, MAX_DOC_CHARS)}
"""`;

  const resp = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          summary: { type: Type.STRING },
          keyTopics: { type: Type.ARRAY, items: { type: Type.STRING } },
          decisions: { type: Type.ARRAY, items: { type: Type.STRING } },
          openQuestions: { type: Type.ARRAY, items: { type: Type.STRING } },
          entities: {
            type: Type.OBJECT,
            properties: {
              partners: { type: Type.ARRAY, items: { type: Type.STRING } },
              programs: { type: Type.ARRAY, items: { type: Type.STRING } },
              people: { type: Type.ARRAY, items: { type: Type.STRING } },
            },
            required: ['partners', 'programs', 'people'],
          },
        },
        required: ['summary', 'keyTopics', 'decisions', 'openQuestions', 'entities'],
      },
    },
  });

  return JSON.parse(resp.text ?? '{}') as DocDigest;
}

// ---- Program brief (spec §2.12) ------------------------------------------------------
// The model reasons ONLY over the evidence records we hand it (already-stored state rows
// and ingested digests — never original sources) and must cite evidence by id so we can
// attach exact in-app links server-side.

export interface BriefEvidence {
  id: number; // index into the evidence list, for citations
  kind: 'needle' | 'hill' | 'context' | 'action' | 'chain';
  text: string; // one-line rendering of the record
}

export interface RawBriefBullet {
  text: string;
  evidence: number[]; // BriefEvidence ids
}

export interface RawBrief {
  tldr: string;
  health: RawBriefBullet[];
  risks: RawBriefBullet[];
  decisions: RawBriefBullet[];
  nextSteps: RawBriefBullet[];
  partnerActivity: RawBriefBullet[];
}

const BULLETS = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      text: { type: Type.STRING },
      evidence: { type: Type.ARRAY, items: { type: Type.NUMBER } },
    },
    required: ['text', 'evidence'],
  },
} as const;

/** Synthesize a program brief from the supplied evidence. Returns null when Gemini is
 *  not configured — callers render an honest empty state, never a fake synthesis. */
export async function generateProgramBrief(
  programName: string,
  partnerName: string,
  evidence: BriefEvidence[],
): Promise<RawBrief | null> {
  if (!ai) return null;

  const prompt = `You are an analyst for an Android Automotive (AAOS / Google Automotive Services) partner-program tracker.
Write a brief for a Googler exec opening the "${programName}" program page (partner: ${partnerName}) cold. Synthesize ONLY from the numbered evidence records below — do not invent facts. Every bullet must list the evidence record ids it draws from in its "evidence" array, and ONLY there — never write ids or bracketed references like [0, 3] inside the prose itself. Flag stagnation or risk plainly. Keep bullets short and specific; skip a section (empty array) when the evidence has nothing for it. Never include numeric progress percentages — describe position in words.

Sections:
- tldr: 2-3 sentences — the state of the program and what needs attention.
- health: current health and direction of travel vs. previous updates.
- risks: what could go wrong, what is blocked or stagnant.
- decisions: decisions made or pending.
- nextSteps: what should happen next.
- partnerActivity: what partners did, said, or owe.

EVIDENCE:
${evidence.map((e) => `[${e.id}] (${e.kind}) ${e.text}`).join('\n')}`;

  const resp = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    contents: prompt.slice(0, MAX_DOC_CHARS),
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          tldr: { type: Type.STRING },
          health: BULLETS,
          risks: BULLETS,
          decisions: BULLETS,
          nextSteps: BULLETS,
          partnerActivity: BULLETS,
        },
        required: ['tldr', 'health', 'risks', 'decisions', 'nextSteps', 'partnerActivity'],
      },
    },
  });

  return JSON.parse(resp.text ?? 'null') as RawBrief | null;
}

export async function classifyContext(
  digest: DocDigest,
  projects: ClassifyCandidate[],
  partners: ClassifyCandidate[],
): Promise<Classification> {
  if (!ai) return { kind: 'none', id: null, name: null, confidence: 0 };

  const prompt = `Pick the single entity this document is most about. Prefer a specific program (project) when the document is clearly about one program; otherwise a partner; otherwise kind="none".

DIGEST: ${JSON.stringify({ summary: digest.summary, keyTopics: digest.keyTopics, entities: digest.entities })}

PROJECTS: ${JSON.stringify(projects)}
PARTNERS: ${JSON.stringify(partners)}`;

  const resp = await ai.models.generateContent({
    model: SUMMARY_MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING },
          id: { type: Type.NUMBER, nullable: true },
          name: { type: Type.STRING, nullable: true },
          confidence: { type: Type.NUMBER },
        },
        required: ['kind', 'id', 'name', 'confidence'],
      },
    },
  });

  return JSON.parse(resp.text ?? '{}') as Classification;
}

/** Embed text to a 768-dim vector (real Gemini when configured, deterministic otherwise). */
export async function embedText(text: string): Promise<number[]> {
  if (!ai) return generateDeterministicEmbedding(text);
  try {
    const resp = await ai.models.embedContent({
      model: EMBED_MODEL,
      contents: text,
      config: { outputDimensionality: EMBED_DIMS },
    });
    const values = resp.embeddings?.[0]?.values;
    if (values && values.length === EMBED_DIMS) return values;
    console.warn(`Gemini embedding returned ${values?.length ?? 0} dims, expected ${EMBED_DIMS}; using fallback.`);
  } catch (err) {
    console.warn('Gemini embedding failed, using fallback:', err);
  }
  return generateDeterministicEmbedding(text);
}
