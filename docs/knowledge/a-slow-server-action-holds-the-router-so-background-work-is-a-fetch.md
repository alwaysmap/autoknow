---
title: A slow server action holds the router for its whole run — background work is a fetch to a route, never an action
status: current
updated: 2026-09-24
applies_to:
  - src/app/actions/**
  - a component that calls a server action from useEffect, or for anything that takes seconds (Gemini, ingestion)
  - src/components/SummaryPanel.tsx
symptoms:
  - a page is unresponsive, or links do nothing, until an AI briefing finishes
  - clicks and form submits "land" all at once, seconds late
  - navigation away from a page waits exactly as long as a pending Gemini call
verified_by: 'tests/SummaryPanel.test.tsx (the actions module throws if imported); Playwright on the demo, refresh held 12s: nav took 12.2s/12.4s via server action, 0.28s via fetch'
---

# A slow server action holds the router for its whole run

**The lesson.** Never do background or slow work through a server action. Call a
route handler with a plain `fetch`, keep the pending state in `useState`, and render
the response in place.

**Why it bites.** Next dispatches server actions one at a time per client, through the
same router action queue that navigations and refreshes use
(`node_modules/next/dist/docs/01-app/02-guides/server-actions.md`, "Sequential
dispatch"). While an action is in flight, the router's state is a pending promise set
inside a transition (`app-router-instance.js`, `dispatchAction`), so every later
action waits behind it and a click on a link does not commit until it resolves. The JS
thread is idle the whole time: a web worker would change nothing, because the wait is
in the router, not the CPU. The action "works" and every test is green. Only a person
trying to use the page notices.

**What to do.**
- Anything slow or unattended (`useEffect`, polling, AI generation) goes to
  `app/api/**` and is called with `fetch`, not `startTransition(action)`. The route
  returns the new data, and the component renders it without a `router.refresh()`.
- Server actions stay for quick mutations a person just asked for, where waiting on
  the result is the point.
- The route must return every refusal as a sentence, as the action did. Its
  auto-firing caller still owes the reader the reason (see
  [the page's critical path](a-server-action-a-component-auto-fires-is-on-the-pages-critical-path.md)).
- `POST /api/summaries/:scope/:id` and `SummaryPanel` are the reference pair.

**How we found out.** A partner page froze until its Gemini briefing finished. The
panel auto-fired `regenerateSummary` (an action) on mount. Holding that request for
12s in Playwright reproduced it: a nav click took 12.2s. Switched to `fetch`, the same
click took 0.28s.
