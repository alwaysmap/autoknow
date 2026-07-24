---
title: A container that normalizes children with descendant selectors also restyles a `<dialog>` nested inside it
status: current
updated: 2026-07-24
applies_to:
  - src/components/KebabMenu.module.css
  - src/components/OverlayDialog.tsx
  - src/components/*AdminControls.tsx
symptoms:
  - dialog buttons render full-width, stacked, left-aligned, with no border or fill
  - a button only looks like a button on hover
  - a dialog header title wraps into a narrow column while its × takes a wide box
  - an element has the right module class, the rule is in the served CSS, and none of it applies
verified_by: 'tests/kebabMenuDialogIsolation.test.ts; #132; PR #136'
---

# A container that normalizes children with descendant selectors also restyles a `<dialog>` nested inside it

**The lesson.** `KebabMenu` makes its children uniform menu rows with descendant
selectors — `.menu button`, `.menu a`, `.menu div`, `.menu form`. Those match at
any depth, so a `<dialog>` rendered *inside* the menu is normalized too: its
buttons become full-width, left-aligned, borderless rows and its flex footer is
flipped into a stretched column. Put a modal's trigger in a menu, and render the
modal itself **outside** that menu — or make the container's rules structurally
unable to reach in.

**Why it bites.** `.menu button` is (0,1,1); a caller's own `.cancelBtn` is
(0,1,0), so the container wins on specificity even though the component looks
entirely correct. Nothing detects it: the markup is right, the class is on the
element, the CSS module resolves, the rule is present in the served stylesheet,
and no build or type error fires. Only the cascade is wrong, and only on screen —
so it survives every test that does not *look*. The tell that isolates it fast:
sibling elements the normalizer has no selector for keep their styling. In #132
the `<input>` next to the buttons rendered its `var(--border)` border perfectly,
which ruled out a missing-token or unloaded-stylesheet explanation and pointed
straight at a descendant selector.

**What to do.** Guard every rule that descends from the container with
`:where(:not(dialog *))` — `:where()` contributes no specificity, so genuine
rows still override callers' skins exactly as before, while anything inside a
dialog is out of reach. `.menu > *` takes `:where(:not(dialog))`.
`tests/kebabMenuDialogIsolation.test.ts` fails if a new rule is added unguarded.
Rendering the dialog as a sibling of the menu is still the better shape where one
component owns both (`PartnerEditor`, `PersonEditor`, `NewPersonButton` all do):
it keeps the dialog alive independently of the menu's light-dismiss. It is simply
no longer what holds the *styling* together.

**How we found out.** `KebabMenu.module.css` had carried a comment for months
saying a dialog "must be rendered as a SIBLING of KebabMenu, never a child",
naming the callers that complied. `ProjectAdminControls` did not, and its
delete-program confirmation shipped with a Cancel button invisible until hovered
— in the one dialog whose whole job is to slow someone down before an
irreversible delete. A prose contract in a comment gates nothing (AGENTS lesson
2); the same rule as a selector guard cannot be forgotten.
