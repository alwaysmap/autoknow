import 'server-only';
import { GoogleGenAI, Type } from '@google/genai';
import { generateDeterministicEmbedding } from './embedding-fallback';

// Gemini: distill a document into decision-useful intelligence, classify which entity
// it concerns, and embed the digest. All three degrade gracefully when GEMINI_API_KEY
// is absent so the app still runs (without real intelligence) in dev/test.

const apiKey = process.env.GEMINI_API_KEY;
export const geminiConfigured = !!apiKey;
const ai = apiKey ? new GoogleGenAI({ apiKey }) : null;

const SUMMARY_MODEL = 'gemini-2.5-flash';
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
