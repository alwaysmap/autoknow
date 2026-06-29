import { Prisma } from '@prisma/client';
import { prisma } from './db';
import { embedText } from './gemini';

// Re-exported for callers that still want the raw fallback; real ingest/search go
// through gemini.embedText (Gemini when configured, deterministic otherwise).
export { generateDeterministicEmbedding } from './embedding-fallback';

export interface ContextSearchRow {
  id: number;
  projectId: number | null;
  url: string;
  type: string;
  title: string | null;
  ingestedText: string | null;
  similarity: number;
}

function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

// Ensure the pgvector extension exists at most once per process, instead of issuing
// a CREATE EXTENSION on every ingest. The promise is cached; on failure it resets so
// a later call can retry.
let extensionEnsured: Promise<void> | null = null;
function ensureVectorExtension(): Promise<void> {
  if (!extensionEnsured) {
    extensionEnsured = prisma
      .$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;')
      .then(() => undefined)
      .catch((err) => {
        console.warn('Failed to ensure vector extension:', err);
        extensionEnsured = null;
      });
  }
  return extensionEnsured;
}

export async function ingestRecord(
  projectId: number,
  url: string,
  type: string,
  title: string,
  ingestedText: string,
) {
  await ensureVectorExtension();

  const vectorStr = toVectorLiteral(await embedText(ingestedText));

  // Parameterized via Prisma.sql — vectorStr is bound, then cast to vector.
  await prisma.$executeRaw`
    INSERT INTO "ContextUrl" ("projectId", "url", "type", "title", "ingestedText", "embedding")
    VALUES (${projectId}, ${url}, ${type}, ${title}, ${ingestedText}, ${vectorStr}::vector)
  `;
}

export async function searchVectorDatabase(
  query: string,
  limit: number = 10,
): Promise<ContextSearchRow[]> {
  try {
    const vectorStr = toVectorLiteral(await embedText(query));

    // Order by cosine distance (<=> operator); all inputs are bound parameters.
    const results = await prisma.$queryRaw<ContextSearchRow[]>(Prisma.sql`
      SELECT id, "projectId", url, type, title, "ingestedText",
             (1 - (embedding <=> ${vectorStr}::vector)) as similarity
      FROM "ContextUrl"
      WHERE embedding IS NOT NULL
      ORDER BY embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return results || [];
  } catch (err) {
    console.error('Vector search query failed:', err);
    return [];
  }
}
