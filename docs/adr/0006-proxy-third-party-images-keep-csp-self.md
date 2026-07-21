---
status: accepted
date: 2026-07-21
supersedes: ""
superseded-by: ""
tags: [security, csp, ui, auth]
---

# 0006. Third-party images are proxied through our origin; `img-src` stays `'self'`

**Context.** Google Workspace profile photos are served from `*.googleusercontent.com`.
`next.config.ts` sets `img-src 'self' data: blob:` under a standing claim in its own
comment — "No third-party origins are loaded — everything else is 'self'". Showing the
signed-in user's photo therefore required either retiring that invariant or serving the
bytes ourselves.

**Decision.** Proxy. `/api/me/avatar` reads the picture URL from the session
server-side, validates it against a pinned host allowlist (`src/lib/avatar.ts`),
refuses redirects, checks content-type and size, and streams the bytes from our own
origin. The CSP is unchanged and no page makes a third-party request. Any future
third-party asset takes this route rather than a CSP entry.

**Alternatives rejected.**
- *Widen `img-src` to `https://*.googleusercontent.com`* — one line, but it spends a
  security invariant permanently and puts a Google request on every page load, in
  exchange for a decoration.
- *`next/image` with `remotePatterns`* — the same CSP widening, plus the optimizer, for
  a 30px asset our own route already caches.
- *Skip the photo* — offered and declined; initials alone were already correct.

**Consequences.** The risk moves server-side: the app now fetches a URL that arrived
over the wire, which is an SSRF primitive unless the host is pinned. The allowlist is
therefore the entire security boundary of the route, which is why it lives in its own
module with its own test file weighted toward rejections (lookalike hosts, the
`user@host` userinfo trick, `file:`/`data:`/`gopher:`, link-local `169.254.169.254`).
`redirect: 'error'` is deliberate — a redirect is the one way a request that starts
inside the allowlist finishes outside it; real Google avatar URLs return 200 with 0
redirects, so it costs nothing today, and re-validating each hop is the change to make
if that ever stops being true. The response is `Cache-Control: private` because the
path is identical for every user, so a shared cache would hand one person's face to
the next. Every failure path returns 404 and the UI falls back to initials: initials
are the resting state, and the photo is an enhancement that earns its way in by
loading.

Google returns a generic blue silhouette (`/a/default-user`) for accounts with **no**
photo. Serving it would replace informative initials with a graphic identifying nobody,
in a blue this palette reserves for links (design.md §6, §8b) — so it is treated as no
photo at all, and the layout asks the same allowlist the route does, rather than "is
there a URL?", so it never renders an `<img>` that only 404s. That was found by loading
the page and looking, not by reading the claim spec.

**Receipts.** 2026-07-21 session: `src/lib/avatar.ts`, `src/app/api/me/avatar/route.ts`,
`tests/avatarUrl.test.ts`; CSP at `next.config.ts`; session gate via `src/proxy.ts`
(the route is deliberately absent from that file's `isPublic` list).
