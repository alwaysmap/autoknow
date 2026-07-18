import { prisma } from './db';
import { embedText } from './gemini';

// Re-exported for callers that still want the raw fallback; real ingest/search go
// through gemini.embedText (Gemini when configured, deterministic otherwise).
export { generateDeterministicEmbedding } from './embedding-fallback';

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
