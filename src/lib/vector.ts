import { prisma } from './db';

export function generateDeterministicEmbedding(text: string): number[] {
  const embedding = new Array(768).fill(0);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = text.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  for (let i = 0; i < 768; i++) {
    const x = Math.sin(hash + i) * 10000;
    embedding[i] = x - Math.floor(x);
  }
  return embedding;
}

export async function ingestRecord(projectId: number, url: string, type: string, title: string, ingestedText: string) {
  try {
    // Ensure pgvector extension exists
    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector;');
  } catch (err) {
    console.warn('Failed to ensure vector extension (might be permission issue or already loaded):', err);
  }

  const embedding = generateDeterministicEmbedding(ingestedText);
  const vectorStr = `[${embedding.join(',')}]`;
  
  await prisma.$executeRawUnsafe(
    `INSERT INTO "ContextUrl" ("projectId", "url", "type", "title", "ingestedText", "embedding")
     VALUES ($1, $2, $3, $4, $5, $6::vector)`,
    projectId,
    url,
    type,
    title,
    ingestedText,
    vectorStr
  );
}

export async function searchVectorDatabase(query: string, limit: number = 10): Promise<any[]> {
  try {
    const embedding = generateDeterministicEmbedding(query);
    const vectorStr = `[${embedding.join(',')}]`;

    // Order by cosine distance (<=> operator)
    const results = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, "projectId", url, type, title, "ingestedText", 
       (1 - (embedding <=> $1::vector)) as similarity 
       FROM "ContextUrl" 
       WHERE embedding IS NOT NULL 
       ORDER BY embedding <=> $1::vector 
       LIMIT $2`,
      vectorStr,
      limit
    );

    return results || [];
  } catch (err) {
    console.error('Vector search query failed:', err);
    return [];
  }
}
