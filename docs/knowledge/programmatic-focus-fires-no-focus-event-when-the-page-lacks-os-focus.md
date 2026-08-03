---
title: In the automated browser, element.focus() moves activeElement but fires no focus event, so focus-triggered behaviour looks broken when it is not
status: current
updated: 2026-08-02
applies_to:
  - browser verification through the preview/browser tools
  - any component whose onFocus opens, selects, or loads something
symptoms:
  - document.activeElement is the right element but the focus handler plainly never ran
  - a dropdown that opens on focus stays shut when focused from JS, yet opens on a real click
  - aria-expanded stays "false" after autoFocus, and typing one character fixes it
verified_by: 'PR for autoknow-zl8 — a focus listener attached to the Combobox input counted 0 native focus events across blur()+focus() on /programs/1/phases, while the same component opened correctly under a real click in the program Edit dialog'
---

# Programmatic focus fires no focus event when the page lacks OS focus

**The lesson.** A page driven by the browser tools is often not the OS's focused window. In
that state `element.focus()` still updates `document.activeElement`, but the browser fires
no `focus`/`focusin` event — so React's `onFocus` never runs. Any behaviour hung off focus
(open a listbox, select the existing text, kick off a fetch) does not happen, and every
check you would reach for says the focus itself succeeded.

**Why it bites.** It produces a false positive for "my change broke focus handling" at
exactly the moment you are verifying focus handling, and the two obvious probes disagree
with each other in a way that looks like a component bug: `activeElement === input` is
true, `aria-expanded` is `"false"`. The natural next move — rewriting the focus code — is
work against a defect that does not exist, and the rewrite appears not to fix it, which
invites a second rewrite.

**What to do.** Prove focus events fire before concluding anything about a focus handler:
attach a listener and count them.

```js
let fired = 0; el.addEventListener('focus', () => fired++);
el.blur(); el.focus();   // fired === 0 → the environment, not the component
```

Zero means the environment. Verify the behaviour through a REAL click instead (the browser
tools' click dispatches proper input events and does trigger it), or through the path that
does not depend on focus at all — for a type-to-filter picker, typing opens the list on
`onChange` regardless. Unit tests are also unaffected, since jsdom's `fireEvent.focus`
dispatches the event directly.

**How we found out.** Verifying `Combobox`'s new `autoFocus` in the phase editor. The field
took focus and the list stayed shut, which read as the autofocus firing too early during
React's commit phase — a plausible mechanism with a plausible fix. Moving the focus into an
effect changed nothing, because the real cause was that no focus event had ever been
dispatched. The same component had already been seen opening correctly under a real mouse
click minutes earlier, which is the observation that should have been trusted first.
