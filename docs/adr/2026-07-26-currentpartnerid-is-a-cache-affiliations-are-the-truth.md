---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [data-integrity, identity, affiliations, lint, prisma]
---

# `Person.currentPartnerId` is a cache; the affiliation covering the day is the truth

**Context.** "Which company is this person at?" is a question about a DAY, and the
answer lives in the `PersonAffiliation` period containing that day (#124 §2, half-open).
Two cheaper-looking spellings sit next to it and each is right only while nobody has a
move recorded: `Person.currentPartnerId`, a denormalized cache that `movePersonCompany`
advances only once a move's date arrives — so it is stale by construction between
recording and effect, and cannot answer about any other day at all; and
`where: { endDate: null }`, which asks "is this period OPEN?". Record a future-dated move
and both diverge from the truth at once: today's period gains an `endDate` (so it looks
like history) while November's is open (so it looks current). The same defect has now been
diagnosed independently three times — #127 E2, E2a, and E5 — each time in a surface
nobody had thought to check, because each read *looked* locally reasonable.

**Decision.** Two sanctioned ways to ask, and no third.

1. **`src/lib/profiles.ts` when the rows are still in the database.** `profileAsOf`,
   `profilesAsOf`, `partnerRosterAsOf`, `partnerRostersAsOf` — the predicate goes into
   SQL against E4's composite index, so the wrong row never comes back to be filtered.
   `personIsAtPartnerAsOfSql` is the same sentence for the one hand-written query
   (`lib/search`'s UNION) that cannot call Prisma.
2. **`coversDay` in `src/lib/people.ts` when you already hold the periods.**

`currentPartnerId` stays a column and keeps being written, because it is a required FK
and because deletion guards must ask the reference whether a delete would break — but no
DISPLAY path reads it, and no page derives half an answer from it and half from the
affiliations. A surface that needs one fact reads it from one row.

**Enforcement is the point, not the migration.** `eslint.config.mjs` carries TWO rule
families, because their exemptions differ. One fails the build on `currentPartner` /
`currentPartnerId` / `currentEmployees` in any shape (member read, Prisma key, or raw-SQL
template text), and is switched off for the four files that maintain the cache. The other
fails on `endDate: null` as a property value, and is switched off only for the module
that DEFINES the as-of predicate and for test fixtures. Both are broad on purpose and
exempted BY FILE, exactly as the identity rule is — see
[the signed-in session is the only source of "who I am"](2026-07-21-session-is-the-only-source-of-who-i-am.md),
whose shape this copies deliberately. The migration fixes today's readers; the guard is
what stops tomorrow's (AGENTS lesson 2).

**Alternatives rejected.**

- *Drop the column outright.* It is a required FK on `Person` with a back-relation and
  live writers; removing it is a contract-phase destructive change and belongs in its own
  merge (expand → backfill → contract). Demoting it is the expand step.
- *Keep it correct with a trigger or a scheduled job that advances it at midnight.* Buys a
  cache that is right for exactly one day and still cannot answer about any other, which
  is what E10's as-of viewing needs. It also adds a second writer for a value the
  affiliation rows already determine.
- *Narrow the lint rule by context — allow the field under `data:`, forbid it under
  `select:`.* The wrong read is not a syntax the AST distinguishes: `currentPartner` in an
  `include` and in a `select` are the same node, and a context-narrowed selector is what a
  fourth spelling walks around. File-level exemptions keep each waiver a decision.
- *A test that greps the source instead of a lint rule.* A source-scan ratchet over JSX
  and template literals is the thing that has silently passed here before
  ([note](../knowledge/source-scan-over-jsx-props-truncates-at-an-arrow.md)); ESLint
  already has the parse tree.

**Consequences.**

- "No affiliation covers today" is now a renderable state — a gap between jobs, or a hire
  starting next month. Every converted surface degrades honestly (a blank company cell, an
  identity line that is just an address, a brief that names a person with no side) rather
  than printing a stale company. The cache could never express it.
- `/people/:id` asks `profileAsOf` once and defines History as the COMPLEMENT of that row
  by id, instead of re-deciding with `coversDay`. Two independent decisions could put a
  period in both sections or in neither, which is how the section broke before.
- **Creating a person now creates a period.** `createPersonAt` is the only sanctioned way
  to add a Person, and `POST /api/people` goes through it — because the API route used to
  create the row alone, which was invisible while the cache was the display source and
  became "no company anywhere" the moment it was not. This is a published-contract change:
  a caller that creates a person and then posts their real history now gets an OVERLAP,
  because the endpoint has no overlap validation. Mitigated, not fixed — the resolvers
  carry an explicit `orderBy` so an overlap resolves to the same row on every render
  rather than flickering. `autoknow-2of` adds the 409.
- One deliberate waiver remains: `movePersonCompany` still closes affiliations by
  `endDate: null`, which overlaps a career when a move is already scheduled. It carries an
  `eslint-disable` naming `autoknow-pvn`; removing that disable is the bead's acceptance
  test.
- **The guard is a good net, not a proof, and it is worth knowing where the holes are**
  rather than over-trusting it. It does not see: a column name inside `Prisma.sql` beyond
  the literal substrings the `TemplateElement` selector matches (hence
  `tests/profilesAsOf.test.ts` pinning `personIsAtPartnerAsOfSql` against the Prisma
  resolvers — nothing static can); `where: { endDate: { equals: null } }`, where the
  literal is a grandchild rather than a child; computed access (`person['currentPartnerId']`);
  and string-literal keys (`{ 'currentPartnerId': … }`). What it does close is every
  spelling that was actually in the tree, plus the hoisting escape — the `endDate`
  selector is deliberately NOT anchored under a `where` key, because an anchored one is
  defeated by moving the object literal up one line.

**Receipts.** PR #196 (`6c99fed`) shipped the resolvers and the two demonstrably-wrong
call sites; this record rides the PR that converted the remaining eleven files and shipped
the guard. Guards: the `no-restricted-syntax` rule (verified by planting a Prisma include,
an `endDate: null` where-clause and a raw-SQL column read, and confirming `npm run lint`
went red on all three), `tests/profilesAsOf.test.ts`, `tests/createPersonAt.test.ts`,
`tests/partnerQueries.test.ts` "lists only who is at the partner TODAY", and
`tests/people.spec.ts` "shows no company, rather than the stale cache" — the last verified
by mutation (making the directory fall back to a company turned it red). Related:
AGENTS lesson 7 — the sweep found the same defect wearing the back-relation's name
([note](../knowledge/a-prisma-back-relation-hides-the-field-you-are-grepping-for.md)).
