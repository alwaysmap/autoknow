---
name: Feature / improvement
about: New capability, or converging something that exists in several forms.
labels: enhancement
---

## What and why

<!-- The change, and the problem it solves. Ground it: measurements, a screenshot,
     the code that makes the current behaviour what it is. -->

## Pattern sweep — REQUIRED

Improvements have siblings too: the same control, drawing, or interaction
usually exists in several hand-rolled variants. Converge them in one pass rather
than leaving the next person to rediscover the others.

- **The pattern is:** <!-- e.g. "a trigger opening a panel anchored to it", not
  "the kebab menu" -->
- **Swept by:** <!-- the grep / query you ran -->
- **All places it occurs:** <!-- every one, each marked convert / assess / exempt
  with a reason -->

An improvement applied to one call site while three others keep their own copy
has added a variant, not removed one.

## Constraints

<!-- The rules this must not break — cite design.md sections and ADRs rather than
     restating them. Note the traps a re-implementation would lose. -->

## Acceptance

- [ ] Every occurrence from the sweep is converged, or explicitly excepted with a
      reason.
- [ ] The superseded variants are **deleted**, not left alongside the new one.
- [ ] Where the convention can be enforced mechanically, a check ships with it
      (AGENTS.md lesson 2).
- [ ] If this settles a question that was open or contested, it lands with an ADR
      or a design.md change — not only in code (`compound` skill).
- [ ] Verified from screenshots at 360 / 768 / 1024 / 1440, both themes, both
      styles, where the change is visual (§9, AGENTS.md lesson 18).
