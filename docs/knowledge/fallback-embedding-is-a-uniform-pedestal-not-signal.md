---
title: Without a real embedding model, every "semantic" score is the same ~0.75 pedestal — noise, not signal
status: current
updated: 2026-07-26
applies_to:
  - src/lib/search.ts
  - src/lib/embedding-fallback.ts
  - search/ranking work in any env with GEMINI_API_KEY unset (dev, test, demo)
symptoms:
  - search returns unrelated entities deep in the list (e.g. "Honda" under a "Volvo" search)
  - every embedded row scores ~0.75 and the lexical ranking is buried
  - ranking looks fine in prod but noisy in dev/demo, so it gets dismissed as fake data
verified_by: 'tests/search.spec.ts "a reindex does not let unrelated records leak into a specific-name search"; the landing-search ranking fix, 2026-07-23'
---

# Without a real embedding model, every "semantic" score is the same ~0.75 pedestal — noise, not signal

**The lesson.** When `GEMINI_API_KEY` is unset, `embedForStorage()` falls back to
`generateDeterministicEmbedding` (`src/lib/embedding-fallback.ts`), an
all-positive 768-dim vector (each component the fractional part of a sine, in
`[0,1)`). Any two such vectors both point hard at the all-ones direction, so
their cosine similarity is ~0.75 for **every** pair of texts. The pgvector
"semantic" score is therefore a near-constant pedestal — identical for related
and unrelated records — and `GREATEST(lex, sem)` lets that 0.75 outrank a genuine
0.6 secondary-text lexical hit and fill the `LIMIT` with unrelated rows.

**Why it bites.** It is not "degraded semantic," it is anti-signal, and it is
invisible where you look. Real Gemini spreads similarities, so prod ranks fine;
the pedestal only shows up in dev / demo / test — exactly the environments where
a noisy result gets waved off as seed data. The fallback's own comment even says
"degraded, non-semantic," but the ranking code still blends it in.

**What to do.** Since 2026-07-26 the pedestal can only reach a STORED vector on a
deployment with no key at all: `embedForStorage` throws instead of substituting it, and
`embedForQuery` returns null ([ADR](../adr/2026-07-26-a-stored-vector-fails-loud-a-query-vector-fails-soft.md)).
Rows poisoned before that are found by `npm run db:embeddings:audit`. The ranking rule
below still stands for the unconfigured case.

Gate the semantic channel on `geminiConfigured`: with no real
model, rank lexical-only (`unifiedSearch` sets `semantic=false` → `sem=0`,
eligibility becomes `lex > 0`, and skip the embed round-trip entirely). When
Gemini *is* configured, still gate **semantic-only** rows (`lex = 0`, matched
purely by vector) behind a floor — `max(SEM_MIN, topScore × REL_FACTOR)` — because
even real embeddings float mild same-category matches; lexical hits are always
kept, so common-word searches still return everything that literally contains the
word. Never let a semantic-only row survive on the pedestal.

**How we found out.** A "Volvo" search surfaced Honda / Stellantis / Denso after
the first ~5 good rows. In the demo (`npm run demo` forces `GEMINI_API_KEY=''`)
every "semantic" score was ~0.75; switching the channel off when unconfigured
dropped the noise while keeping every genuine lexical tie (e.g. a program whose
partner *is* Volvo Cars).
