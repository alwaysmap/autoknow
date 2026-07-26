// Wired into jest via `setupFiles`, so this runs in EVERY test file's process before the
// test framework is installed and before the file's own imports are evaluated. Its one
// job: make the unit suite structurally incapable of calling the real Gemini API.
//
// Why it has to exist: src/lib/gemini.ts decides ONCE, at import time, whether it is
// configured — `const ai = apiKey ? new GoogleGenAI({ apiKey }) : null` — and every entry
// point degrades to a deterministic local fallback when `ai` is null. next/jest loads the
// developer's real .env into process.env before any test runs, so a machine with a key
// takes the LIVE branch while CI (which has no key) takes the fallback. The two run
// different code and only one of them is asserted. The rule used to live in seven test
// file headers as `process.env.GEMINI_API_KEY = ''`, and the eighth file forgot — the
// full incident is in docs/knowledge/static-src-import-in-a-test-preempts-its-env-setup.md.
//
// Deleting the variable rather than blanking it states it as strongly as the environment
// allows: the process looks exactly like an unconfigured deployment.
//
// This is `setupFiles`, not `setupFilesAfterEnv`, because the window that matters closes
// early: an ES import of src/lib/gemini is hoisted above everything in the test file's own
// body, so a fix written INSIDE a test file is already too late unless that file also
// defers every src/ import to beforeAll. Running before the module registry is touched at
// all makes the guard independent of how any individual test file is written — including
// the ones not written yet.
//
// A test that wants the CONFIGURED branch is unaffected: it mocks src/lib/gemini outright
// (e.g. tests/summaryCycle, tests/refreshCycle), which never consults the environment.

delete process.env.GEMINI_API_KEY;
