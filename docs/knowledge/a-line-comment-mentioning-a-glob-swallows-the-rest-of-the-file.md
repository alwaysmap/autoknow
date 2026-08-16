---
title: A `//` comment mentioning a glob opens a block comment, and the source scan reading that file then passes over source it never saw
status: current
updated: 2026-08-15
applies_to:
  - tests/helpers/sourceFiles.ts
  - any test calling stripComments to scan src/** for a forbidden pattern
  - writing a `//` comment that contains a glob, a path pattern, or a regex
symptoms:
  - a source-scan test passes while the thing it forbids is plainly in the file
  - an assertion that a module EXPORTS a function fails, though the export is right there
  - a scan reports zero offenders and the corpus-size guard still passes
verified_by: 'tests/dateFormattingIsOneModule.test.ts (the export assertions, which failed first); tests/helpers/sourceFiles.ts stripComments ordering; autoknow-dn8'
---

# A `//` comment mentioning a glob swallows the rest of the file

**The lesson.** `stripComments` used to remove BLOCK comments first and line comments
second. A `//` comment containing `src/**` — or `/*.tsx`, or a regex literal — contains
the two characters that OPEN a block comment, so the block pass started there and ran to
the file's next real `*/`, deleting everything between. In a documented module that is
most of the file. Every scan over the stripped text then reported clean, over source it
had never looked at.

**Why it bites.** It is a **fail-open** guard, which is the failure mode AGENTS lesson 2
exists to prevent, and it is silent in both directions. The scan finds no offenders — which
is what "passing" looks like. The corpus-size guard that every scan here owes (`expect(
files.length).toBeGreaterThan(100)`) still passes, because the FILE LIST is fine; it is the
file CONTENT that vanished. And the damage is proportional to how well-commented a module
is, so the files most likely to be swallowed are exactly the ones a convention test most
wants to read.

The tell is oblique. This was not found by a scan wrongly passing — it was found by an
unrelated assertion in the same test, that `lib/dates.ts` exports `isoDate`, failing
against a stripped source in which `export function isoDate(` no longer existed. Without
that second assertion the bug would have shipped as a green test.

**What to do.** Strip LINE comments first, then block comments — the order the helper now
uses. A `//` line is removed before the block pass can see the `/*` inside it, and a line
starting with `//` inside a block comment is being deleted either way. If you write a new
scan, assert something POSITIVE about the stripped text as well as the absence you care
about: "the pattern still matches the one legitimate site" catches a stripper that ate the
file, where "no offenders" never can.

**How we found out.** Adding `tests/dateFormattingIsOneModule.test.ts` (autoknow-dn8),
whose subject module's header opens with a sentence about `src/**`.
