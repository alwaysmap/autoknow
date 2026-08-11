---
status: accepted
date: 2026-08-10
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ui, typography, color, tokens, tests]
---

# Hierarchy travels in size and ink — and the scale is enforced by ratchet, not prose

**Context.** The Refactoring UI audit (user-directed pass, PR #301) found the
app's visual hierarchy flat by construction: the section `<h2>` rendered
*larger and bolder* than the page `<h1>` on four pages (AnchorHeading set no
type, so the UA's `1.5rem/700` won), 17 distinct literal font-sizes carried no
level information, weight 600 marked every level at once, and every
`--head-font` + `700` pairing rendered browser-synthesized faux bold — Rubik is
loaded at 400/600 only. A suspected fifth finding — sites faking a tertiary
text colour with `opacity` — did **not** survive its own audit (autoknow-c43):
all 27 fractional opacities were states or marks.

**Decision.** Three channels, each with one owner, all enforced in software
(AGENTS lesson 2):

* **Size means role.** The `--fs-*`/`--lh-*` pairs in `globals.css` are the
  only font-sizes; picking a size is picking a role, and every pair pins an
  integer line box so §8d holds by construction. The living law — the table,
  the roles, the exemptions — is design.md **§7b**; this ADR records that the
  decision was taken and how it is held.
* **Ink means emphasis.** Three inks: `--fg` speaks, `--muted` supports,
  `--faint` whispers. De-emphasis is a softer ink, never a smaller size and
  never `opacity`. `--faint` shipped with **zero** consumers, deliberately: it
  is where the ratchet points future de-emphasis, not a conversion of sites
  that turned out not to exist.
* **Weight is binary.** 400 content, 600 structure; 700 is not loaded and is
  not a hierarchy channel. Body-font badge/tag chips are the named exemption
  (§7b).

**Enforcement, and the trap it closes.** `tests/vertical-rhythm.test.ts`
resolves `var(--fs-*/--lh-*)` *before* its whole-pixel checks — this landed in
the same commit as the tokens, because a rule converted to `var()` otherwise
silently leaves the test's sight — and holds two only-shrink allowlist
ratchets (off-scale literal sizes; fractional opacities), in the
`componentRootMargins` mold. Heading type is owned by `AnchorHeading` plus
`h1/h2/h3` element defaults; per-page heading blocks were deleted, and
`tests/headings.test.ts` now scans all stylesheets for the re-tint check.

**Rejected.** Loading Rubik 700 (weight would creep back as a fake third
channel); a `font-weight: 700` ratchet (the §7b exemption line is the lighter
mechanism — lesson 12); merging the program header's compact stat into
`StatTile` (post-eyebrow-unification they differ only in the figure, which is
the role distinction itself).
