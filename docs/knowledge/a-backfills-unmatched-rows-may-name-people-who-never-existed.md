---
title: A backfill's UNMATCHED rows may hold values that never named anybody — date the fixture before you touch the matcher
status: current
updated: 2026-07-27
applies_to:
  - src/lib/ownerBackfill.ts
  - scripts/db/backfill-*.ts
  - src/lib/seed.ts
symptoms:
  - a backfill reports a row UNMATCHED whose value is plainly a person's name, and that person is right there in the seed
  - the same value resolves fine against a freshly seeded database and matches nobody in prod
  - you are about to widen a resolver tier so that one stubborn row links
verified_by: 'tests/resolvePerson.test.ts "falls back to an exact case-insensitive full name"; tests/seedMock.test.ts "program owners are canonical emails of existing people"; git log -S over src/lib/seed.ts (4ded811 vs 30952e6); PR #222'
---

# A backfill's UNMATCHED rows may hold values that never named anybody

**The lesson.** When a one-shot backfill reports rows UNMATCHED, the first
question is not "which tier is the matcher missing?" but **"did this value ever
name a row, on the day it was written?"** Prod is older than the seed. A free-text
value the seed authored before the roster it names existed was matched against
that day's roster, not the one you are reading in `src/lib/seed.ts` today. Answer
it with `git log -S '<the exact value>' -- src/lib/seed.ts` before changing any
resolution code.

**Why it bites.** `resolvePersonCandidates` has a full-display-name tier, so a
value like `Clara Operations` resolves the moment a Person by that name exists.
That makes "it matches locally, it does not match in prod" read exactly like a
matcher bug, and the obvious fix — widen a tier — is both wrong and permanent:
resolution feeds pickers and dual-writes, so a looser tier silently attaches
owners everywhere, to fix two rows in one table. The real cause here was that
`ownerName: 'Alice PM'` and `ownerName: 'Clara Operations'` were authored in the
initial commit (4ded811) against a people list that contained neither name; the
Person rows arrived in 30952e6. Prod was seeded in that window, so those two
programs have carried a string that named nobody from the day they were created.

**What to do.** Date the value first (`git log -S`, against the file that wrote
it). If it never named anything, the remediation is DATA — re-pick the owner, or
re-run the backfill after the missing rows exist — and the code fix is to stop
the fixture emitting free text at all. Seeded owners are now `SeededPerson`
values, not strings (`createProject` in `src/lib/seed.ts` takes the created row),
so the compiler refuses an owner the seed did not create. Only if the value DID
name a row on its own day is a matcher gap real, and that is its own bug with its
own bead — never a quiet widening folded into somebody else's PR.

**How we found out.** #127 E6's production backfill reported `linked 9 /
unmatched 2 / ambiguous 0`, and both unmatched rows named seeded people. Every
local run was clean, and every resolver test was green, because both facts were
true of today's seed and neither was true of the database being backfilled.
