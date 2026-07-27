---
status: accepted
date: 2026-07-27
supersedes: ""
superseded-by: ""
extends: ""
extended-by: "an-address-is-unique-at-an-instant-not-forever"
tags: [identity, affiliations, temporal, data-integrity, resolution]
---

# Resolution searches every address a person has held, and takes no date

**Context.** #124 §2 makes email a property of an employment PERIOD, and #127 E8 adds
`PersonAffiliation.email` to hold it. That raises a question the epic had not answered:
if a profile is now temporal, is `resolvePerson` — the matcher that turns a stored
string like `awaters@qualcomm.com` into a human — temporal too? The defect forcing the
question is #124 Class 4, visible in the seed: Alice Waters' 2025 action item is
addressed to the account she held at Qualcomm, and while a `Person` carried exactly one
address that string matched NOBODY. The item did not merely render the wrong company;
it detached from the only human it could mean, and `tests/seedMock` pinned that as
expected behaviour.

**Decision.** The first two tiers of `resolvePersonCandidates` (exact address, then
address local-part) search **every address a person has ever held** — `Person.email`
plus every non-null `PersonAffiliation.email`. **The matcher takes no `at` argument**,
and must not grow one.

1. WHO a string names is not a temporal question. It is the same human before and after
   the move, and `/people/:id` — the thing resolution produces — is correct on every
   day. What IS temporal is the PROFILE (which company, which title, which address),
   and `lib/profiles`' as-of resolvers already own that, per ADR
   `currentpartnerid-is-a-cache-affiliations-are-the-truth`. Two questions, two
   functions; a date on both would put the same fact in two places.
2. Within a tier, **whoever holds the address NOW sorts ahead of whoever merely held
   it.** Before E8 the exact-address tier could not be ambiguous at all, because
   `Person.email` is `@unique`; a pool including former addresses removes that
   guarantee, and without an order `resolvePerson`'s first-wins would be decided by
   whatever order `findMany` returned — the same non-determinism the E6 ADR rejected.
3. The directory a matcher is given must be fetched with `personDirectorySelect`, and
   `PersonLike.affiliations` is **required**, not optional. A directory built without it
   silently resolves current addresses only — i.e. it keeps the defect — and an optional
   field would let a new call site do that while staying green (AGENTS lesson 2).
4. The backfill that fills the column follows E6's rule unchanged (ADR
   `a-name-to-fk-backfill-writes-only-the-unambiguous`): `Person.email` is written to
   the ONE period covering the run instant, and to no other. Every historical period
   stays NULL, because nothing in this system records what address a job used before the
   column existed, and NULL means "not recorded" — the matcher skips it.

**Alternatives rejected.**

- *Give the matcher an `at` and match only addresses live on that date.* It sounds more
  temporal and is strictly worse. Nearly every caller has no meaningful date (a picker's
  default, a program-list owner column, a form seam), so they would all pass `now` and
  the parameter would be decoration. Worse, it would make resolution FAIL for a
  correctly-attributed old artifact whose period has a NULL address — the common case,
  since most history predates the column — turning "not recorded" into "not this
  person".
- *Match historical addresses but only when the current one misses.* A fourth tier, and
  it inverts the tie-break for free: a person whose FORMER address matches exactly would
  lose to a person whose CURRENT address merely shares a local part. The tiering already
  encodes strength of evidence; ordering within a tier is the right lever.
- *Keep resolution as it is and fix Class 4 by rewriting the stored strings.* Rewriting
  an artifact's captured `assignedTo` destroys the record of what was actually written
  at the time, which is the thing those columns exist to preserve.
- *Leave `PersonLike.affiliations` optional so the sweep is incremental.* Nine call
  sites build a directory; an optional field means the compiler cannot tell a
  deliberately narrow one from a forgotten one, and the failure mode — a person quietly
  stops resolving — produces no error anywhere.

**Consequences.**

- One address held by two humans in different decades is now genuinely ambiguous, and
  `resolvePersonCandidates` returns both. That is the honest answer, and it is the case
  #127 E9's unique-at-an-instant `EXCLUDE` constraint exists to police going forward.
  `resolvePerson` still answers, deterministically, with the incumbent.
- Every directory query got wider (one relation, one column). At hundreds of people this
  is free; the exact-address tier is served by a new `PersonAffiliation(email)` index,
  and the local-part tier stays an `ILIKE` scan exactly as the `Person` arm beside it
  already did.
- The address column is only as good as what writes it. `createPersonAt` stamps the
  period it opens, so everyone added from here on is correct by construction. Two seams
  still lose an address: `movePersonTo` opens a period it cannot know the address of,
  and `updatePerson` overwrites `Person.email` without first stamping the outgoing
  address onto the period it belonged to. Both are the unified effective-dated editor's
  territory (#127 E14) and are filed as bead `autoknow-wu0`, not silently left.
- `tests/seedMock`'s "exactly one seeded assignee fails to link" assertion inverts to
  "none does" — the defect was pinned in data on purpose, and this is the change that
  was supposed to unpin it.

**Receipts.** #127 E8 (bead `autoknow-vtg`), migration
`20260727020837_affiliation_email`. Verified by `tests/resolvePerson.test.ts` (a left
address resolves; a bare handle from a left address resolves; the incumbent outranks a
former holder; a null-address period never matches), `tests/affiliationEmailBackfill.test.ts`
(uncovered and overlapping careers stay NULL and are named; a second run writes nothing;
a later run stamps whichever period is current then), and `tests/seedMock.test.ts`
(nothing seeded strands, and Alice's Qualcomm-era item resolves to her).
