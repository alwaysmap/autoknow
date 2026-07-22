---
title: A CSS-module class cannot win a `display` fight with a global `[data-*]` rule
status: current
updated: 2026-07-22
applies_to:
  - src/**/*.module.css
  - elements carrying data-inst-only / data-std-only
symptoms:
  - element has the right classes and the right markup but sits in the wrong place
  - flexbox properties (align-items, justify-content, gap) appear to do nothing
  - a style-conditional graphic leaks into the style that should hide it
verified_by: 'tests/usability.spec.ts "the CTA dial is HIDDEN in Standard"; the dial-in-field move, 2026-07-22'
---

# A CSS-module class cannot win a `display` fight with a global `[data-*]` rule

**The lesson.** `globals.css` reveals style-conditional graphics with
`:root[data-style="instrument"] [data-inst-only] { display: inline }` — that is
specificity **0-3-0**. A CSS-module class is **0-1-0**. So any `display` a module
class declares on such an element is overridden, silently, and the loss is
invisible in the DOM: the class is applied, the rule is present in devtools,
and only the computed `display` is wrong.

**Why it bites.** The failure does not look like a specificity problem. It looks
like a layout bug, because the *consequence* is that every layout property
depending on the lost `display` stops applying: `align-items: center` on a slot
that silently became `block` centres nothing, and the child drops to the top of
its box. You go looking at the geometry, which is correct.

**What to do.** On any element carrying a global `data-` attribute, **write CSS
that does not depend on `display` at all**. Centre by position
(`top: 50%; transform: translateY(-50%)`), size by explicit width/height, space
by margin. If you genuinely need a flex context, put it on a *child* the global
rule does not target. Do not fight it by raising specificity: the same tie in
the other direction already leaked the CTA dial into the Standard style, which
is why the hide rule is `:root [data-inst-only]` (0-2-0) rather than bare
`[data-inst-only]` (0-1-0) in the first place.

**How we found out.** Moving the search dial from the CTA button into the search
field. The slot was `display: flex; align-items: center`; it rendered as a block
and the dial sat against the top edge of the input. Caught by looking at the
page, not by any test — the DOM audit would have reported a correctly classed
element in a correctly sized slot (AGENTS lesson 18: sign overlays off from a
screenshot).
