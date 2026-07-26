// Deterministic 768-dim pseudo-embedding used ONLY when no Gemini key is configured,
// so search/ingest still function (degraded, non-semantic) in dev/test. When
// GEMINI_API_KEY is set, lib/gemini.ts embedForStorage() uses the real embedding model
// (EMBED_MODEL, also 768-dim, matching the pgvector column) and THROWS rather than
// falling back here — substituting this vector for a row that had a real one destroys it
// (docs/adr/2026-07-26-a-stored-vector-fails-loud-a-query-vector-fails-soft.md).

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
