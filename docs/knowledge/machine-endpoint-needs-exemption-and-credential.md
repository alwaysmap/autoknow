---
title: A machine-called endpoint needs three things in src/proxy.ts, not one
status: current
updated: 2026-07-25
applies_to:
  - src/proxy.ts
  - src/app/api/**/route.ts
  - adding an endpoint called by cron, a scheduler, Google, or curl
symptoms:
  - a machine caller gets a 302 to /login instead of a response
  - a new endpoint works locally but 401s or redirects in prod
  - an endpoint is reachable from the internet with no credential
verified_by: 'tests/proxyGate.test.ts; src/proxy.ts `isPublic`/`acceptsAdminToken`/`limitFor`; src/lib/routeAuth.ts'
---

# A machine-called endpoint needs three things in `src/proxy.ts`, not one

**The lesson.** A caller that is not a browser can never hold a session, so the
route gate will redirect it to `/login` forever. Making it work takes **three**
edits, and doing one or two of them is either broken or exposed:

1. **A session-gate exemption** — add the path to the `isPublic` list in
   `src/proxy.ts`, or to `acceptsAdminToken` if the credential is `ADMIN_TOKEN` (the
   proxy then validates the header VALUE, so the route is not merely opened).
   Without it: a 307 to `/login`, which a machine reads as success with an HTML
   body.
2. **Its own credential**, checked by the route itself. The existing shapes are
   `CRON_SECRET` as a bearer token (`/api/cron/*`), Google's JWT (`/api/chat/*`),
   and `ADMIN_TOKEN` via the `x-admin-token` header (`/api/admin/*`, validated in
   the proxy *and* re-checked timing-safely in `src/lib/routeAuth.ts`). Without
   it: an exemption is a hole straight to the internet.
3. **A rate-limit class** in `limitFor`, if the route is expensive. Anything
   invoking Gemini is a cost-amplification target — `/api/summaries` POST is
   capped at 10/min for exactly this reason.

**Why it bites — none of the three fails loudly. The gate does not exist in any
posture a developer or a test runs in.** `src/proxy.ts` is a no-op when
`AUTH_GOOGLE_*` are unset — dev, CI, e2e, and any `localhost:3000` curl. A missing
exemption is therefore invisible outside production, and a missing credential is
invisible *including* production. The gate is also deliberately coarse
belt-and-braces, so passing the proxy is no evidence the route is protected.

**What to do.** Write all three in the same PR, and prove the credential by
calling the endpoint *without* it and asserting the rejection — not by calling it
with the credential and asserting success. `/api/health` is the one deliberate
exception: exempt and credential-free, because it returns nothing secret. Then let
the ratchet remember for you (AGENTS lesson 2): `tests/proxyGate.test.ts` runs the
gate with auth **configured** and puts every `src/app/api/**` route that reads a
machine credential through the real proxy — a new one must be reachable with its
token or be named in that file's `SESSION_ONLY` list, and that listing is checked
too. Probe the deployed origin as well; a `307` to `/login` is the signature.

**How we found out.** Carried as AGENTS lesson 4 since the refresh worker and the
Chat relay were added; promoted here when the lessons list was de-duplicated
against the skills. Rewritten after #157: `POST /api/integrations/chat` had the
credential and not the exemption, and prod answered `307 → /login` to a *valid*
token — the value being irrelevant is the tell. Found while retiring an unrelated
Chat relay and probing the endpoints from outside.
