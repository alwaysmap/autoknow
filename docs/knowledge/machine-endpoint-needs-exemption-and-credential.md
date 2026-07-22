---
title: A machine-called endpoint needs three things in src/proxy.ts, not one
status: current
updated: 2026-07-22
applies_to:
  - src/proxy.ts
  - src/app/api/**/route.ts
  - adding an endpoint called by cron, a scheduler, Google, or curl
symptoms:
  - a machine caller gets a 302 to /login instead of a response
  - a new endpoint works locally but 401s or redirects in prod
  - an endpoint is reachable from the internet with no credential
verified_by: 'src/proxy.ts `isPublic` allowlist + `limitFor`; src/app/api/cron/refresh/route.ts (CRON_SECRET), src/lib/routeAuth.ts (ADMIN_TOKEN)'
---

# A machine-called endpoint needs three things in `src/proxy.ts`, not one

**The lesson.** A caller that is not a browser can never hold a session, so the
route gate will redirect it to `/login` forever. Making it work takes **three**
edits, and doing one or two of them is either broken or exposed:

1. **A session-gate exemption** — add the path to the `isPublic` list in
   `src/proxy.ts`. Without it: 302 to `/login`, which a machine reads as success
   with an HTML body.
2. **Its own credential**, checked by the route itself. The existing shapes are
   `CRON_SECRET` as a bearer token (`/api/cron/*`), Google's JWT (`/api/chat/*`),
   and `ADMIN_TOKEN` via the `x-admin-token` header (`/api/admin/*`, validated in
   the proxy *and* re-checked timing-safely in `src/lib/routeAuth.ts`). Without
   it: an exemption is a hole straight to the internet.
3. **A rate-limit class** in `limitFor`, if the route is expensive. Anything
   invoking Gemini is a cost-amplification target — `/api/summaries` POST is
   capped at 10/min for exactly this reason.

**Why it bites.** The three live in different places and only one of them fails
loudly. Forget the exemption and you notice immediately. Forget the credential
and *everything works* — which is what makes it the dangerous one. The gate is
deliberately coarse belt-and-braces (`/api/admin` token validation happens in the
proxy so a future admin route that forgets its own check is still not exposed),
so passing the proxy is not evidence that the route is protected.

**What to do.** Write all three in the same PR, and prove the credential by
calling the endpoint *without* it and asserting the rejection — not by calling it
with the credential and asserting success. `/api/health` is the one deliberate
exception: exempt and credential-free, because it returns nothing secret.

**How we found out.** Carried as AGENTS lesson 4 since the refresh worker and the
Chat relay were added; promoted here when the lessons list was de-duplicated
against the skills, because no task skill owns endpoint work and the *how* had
never been written down anywhere.
