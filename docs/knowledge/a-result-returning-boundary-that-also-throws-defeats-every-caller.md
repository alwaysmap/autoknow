---
title: A function whose return type already models failure must never also throw for that same failure
status: current
updated: 2026-07-29
applies_to:
  - src/lib/ingest.ts
  - src/lib/refresh.ts
  - adding a provider call to a function that returns { ok, error }
symptoms:
  - an operator gets `{"error":"Internal Server Error"}` from a route whose handler returns typed results
  - a long job dies partway and leaves a half-written database
  - the same failure degrades gracefully on one code path and crashes another
verified_by: 'tests/providerRefusalDegrades.test.ts; tests/seedMock.test.ts "reports what it ingested"; beads autoknow-j81, autoknow-dv3'
---

# A result-returning boundary that also throws defeats every caller at once

**The lesson.** `ingestContent` and `refreshSource` both return `{ ok, error }` —
a type that says "failure is expected and described here". Both also **threw**,
for exactly the failure the type was invented for: a Gemini call refused over a
monthly spend cap. Every caller had written its handling against the return type,
so the throw went past all of them at once — taking down a whole demo seed
(`POST /api/admin/seed` answered `{"error":"Internal Server Error"}` after every
entity was already written), and on Manage → Sources getting caught and dropped,
leaving a row that just did not advance. Two exits for one failure class is the
defect; pick the one the type advertises.

**Why it bites.** The throwing call is usually *added later*, beside one that is
already guarded, and looks handled by association: `ingestContent` guarded
`embedForStorage` in a `try` that returns a decline — eight lines below an
unguarded `summarizeDocument`. `refreshSource` had the same pair. Nothing reads
as missing, and tests are green because **nothing tests an absence**. It surfaces
only when the provider really refuses, which on a free-tier key means "the week
you go over the cap", not "in review". The blast radius is wider than the surface
in front of you, too, because these boundaries are shared: the refusal that had
to be fixed for a *server action* (where an unhandled rejection costs the whole
page — see the sibling note) is the one that killed a *CLI-shaped seed*.

**What to do.**

- When you add a provider call to a function that returns a result type, wrap it
  the way its neighbour is wrapped, and return the decline —
  `quotaDeclineMessage(...)` from `src/lib/geminiQuota` when `isQuotaError(e)`,
  a named message otherwise. Do not rely on a caller's `catch`.
- **Throwing on purpose is still correct one level down.** `embedForStorage`
  throws by design so a failed embed can never overwrite a real vector with the
  uniform-pedestal fallback. The rule is not "never throw" — it is that the throw
  must not escape the boundary whose type promises otherwise.
- **A long job degrades per item, not per run.** The seed skips the document the
  provider refused, records `{ key, reason }`, finishes, and the route answers 200
  with the count. Distinguish *our fixture is wrong* (an unresolvable anchor —
  still throws, no retry fixes it) from *the world refused* (skip and report).
- Grep for the sibling call before you finish:
  `grep -n 'await summarizeDocument\|await embedForStorage\|await classify' src/lib/*.ts`.

**How we found out.** `autoknow-j81`: `npm run demo` against a project over its
monthly spend cap, with a working key. Every entity was written by the time the
corpus ingest reached Gemini, so it read as a database bug behind an opaque 500.
The workaround that unblocked that session was running with `GEMINI_API_KEY=` —
the app degraded honestly when the provider was *absent*, never when it *refused*.
