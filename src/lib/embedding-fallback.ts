// Deterministic 768-dim pseudo-embedding used ONLY when no Gemini key is configured,
// so search/ingest still function (degraded, non-semantic) in dev/test. When
// GEMINI_API_KEY is set, lib/gemini.ts embedText() uses real text-embedding-004
// (also 768-dim, matching the pgvector column).

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
