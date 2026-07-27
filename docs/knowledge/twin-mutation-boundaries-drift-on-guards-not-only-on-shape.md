---
title: When two mutation boundaries write the same row, the shape audit is also the cheapest authorization audit — check the GUARDS, not only the fields
status: current
updated: 2026-07-27
applies_to:
  - src/app/actions/**
  - src/app/api/**/route.ts
  - routing a server action through the zod schema its twin already uses
symptoms:
  - two boundaries write one table and only one of them refuses a bad reference
  - a form action and its JSON route disagree about what they verify before writing
  - a crafted post reaches a row the UI could never have named
verified_by: 'tests/phaseHill.test.ts "refuses a real phase hung off the WRONG program"; tests/actionFormGate.test.ts; autoknow-679 / autoknow-9l4'
---

# The shape audit between twins is also the cheapest authorization audit

**The lesson.** Several rows here are written from two places at once — a form
server action and a JSON API route, or a person action and its partner mirror.
When you converge one twin onto the other's zod schema, do not stop at the
fields. Diff what each twin **verifies before writing**, too. Every conversion so
far has found a guard on one side that the other never had, and the guards are
the half that matters: a missing bound writes a bad number, a missing parentage
check writes to somebody else's row.

**Why it bites.** The two halves are usually written months apart by whoever
needed that surface, and neither one reads as incomplete on its own. Nothing in
`updatePhaseHill` hinted that its JSON twin refused a phase/program mismatch with
a 404 while it refused nothing — that only became visible with both files open,
which is a state you are in exactly once: during the shape conversion. Worse, the
shape work makes the file *look* audited afterwards, so the next reader has less
reason to open the twin, not more.

**What to do.** While converting, list what the twin does between parsing and
writing, and account for each line as either present here or deliberately absent.
Two rules make the accounting quick, and they are the same two every time:

- A **schema owns SHAPE** — is this an id, is it in range, is the note non-empty.
  Share the bound BY REFERENCE (one `zHillProgress`, three schemas); a bound
  copied per boundary is a bound that can go missing from one of them silently,
  which is precisely how a hill percentage of 150 became writable.
- A **resolver owns RESOLUTION** — does this row exist, and does it belong where
  the form claims. `parseForm` can never answer these, so converting an action to
  `parseForm` neither adds nor removes them; if the twin has one and you do not,
  that is a finding, not a style difference.

Prove the guards survive by MUTATION rather than by reading — break each one,
watch the suite go red, restore from a scratchpad copy (not `git checkout`, see
the sibling note on that trap), re-run green.

**How we found out.** `autoknow-679` converted `addPhasePartner` to its person
twin's schema and found three redundant shape guards. Its sweep produced
`autoknow-9l4`, whose conversion of `updatePhaseHill` found two things the shape
audit was not looking for: an unbounded percentage (150 was writable and drew a
dot off the end of the hill), and no parentage check at all, where the JSON twin
had refused a mismatched phase/program pair since #219. Tests were green
throughout — both gaps were absences, and nothing tests an absence.
