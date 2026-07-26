---
title: A server action a component fires on mount is on the PAGE's critical path — and its 500 is logged against the page URL
status: current
updated: 2026-07-26
applies_to:
  - src/app/actions/**
  - a component that calls a server action from useEffect/startTransition
  - reading Cloud Run request logs for a route that "500s"
symptoms:
  - Next's "This page couldn't load / A server error occurred" on a page that loads fine by hand
  - the same URL logs 200 and 500 within a second of each other
  - a page only breaks for some rows, and only after someone filed an update
verified_by: 'tests/summaryRegenerateAction.test.ts; tests/SummaryPanel.test.tsx "keeps the page alive and says why"; bead autoknow-6by, Cloud Run 2026-07-26T14:02Z'
---

# A server action a component fires on mount is on the PAGE's critical path

**The lesson.** A server action awaited inside `startTransition` is not a
background errand: an unhandled rejection propagates into React's render and,
with no `error.tsx` in this app, lands on Next's `global-error` — the whole page
is replaced. When a component fires one from a mount effect (`SummaryPanel`
auto-refreshes a stale briefing on every view of `/programs/:id`,
`/partners/:id`, `/ecosystem`), any provider that can refuse — Gemini over its
spend cap, a timeout — can take the page down without a single line of the page's
own render being wrong. Such an action must RETURN `{ error }` and never throw,
and the caller must handle both the returned error and a rejection.

**Why it bites.** The evidence lies about where to look. Server actions POST to
the *current page URL*, so Cloud Run logs the failure as `POST /programs/3 500`
next to a healthy `GET /programs/3 200`. "The page renders fine" and "the page
500s" are then both true at once, and the read is naturally "the server render
throws" — which sends you into the page's data path, where nothing is wrong. The
hash in a deep link (`#phase-72-detail`) never reaches the server at all, so any
"only the deep link breaks" theory is a coincidence of which link was clicked.

**What to do.**
- Read `httpRequest.requestMethod`, not just the URL. A 500 on `POST /<page>`
  with 200s on `GET /<page>` means a server action, so look at what the page's
  client components call — start with mount effects, which run unattended.
- Give every provider-backed action the two guards the app already owns:
  `declineIfQuotaBlocked()` from `src/lib/geminiQuota.ts` as the preflight — the
  whole thing, latch + log + sentence, so a fifth copy never gets written — and a
  catch that returns `ActionResult` (`src/lib/actionResult.ts`).
  `POST /api/summaries/:scope/:id` is the reference; `quickIngestAction` is the
  second.
- On the client, `await` the action inside a `try`, render what came back, and
  make sure a refusal also clears any "updating…" state — a refusal that leaves a
  spinner is the same dishonesty in a quieter costume (AGENTS lesson 5).

**How we found out.** `/programs/3` served Next's error boundary in production
while the plain route "worked". Local demo, a prod build, and every phase deep
link across 18 seeded programs all rendered clean; the answer was in Cloud Run's
request method column, and the stack — `429 RESOURCE_EXHAUSTED` out of
`generateContent` with a digest — was in stderr 300ms after the 500.
