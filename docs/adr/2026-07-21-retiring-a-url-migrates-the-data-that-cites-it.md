---
status: accepted
date: 2026-07-21
supersedes: ""
superseded-by: ""
tags: [urls, data, ai, migrations]
---

# Retiring a URL deletes the route and migrates the data that cites it

**Context.** "Everything is a URL" (design.md §2) means in-app links are not only
written in components — they are **persisted**. AI briefs store their citation
hrefs inside `Summary.body` JSON, append-only, and a brief is regenerated only
once its scope goes stale, which can be never. Retiring `/history/phase/:id`
(2026-07-21) therefore had a failure mode that no grep of `src/**` would reveal:
every brief written before that day still cited the deleted page, so each bullet's
receipt would have rendered a 404. The 2026-07-20 retirement of the program and
partner history pages had the same exposure and got away with it only because
those citations pointed at `/programs/:id#status-history`, which survived.

**Decision.** Retiring a URL is two jobs, and neither substitutes for the other:

1. **Delete the route — a hard 404, never a redirect.** A retired URL must stop
   resolving, so nothing in the app can keep depending on it and no shared link
   quietly keeps a dead surface alive.
2. **Migrate the stored hrefs at the READ boundary**, in the function that loads
   the records (`getSummary`), not with a backfill. Resolve what the old URL
   referenced, emit the new one, and **drop the citation entirely** if its target
   no longer exists — a dead link is worse than one fewer receipt, and the
   bullet's words still stand. The rewrite is pure and unit-tested; the read pays
   a query only while a legacy href is still on file, so the shim costs nothing
   once briefs turn over and can then be deleted.

**Alternatives rejected.**
- *Redirect the old route* — keeps the retired pattern resolving, which is the
  one thing the retirement was for, and hides the stale rows instead of fixing
  them.
- *SQL backfill over `Summary.body`* — rewrites append-only records, needs a prod
  migration for what is a display concern, and still misses rows written by the
  outgoing revision during a rolling deploy.
- *Let briefs self-heal when they regenerate* — a brief that never goes stale
  never regenerates, so users click 404s indefinitely.
- *Leave the dead citation rendered* — a receipt that 404s is worse than no
  receipt; it discredits the bullet it was supposed to support.

**Consequences.** Any future change to a **cited** URL repeats this — retiring or
renaming one is a data question, not only a code question, and the pre-merge
check is "grep the database shapes too," not just `src/**`. Old shared links and
bookmarks break by design. Read-boundary shims accumulate if nobody deletes them,
so each one carries a comment naming the condition under which it goes away.

**Receipts.** The phase-history retirement (this branch): route deleted,
`getSummary` normalizes legacy citations, `tests/summaryLegacyCitations.test.ts`
pins the rewrite and the drop-on-missing-phase rule, `tests/history_retired.spec.ts`
guards the 404 and the replacement deep link. Precedent for the popup-replaces-page
half: design.md §4b (2026-07-20) and §5 (2026-07-21).
