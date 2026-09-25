---
status: accepted
date: 2026-09-25
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [auth, identity, infra]
---

# A second sign-in domain widens the login gate, never the tenant

**Context.** `google.com` users needed to sign in to the `alwaysmap.com` deployment.
`AUTH_ALLOWED_DOMAIN` was the only gate, but it is also the tenant: the domain a bare
`@handle` expands to, the domain that names the Workspace groups, and the domain the
Chat sender check compares against (`orgEmailDomain()`). gh-255 showed what happens
when two meanings of "our domain" diverge: addresses were derived on the wrong domain
and resolved to a different person.

**Decision.** Sign-in widening is its own variable, `AUTH_ADDITIONAL_SIGNIN_DOMAINS`
(Terraform `additional_signin_domains`), read only by `src/lib/signInGate.ts`. It
changes who gets past the login page and nothing else. It is ignored when
`AUTH_ALLOWED_DOMAIN` is empty, so it can only widen a restricted deployment and never
become the whole gate. The gate trusts the `hd` claim when present and falls back to
the email suffix only when `hd` is absent.

**Alternatives rejected.**
- *Make `AUTH_ALLOWED_DOMAIN` a list.* Every tenant use would need a "which one"
  answer, and handle expansion has only one right answer. It would repeat gh-255.
- *Drop the domain gate and rely on the consent screen.* That leaves the app's
  boundary to console configuration it cannot check.

**Consequences.** Guests from another domain can read and write like tenant users. No
role separation exists, and this does not add one. The env var is not enough on its
own: an Internal OAuth consent screen rejects other domains' users at Google, so
the console step in OPERATIONS §3.2 is required. That consent screen is shared with the
Chat add-on chain (§6.0), so the recommended route is a separate project for the
sign-in client.

**Receipts.** `tests/signInGate.test.ts`; OPERATIONS §3.2.
