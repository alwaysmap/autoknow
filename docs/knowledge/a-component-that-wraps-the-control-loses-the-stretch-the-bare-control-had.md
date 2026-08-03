---
title: Swapping a bare form control for a component that wraps it silently loses the flex stretch, and the field renders at its intrinsic width
status: current
updated: 2026-08-02
applies_to:
  - src/components/Combobox.tsx
  - any replacement of a bare <select>/<input> with a component that renders a wrapper
  - src/components/*.module.css rules on .textInputGroup children
symptoms:
  - the new field renders much narrower than the untouched fields above and below it
  - the element carries exactly the same class as its full-width siblings and still differs
  - a text input sits at roughly 20 characters wide for no reason you can find in the CSS
verified_by: 'PR for autoknow-zl8 — measured 167.5px vs 430px for identical `textInput` classes in the program Edit dialog, fixed by `.wrap > input { width: 100% }` in Combobox.module.css'
---

# A component that wraps the control loses the stretch the bare control had

**The lesson.** When a shared component replaces a bare `<select>` or `<input>`, the form
field stops being the element the parent layout is sizing. `.textInputGroup` is
`display: flex; flex-direction: column`, so its children stretch to full width by default —
that is where every field in these dialogs gets its width, and nothing says `width` anywhere.
Drop in a component that renders `<div class="wrap"><input …></div>` and the DIV becomes the
flex item that stretches; the input inside it is now an ordinary block-level child of a
plain div, sized by its own intrinsic width — about 20 characters. Copying the sibling's
class onto the input does not help, because the class was never what made it wide.

**Why it bites.** Every visible signal says the markup is right. The input carries the
identical `dash.textInput` class as the full-width field beside it, the CSS module has no
missing key, nothing errors, and reading either file alone shows nothing wrong — the width
lived in the RELATIONSHIP between the old element and its parent, and that relationship is
what the wrapper broke. It reads as a styling bug in the new component, so the search
starts in the wrong file.

**What to do.** A component that wraps a form control must make the control fill the
wrapper — `.wrap > input { width: 100% }`. Use a CHILD selector, not a bare class: the
shared `textInput` class is also one class, so two single-class selectors tie on specificity
and the winner is then whichever module lands later in the bundle, which no component
controls. The same reasoning is why a call site that wants the field NARROWER
(`PhaseInvolvementEditor`'s compact inline row) must out-specify with `.addForm .picker`
rather than trusting its own module to come last. After fixing one, measure the siblings:
compare `getBoundingClientRect().width` across the converted field and an untouched one in
the same form rather than eyeballing it.

**How we found out.** Rolling `Combobox` into `ProjectMetaHeader`'s two pickers. A
screenshot showed the lead-partner and owner fields visibly narrower than the Target SOP
field below them; measuring gave 167.5px against 430px for what was, by class, the same
input. The defect had already shipped in `EscalationEditor`'s five pickers one PR earlier
and nobody caught it, because that dialog's other fields are a textarea and a `<select>`
rather than a row of matching text inputs — the mismatch had nothing to sit next to.
