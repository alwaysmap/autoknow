---
title: A static `src/` import in a test is hoisted above the test's own env setup, so the deterministic no-key path silently becomes a live API call
status: current
updated: 2026-07-26
applies_to:
  - tests/**/*.test.ts
  - a test that sets process.env.DATABASE_URL before importing src/
  - jest.config.ts setupFiles
symptoms:
  - a stubbed fetch returns "SyntaxError: Unexpected token 'A', ... is not valid JSON"
  - a test's assertions depend on the developer's environment rather than on the code
  - a DB test reads rows it never seeded, or writes to the wrong database
verified_by: '`npx jest` with a spend-capped key linked: 87 suites in 31.7s vs 31.8s with none — an exhausted key cannot be quietly succeeded against; tests/truncationFlag.test.ts "flags a source whose text ran past the cap"; #56'
---

# A static `src/` import in a test is hoisted above the test's own env setup

**The lesson.** In a jest test, `import { X } from '../src/lib/…'` runs BEFORE the
file's `process.env.… = …` lines, no matter where those lines sit. Import
**everything** from `src/` dynamically, inside `beforeAll` — the constants too, not
just the functions the test calls:

```ts
let MAX_DOC_CHARS: number;
let ingestContent: typeof import('../src/lib/ingest').ingestContent;
beforeAll(async () => {
  ({ MAX_DOC_CHARS } = await import('../src/lib/gemini'));
  ({ ingestContent } = await import('../src/lib/ingest'));
});
```

**Why it bites.** ES imports are hoisted, so every static import evaluates before the
module body, and `next/jest` has already loaded the real `.env` into `process.env`.
Modules that read env ONCE at import time therefore capture the developer's values,
not the test's. `src/lib/gemini` did exactly that (`const ai = apiKey ? new
GoogleGenAI(...) : null`), so the "deterministic fallback" a test believed it was on
was really the network — passing locally, just slowly and against a live model, until
the test also stubbed `global.fetch` and the SDK threw a JSON syntax error naming the
fixture's own text. A module that reads no environment (e.g. `src/lib/ingestLimits`)
is safe to import statically, but the cheap rule is "dynamic unless you have checked".

**`GEMINI_API_KEY` is now closed globally — no jest test should set it again.** The rule
lived in seven file headers, so the eighth forgot: `tests/seedMock.test.ts` seeded the
whole mock corpus against the live model on every developer run, invisibly, because CI
has no key and took the other branch. It surfaced only when the project hit its
spending cap and all 14 cases went red on code CI had just passed. `jest.config.ts` now
runs `tests/no-live-gemini.ts` via `setupFiles`, deleting the variable in every test
process before any module is required — that beats hoisting outright, so it holds
however an individual file is written. The seven per-file `= ''` lines went with it:
two mechanisms for one invariant is how a reader stops knowing which is load-bearing.
The one surviving `GEMINI_API_KEY: ''` is `playwright.config.ts`'s `webServer` env, and
it has to stay — that server is a separate process no jest hook can reach.

**`DATABASE_URL` is NOT covered that way** and still needs the discipline above (see
the comment in `tests/ingestionHealth.test.ts`). Its value is per-worktree and
per-suite, so only the test file can set it — which puts it back in a race with that
file's own imports. There it at least fails loudly.
