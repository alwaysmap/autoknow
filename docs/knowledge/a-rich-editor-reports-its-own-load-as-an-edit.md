---
title: A rich editor re-serialises the value you hand it and announces the result as a change, so mounting one edits your form
status: current
updated: 2026-08-15
applies_to:
  - src/components/MarkdownNoteEditorImpl.tsx, or anything wrapping a third-party editor
  - a form whose dirty/unsaved-work state is fed by an onChange you do not control
symptoms:
  - "Can't perform a React state update on a component that hasn't mounted yet" on opening a panel or dialog
  - a Save button is enabled, or an unsaved-changes prompt fires, before anybody typed
  - stored markdown changes formatting (`- ` becomes `* `, blank lines appear) with no edit in the diff
verified_by: 'tests/phase_graph.spec.ts "opening a phase panel is not an edit — the description survives, Save stays off" (red without the guard); autoknow-6v9'
---

# A rich editor reports its own load as an edit

**The lesson.** A WYSIWYG editor does not store your string — it parses it into a document
model and serialises that model back out. The round trip is not the identity function, and
the editor announces its result through `onChange` **while mounting**, before any human has
touched it. Treat an emission arriving before the user has engaged as what it is — the
editor loading — and drop it, gating on a real interaction signal (focus, `beforeinput`)
rather than on a mount ref or string equality.

**Why it bites.** The React warning is the least of it, and the only part with a console
line. Measured on a seeded phase description, MDXEditor returned `* ` where the database
held `- ` and inserted a blank line after a bold lead-in — same document, different
dialect. Passed through, that did three things:

1. `setState` on a not-yet-mounted component — *"Can't perform a React state update on a
   component that hasn't mounted yet"*. Dev-only: it vanishes in a production build, so it
   is the one symptom your e2e suite cannot see.
2. The hidden input feeding the form held the **rewritten** markdown, so opening a phase
   card and pressing Save rewrote a description nobody had edited.
3. The caller's `onChange` fired, so the dirty flag unsaved-work guards read was set
   before any edit — prompting about work that does not exist, which trains people to
   dismiss the prompt.

**What to do.** Gate the callback, not the editor:

```tsx
const userEngaged = useRef(false);
// on the wrapper: onFocusCapture / onBeforeInputCapture set it true
const handleChange = (md: string) => {
  if (!userEngaged.current) return;   // the editor's own load-time re-serialisation
  if (md === markdown) return;
  setMarkdown(md); onChange?.(md);
};
```

Focus covers toolbar commands (they need a selection first) and `beforeinput` covers
typing and paste. A "have we mounted" ref would instead depend on whether your effect runs
before the editor's internal commit — an ordering that holds until a dependency bump. And
string equality cannot work at all, *because* the re-serialisation legitimately differs.

**How we found out.** `autoknow-6v9` reported the React warning on the phase DAG editor and
had been investigated twice without a cause — one round concluding it was load-time rather
than click-time, and ruling out the (innocent) `locationHash` patch. Patching
`console.error` to capture a stack named it in one step: Lexical's `$commitPendingUpdates`
→ the editor's pub/sub → our `onChange`. The data-side consequences turned up only by then
asking what the emission *contained*.
