---
title: A seeded row whose author is 'seed' is invisible to every person-scoped surface, including the one the fixture exists to prove
status: current
updated: 2026-07-26
applies_to:
  - src/lib/seed.ts
  - src/lib/activity.ts
symptoms:
  - a person page's Activity section is empty in the demo while /programs and /partners show plenty of activity
  - a new person-scoped feature looks broken against seeded data but its unit tests are green
verified_by: 'tests/personActivityScope.test.ts "returns only what this person recorded"; PR for autoknow-mi4 (#127 E10)'
---

# A fixture sourced to `'seed'` is invisible to every person-scoped surface

**The lesson.** Actorship in this app is a free-text string: `source` on `ProjectState`,
`PhaseState` and `PartnerState`, `addedBy` on `ContextUrl`. Almost every seeded row writes
the literal `'seed'`, which names no human, so **no person-scoped query can ever return
it**. Build a surface that filters by actor and the seeded database looks empty — while
the same rows fill the program and partner feeds, because those filter by SUBJECT and the
subject columns are real foreign keys.

**Why it bites.** The two filter axes look symmetric and are not. A subject filter joins
on a key the seed always populates; an actor filter matches a string the seed populates
with a placeholder. So the failure is invisible to unit tests (which author their own
rows, with real handles) and invisible to every existing page (which never filters by
actor) — and it surfaces only on first page load of the new feature, as an empty section
that reads as "this person did nothing".

**What to do.** When you add a person-scoped surface, **attribute the fixture rows it
must find to a real human first**, the way the app itself writes them: `source` is
`getCurrentUser().handle`, a bare handle that is stable across employment changes. Then
check the seed actually spans what you are trying to demonstrate — for a temporal surface
that means rows on both sides of a move. Do NOT reach for the ADDRESS of the era: a
handle is what the app writes, and an era address strands against `resolvePerson` by
design (#124 Class 4).

Some absences are structural rather than fixable and must be said in the UI instead:
API-written rows carry the literal `'API'`, and `ContextRevision` has no actor column at
all because re-distillation is machine-driven.

**How we found out.** The Alice Waters fixture (#124 §7) exists precisely to prove a
career renders correctly across three employers — and every one of its status updates was
`source: 'seed'`, so the person-scoped Activity feed built to demonstrate that rendered
nothing at all. Attributing her era updates to her handle turned the same fixture into
22 rows spanning Bosch 2022 → Qualcomm 2025 → Google now.
