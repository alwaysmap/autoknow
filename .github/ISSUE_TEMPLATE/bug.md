---
name: Bug
about: Something behaves wrong. Fix every instance of it, not just this one.
labels: bug
---

## What happens

<!-- The observed behaviour, with a reproduction. Measure it where you can:
     "429px past a 658px viewport" beats "overflows". -->

## Why

<!-- The mechanism, with file:line. If you have not found the mechanism, say so —
     a guess stated as a cause sends the next person down it. -->

## Pattern sweep — REQUIRED

The same defect almost always exists somewhere else in a different disguise
(AGENTS.md lesson 7). Name the pattern, then say where else it occurs.

- **The pattern is:** <!-- e.g. "a CSS-module class losing a specificity tie to a
  global [data-*] rule", not "the dial was mispositioned" -->
- **Swept by:** <!-- the grep / query you actually ran, so the next person can
  re-run it -->
- **Other instances found:** <!-- list them, or "none — sweep was: <command>" -->

An issue that fixes only the reported instance is not done. If a sibling is
deliberately left alone, say which and why.

## Acceptance

- [ ] The reported instance is fixed.
- [ ] Every instance found by the sweep is fixed, or explicitly excepted with a
      reason.
- [ ] Where the pattern can be caught mechanically, a check ships with the fix
      (AGENTS.md lesson 2) — an enforced rule needs no memory.
- [ ] Verified the way the defect actually manifests. For anything visual that
      means a screenshot in both themes (AGENTS.md lesson 18); counting elements
      proves existence, not visibility.
