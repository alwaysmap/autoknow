---
status: accepted
date: 2026-07-21
supersedes: ""
superseded-by: ""
tags: [auth, identity, seed, demo]
---

# 0005. The signed-in session is the only source of "who I am"

**Context.** The mock seeder authored the lead-PM persona as a literal,
`dylan@google.com`. Real sign-in is Google Workspace, which returns whatever the
account actually is — `dylan@alwaysmap.com`. The two never met, so the app
disagreed with itself about the operator during a demo: the nav showed the login,
`/me` resolved to a person the seed had invented, and every program "you" owned
belonged to a stranger. A second, quieter defect had the same root: `/me` resolved
the user by `deriveEmail(currentUser.display)`, and because `display` is only
`@handle`, deriving an address back out of it re-applies the org default domain —
turning a `dylan@alwaysmap.com` login into `dylan@google.com` and landing on a
DIFFERENT person row. The seed cannot anticipate the address; it must stop trying.

**Decision.** Identity is read from the session, never authored. Two rules:

1. **The seed asks who is signed in.** `seedMockData` calls `getCurrentUser()` and
   binds the lead-PM persona to it — name and email both. It runs through the app's
   own API routes as the signed-in user, so the identity is already in hand. Every
   site that used to name Dylan now names `me.email`, which `resolvePerson` matches
   exactly, so this holds for any login rather than one person's.
2. **`CurrentUser.email` is the identity; `display` is a label.** `display` is
   lossy by construction. Anything resolving a user — `/me`, ownership, attribution
   — uses `.email` verbatim. `deriveEmail()` is only for a handle a human typed
   (the `?user=` stub-mode override), never for round-tripping our own session.

**Alternatives rejected.**

- *Seed a person for the real login alongside the personas.* Two rows for one
  human; `/me`'s name-contains fallback would still pick whichever came first.
- *Make the demo login match the seed (sign in as dylan@google.com).* The domain
  gate is `alwaysmap.com` — the address the seed wanted cannot sign in at all.
- *Rewrite every login's domain to the org default so it matches the seed.* This
  is exactly the `/me` bug, promoted to policy: it silently maps distinct people
  onto one identity.
- *Leave it; it is "logically explainable".* It is — and it still cost demo
  credibility every time, which is the whole point of a demo.

**Consequences.**

- Seeding now REQUIRES an identity, so it must run in a request context (the admin
  route, `npm run demo`, or a test that mocks `lib/session`). It cannot be a plain
  CLI script — already true for other reasons (`server-only`, API-route seeding).
- Seeded data is no longer byte-identical across machines: the persona differs per
  operator. Tests therefore assert *"the owner is the session user"*, never a
  literal address.
- `CurrentUser` gained a required `name`, sourced from the identity provider and
  falling back to a title-cased handle. Test mocks of `lib/session` must supply it.
- The personas that are NOT you (Alice, Clara, partner contacts) stay authored —
  only "me" is dynamic.

**Receipts.** The `dylan@alwaysmap.com` demo, 2026-07-21. Guards:
`tests/seedMock.test.ts` "the lead PM persona is the signed-in user, not a
hardcoded identity" (which also fails if the old literal reappears anywhere) and
`tests/identity.test.ts` "display is lossy — deriveEmail(display) is not the login
address". Related: AGENTS.md lesson 3 (entity references are canonical keys, never
free text) — this is the same rule applied to the operator's own identity.
