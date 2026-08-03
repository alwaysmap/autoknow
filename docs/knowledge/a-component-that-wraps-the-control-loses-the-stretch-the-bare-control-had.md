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
wrapper — `.wrap > input[type='text'] { width: 100% }`. Then measure rather than eyeball:
compare `getBoundingClientRect().width` across the converted field and an untouched one in
the same form.

Check for a specificity tie before reasoning about one, because the two halves of this fix
differ. For WIDTH there is no tie — nothing else declares a width on these inputs, so the
new rule is the sole owner and a bare class would have worked identically (the child
selector is chosen to avoid minting a class every caller must remember, not to win
anything). Where the shared class DOES declare the property, the tie is real and decided by
bundle order, which no component controls: `PhaseInvolvementEditor`'s compact inline row
overrides `font-size`, `padding`, `border`, `background` and `color`, all of which
`textInput` also sets, so it must out-specify with `.addForm .picker`. Reading "class
conflict, therefore out-specify" onto a property nobody else sets is a plausible-sounding
rationale for a rule that is doing nothing.

**How we found out.** Rolling `Combobox` into `ProjectMetaHeader`'s two pickers. A
screenshot showed the lead-partner and owner fields visibly narrower than the Target SOP
field below them; measuring gave 167.5px against 430px for what was, by class, the same
input. The defect had already shipped in `EscalationEditor`'s five pickers one PR earlier
and nobody caught it, because that dialog's other fields are a textarea and a `<select>`
rather than a row of matching text inputs — the mismatch had nothing to sit next to.
