---
title: A test that hard-codes the same answer the code hard-codes always passes, and its greenness becomes the evidence the feature works
status: current
updated: 2026-07-24
applies_to:
  - tests/**/*.spec.ts
  - sweeping for fabricated, placeholder or synthetic values
symptoms:
  - a panel or column never changes when the data changes, yet its test is green
  - a defect recurs on a second page after being fixed on the first
  - a sweep for hard-coded values finds nothing in src/ and the bug is still there
verified_by: 'tests/ecosystem_summary.spec.ts (the rewritten "Flow Constraint Diagnosis" block); #129; PR #137'
---

# A test that hard-codes the same answer the code hard-codes always passes

**The lesson.** When a component asserts a value instead of receiving it, and its
test asserts that same literal, the test passes *because of* the defect, not in
spite of it. The coverage is real, the assertion is real, and it proves nothing —
so the green run becomes positive evidence that the feature works. When you sweep
for fabricated values, **sweep the tests too**: `src/` is only half the surface.

**Why it bites.** The two hard-codings are written by the same person in the same
sitting, so they agree by construction, and nothing downstream can tell that
agreement from correctness. It is worse than no test, because a missing test
invites suspicion and a green one closes the question. In #129 the
"Flow constraint diagnosis" panel had five phase names typed into its JSX and
`ecosystem_summary.spec.ts` asserted two of them verbatim — so the panel shipped,
survived a review, and then survived the *same defect being fixed on the
neighbouring page*, because the suite kept saying it was fine.

**What to do.** Assert the **shape that moves when the data moves**, never the
value the fixture happens to hold: that the rendered phase is one this program
actually has, that the count matches the number of programs seeded, that the
badge follows the count. If an assertion would still pass with the database
switched off, it is testing the literal. When fixing any fabricated-value bug,
grep the specs for the same literals as part of the same change — the fix is not
complete while a test still pins the old answer.

**How we found out.** #129 deleted a Monte Carlo forecast blind to the real plan
and rewired the panel to the live critical chain. CI then failed on
`toContainText('Compliance Testing (Phase 3.1)')` and `toContainText('54 days')` —
the test demanding the fabricated literals back. The sweep that found the defect
had covered `src/**` and stopped there, on an issue whose entire subject was
"no surface renders a number it did not measure".

Related: [nothing is fabricated](../adr/2026-07-24-forecasts-derive-from-the-real-chain-never-a-synthetic-model.md)
is the decision this came out of.
