---
status: accepted
date: 2026-08-09
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ui, preferences, navigation]
---

# A collapsed section is a claim about the section, not the entity

**Context.** Detail sections on program-shaped pages (hill, Critical chain, phases,
escalations, activity — and the partner page's five) became collapsible with the state
persisted per browser (bead `autoknow-hcz.15`, owner request 2026-08-09: "localStorage").
Three storage shapes were on the table, and two rendering shapes.

**Decision.** One registry preference (`COLLAPSED_SECTIONS`, #31) holding a list of
per-SECTION ids (`programs:chain`, `partners:people`) — never per-entity keys. Collapsing
"Critical chain" collapses it on every program, and the initiative copy page shares the
`programs:*` ids because it is program-shaped. Collapsed is CSS-hidden, not unmounted:
`CollapsibleSection` folds everything off the heading row's path, and every anchor target
in the body stays in the DOM. Arriving at a fragment whose target lives inside a
collapsed section EXPANDS it, persistently — an address is a promise the content is
shown, and arrival is as explicit a request as the chevron.

**Alternatives rejected.**
- *Per-entity keys (`programs:17:chain`).* An unbounded pref a reader must re-collapse on
  every program — the dearer mental model, and a registry entry that can never be
  finitely validated.
- *A raw localStorage hook beside the registry.* A second persisted-pref pattern one
  drift away from the §8c two-defaults landmine the registry exists to close.
- *Unmounting the collapsed body.* Breaks `#phase-7`-style deep links (nothing to
  resolve), discards host state (an open card, a loaded log) on every toggle, and forces
  the expand-on-arrival handler to wait a render before it can scroll.
- *Transient (non-persisted) expand on arrival.* A reload of the deep-linked page would
  re-fold the very section the link promised.

**Consequences.** The heading row is always visible (a folded section stays findable and
addressable) and hosts the chevron via `SectionCollapseContext` — so components that own
their heading (ChainLedger, PhaseTrack) gain the affordance without hoisting it. While
collapsed, the heading's OTHER actions hide with the body they act on (a ⓘ legend over a
hidden chart; a `<dialog>` in a folded subtree cannot paint). The deliberate give-ups: a
stored collapse applies at hydration, not pre-paint (the #31 boot script guards only the
appearance axes — a per-section inline script is not worth the flash it would remove),
and the programs-page hill chart gained the heading it deliberately lacked, because a
collapse affordance needs a labelled row to ride on (§8c) and a folded section with no
title is unfindable.

**Receipts.** Bead `autoknow-hcz.15`; `tests/collapsible_sections.spec.ts` (persistence,
per-section scope, deep-link expand, host-owned headings); `tests/preferences.test.ts`
round-trip cases.
