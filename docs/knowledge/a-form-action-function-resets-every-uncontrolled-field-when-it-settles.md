---
title: React 19 resets a `<form action={fn}>` when the action settles, so returning an error inline still blanks every uncontrolled field
status: current
updated: 2026-08-15
applies_to:
  - any `<form action={serverAction}>` or `useActionState` form in src/
  - src/lib/useDialogAction.ts and its callers
  - adding an inline validation message to a form
symptoms:
  - the error message renders correctly but the field it is about is suddenly empty
  - a user is told to fix a name/title and the box shows the old value, or nothing
  - "returning { error } instead of throwing" did not actually preserve the user's input
verified_by: 'tests/templates_ui.spec.ts "renaming onto another template''s name refuses inline"; autoknow-6ls; autoknow-t5u'
---

# React 19 resets a `<form action={fn}>` when the action settles

**The lesson.** Passing a *function* to `<form action>` opts the form into React 19's
automatic reset: when the action's promise settles — success **or** refusal — React calls
`requestFormReset` on it, and every uncontrolled field snaps back to its `defaultValue`.
So the well-known fix of RETURNING `{ error }` rather than throwing gets you only half of
what it promises. The dialog stays mounted and the message renders; the sentence the user
typed is gone anyway. Any field an inline refusal asks the user to correct must be
**controlled** (`value` + `onChange`), or the refusal is unactionable.

**Why it bites.** The reasoning that leads you to return-instead-of-throw is entirely
about preserving user input — `src/lib/useDialogAction.ts` says so in its own header,
that a throw "unmounts the modal and destroys whatever the user had typed". That
reasoning is correct and the fix is incomplete, which is the worst combination: the code
looks like it solved the problem, the tests assert the error text and pass, and the
failure only appears to a human who typed something. It is also invisible in jsdom unit
tests, because they assert on the returned object rather than on what the input holds
after a real submit.

**What to do.** Control the fields a refusal can name:

```tsx
const [name, setName] = React.useState(template.name);
<input name="name" value={name} onChange={(e) => setName(e.target.value)} />
```

and sign it off in a **real browser**, asserting the field's value after the refusal —
not just that the message appeared:

```ts
await expect(page.getByTestId('meta-error')).toContainText('already exists');
await expect(page.getByLabel('Template name')).toHaveValue('Digital Key (copy)'); // survived
```

**How we found out.** `autoknow-6ls` made `updateTemplateMeta` return a named conflict
instead of throwing a raw P2002. The Playwright test asserted the message *and* the input,
and only the second assertion failed: `aria-invalid="true"` was set, the sentence read "A
template called X already exists", and the box had reverted to the template's old name.
Probing the same shape at `/escalations` — fill the statement, save with no partner —
showed the refusal rendering over an empty field there too. `autoknow-t5u` tracks the
repo-wide sweep, which wants one shared answer in `useDialogAction`, not a controlled
field hand-added to each of the three editors.
