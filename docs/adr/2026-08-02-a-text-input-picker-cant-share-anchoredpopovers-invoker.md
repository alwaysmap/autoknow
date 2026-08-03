---
status: accepted
date: 2026-08-02
supersedes: ""
superseded-by: ""
extends: ""
extended-by: "a-type-to-filter-picker-is-for-lists-unbounded-by-construction"
tags: [ui, a11y, forms]
---

# A text-input-driven picker cannot reuse `AnchoredPopover`'s dismiss model — share only the placement math

**Context.** gh-269 asked for a type-to-filter combobox to replace the bare
`<select>` entity pickers (`EscalationEditor` alone opens five). AGENTS
lesson 7 defaults to extending an existing shared primitive over forking one,
and `AnchoredPopover` is this app's one existing anchored-panel primitive. It
did not fit: its open/dismiss model is built on the native HTML Popover API,
which requires a `<button popovertarget="…">` invoker — unsupported on
`<input type="text">` per spec. A combobox's whole interaction model is
input-driven (type to filter, arrow to navigate, blur/Escape to revert), not
button-driven, so the mismatch is structural, not cosmetic.

**Decision.** Built a new `Combobox` component (`src/components/Combobox.tsx`)
implementing the ARIA combobox pattern from scratch — its own `role=combobox`
input, `role=listbox` panel, keyboard handling, and light-dismiss. It reuses
only the one genuinely input-agnostic piece of `AnchoredPopover`: the pure
`anchoredPosition()` placement function from `lib/anchoredPosition.ts`. The
DOM-reading/listener-wiring wrapper around that math (read the trigger's
`getBoundingClientRect()`, call `anchoredPosition`, write `position: fixed`
coordinates, re-run on resize/scroll/content-size change) is currently
duplicated between the two components, not shared.

**Alternatives rejected.**
- *Fork `AnchoredPopover` itself to accept an input invoker* — its dismiss
  semantics (native top-layer, `popovertarget`) are load-bearing for its
  existing 18 call sites; changing the invoker contract there risks all of
  them for the sake of one new caller.
- *Wrap the `<input>` in a hidden `<button>` invoker* — would restore native
  Popover API compatibility, but the button becomes a second focusable
  element a screen reader has to explain, and still doesn't give the input
  itself `aria-expanded`/`aria-controls`/`aria-activedescendant`, which the
  ARIA combobox pattern requires on the input directly.

**Consequences.** A second `position: fixed` anchoring effect now exists,
nearly identical to `AnchoredPopover`'s own — flagged in this change's
readability review and tracked as `autoknow-9yx` (extract a shared
`useAnchoredPosition` hook) rather than fixed inline, to keep this change's
blast radius to the new component. `UnifiedSearch.tsx` already hand-rolls a
*third*, non-identical roving-index listbox for its own suggestions — not
folded in here (different use case: navigational search, not a form field
with a committed value) but the next person reaching for "a dropdown list
with keyboard nav" should check both existing shapes before writing a fourth.

**Receipts.** PR #272; `autoknow-zl8` / gh-269; follow-up `autoknow-9yx`.
