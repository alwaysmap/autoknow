---
title: A static `src/` import in a test is hoisted above the test's own env setup, so the deterministic no-key path silently becomes a live API call
status: current
updated: 2026-07-25
applies_to:
  - tests/**/*.test.ts
  - a test that sets process.env.GEMINI_API_KEY or DATABASE_URL before importing src/
symptoms:
  - a unit test that sets GEMINI_API_KEY='' still takes seconds per case
  - a stubbed fetch returns "SyntaxError: Unexpected token 'A', ... is not valid JSON"
  - a test's assertions depend on whether the developer has a real API key
verified_by: 'tests/truncationFlag.test.ts "flags a source whose text ran past the cap"; #56'
---

# A static `src/` import in a test is hoisted above the test's own env setup

**The lesson.** In a jest test, `import { MAX_DOC_CHARS } from '../src/lib/gemini'`
runs BEFORE the file's `process.env.GEMINI_API_KEY = ''` line, no matter where that
line sits. Import **everything** from `src/` dynamically, inside `beforeAll` — the
constants too, not just the functions the test calls.

**Why it bites.** ES module imports are hoisted, so every static import evaluates
before the module body. `src/lib/gemini` decides at import time whether it is
configured (`const ai = apiKey ? new GoogleGenAI(...) : null`), and `next/jest` has
already loaded the real `.env` into `process.env` — so the module captures the
developer's live key, and the "deterministic fallback" the test believes it is on is
really the network. The test still passes locally, just slowly and against a live
model; the failure only surfaces when the test ALSO stubs `global.fetch`, at which
point the Gemini SDK parses the stub's body and throws a JSON syntax error naming
text the test wrote itself. The same hoisting hits `DATABASE_URL` (see the comment in
`tests/ingestionHealth.test.ts`), where the consequence is a test bound to the wrong
database — but that one at least fails loudly.

**What to do.** Declare the binding and fill it in `beforeAll`:

```ts
let MAX_DOC_CHARS: number;
let ingestContent: typeof import('../src/lib/ingest').ingestContent;
beforeAll(async () => {
  ({ MAX_DOC_CHARS } = await import('../src/lib/gemini'));
  ({ ingestContent } = await import('../src/lib/ingest'));
});
```

A module that reads no environment (e.g. `src/lib/ingestLimits`) may be imported
statically — but the cheap rule is "dynamic unless you have checked".
If a test's timing suddenly looks like network latency, this is the first thing to
suspect: compare the suite's wall time with and without the key in `.env`.

**How we found out.** #56 added `tests/truncationFlag.test.ts`, which sets
`GEMINI_API_KEY = ''` and statically imported `MAX_DOC_CHARS`. Two cases blew the 5s
jest timeout, and raising the timeout only revealed the real tell: the third case
stubbed `fetch` for the refresh path, and the Gemini SDK choked on the fixture text.
Nothing in lint, types or CI would have caught it — a live-key test is green.
