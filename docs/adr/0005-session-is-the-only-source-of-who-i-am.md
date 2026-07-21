---
status: accepted
date: 2026-07-21
supersedes: ""
superseded-by: ""
tags: [auth, identity, seed, demo, lint]
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

**Decision.** Identity is read from the session, never authored. Three rules:

1. **The seed asks who is signed in.** `seedMockData` calls `getCurrentUser()` and
   binds the lead-PM persona to it — name and email both. It runs through the app's
   own API routes as the signed-in user, so the identity is already in hand. Every
   site that used to name Dylan now names `me.email`, which `resolvePerson` matches
   exactly, so this holds for any login rather than one person's.
2. **`CurrentUser.email` is the identity; `display` is a label.** `display` is
   lossy by construction. Anything resolving a user — `/me`, ownership, attribution
   — uses `.email` verbatim. `deriveEmail()` is only for a handle a human typed
   (the `?user=` stub-mode override), never for round-tripping our own session.
3. **`CurrentUser` carries every field the UI displays, and nothing reaches past it.**
   (Added 2026-07-21, second incident — see Enforcement.) `getCurrentUser()` is the
   only read of the session's user *payload*; outside `src/lib/session.ts`, `auth()`
   may be used only for the *existence* of a session and for sign-in/sign-out. Adding
   a displayed identity field means widening `CurrentUser`, never adding a
   `session.user.*` read at a call site.

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
- *(For rule 3)* *Resolve the display name from the Person directory by email.* Puts a
  Prisma query in the root layout on every page render, and takes every page down when
  the DB is unavailable. The directory is domain data; the session is identity.
- *(For rule 3)* *Keep `CurrentUser` minimal and format names in components.* Every
  component then reimplements the same derivation — two divergent `initialsOf` copies
  already existed, one taking first+**second** word so a middle name displaced the
  family name.

**Enforcement.** Rule 3 is a lint gate, not a paragraph (AGENTS lesson 2).
`eslint.config.mjs` fails the build on any field read off a `.user`
(`no-restricted-syntax`), anchored on `.user` rather than the identifier `session`,
because the spellings are open-ended — `session.user.x`, `session?.user?.x`,
`(await auth()).user.x` and `s!.user.x` are four different AST shapes, and a probe
confirmed a session-anchored selector caught only two. Bare `session.user` stays legal:
that is the `signedIn` existence check. Exempt by name, so each exemption stays a
decision: `src/lib/session.ts` (builds `CurrentUser`) and `src/lib/routeAuth.ts`
(checks an email exists to admit a request, never displays it). The rule is broad
enough to over-match — `src/lib/chatEvents.ts` reads `chat.user` off a Chat *webhook
envelope*, an unrelated user, and carries one justified `eslint-disable` saying so. A
loud false positive costs a comment; a false negative is the defect that shipped.

**Consequences.**

- Seeding now REQUIRES an identity, so it must run in a request context (the admin
  route, `npm run demo`, or a test that mocks `lib/session`). It cannot be a plain
  CLI script — already true for other reasons (`server-only`, API-route seeding).
- Seeded data is no longer byte-identical across machines: the persona differs per
  operator. Tests therefore assert *"the owner is the session user"*, never a
  literal address.
- `CurrentUser` gained a required `name`, sourced from the identity provider and
  falling back to a title-cased handle, then a required `image` (the provider's photo
  URL, or null — server-side only, see ADR 0006). Test mocks of `lib/session` must
  supply both; that is rule 3's cost, and it is the point.
- The personas that are NOT you (Alice, Clara, partner contacts) stay authored —
  only "me" is dynamic.

**Receipts (rule 3).** Adding `name` to `CurrentUser` was not enough on its own:
`layout.tsx` kept reading `session?.user?.name ?? user.display` from a second `auth()`
call gated on `authConfigured`, so wherever `AUTH_GOOGLE_*` was absent — dev, demo,
e2e, and a production process that cannot see them — the nav still rendered `@dylan`
with `DY` initials. The identical shape recurred within one session when the profile
photo was added, which is what promoted it from bug to rule. Gate verified by
reintroducing the defect and confirming `npm run lint` fails on that exact line.

**Receipts.** The `dylan@alwaysmap.com` demo, 2026-07-21. Guards:
`tests/seedMock.test.ts` "the lead PM persona is the signed-in user, not a
hardcoded identity" (which also fails if the old literal reappears anywhere) and
`tests/identity.test.ts` "display is lossy — deriveEmail(display) is not the login
address". Related: AGENTS.md lesson 3 (entity references are canonical keys, never
free text) — this is the same rule applied to the operator's own identity.
