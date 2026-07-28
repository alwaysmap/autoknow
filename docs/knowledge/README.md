# Knowledge notes — things this system taught us the hard way

A knowledge note records **a fact about how this system actually behaves** that
cost someone real time to discover, so the next person pays for it once instead
of every time. Not a decision (that is an [ADR](../adr/README.md)) and not a
rule (that is AGENTS.md or a skill) — a *finding*.

The test: **"I lost an hour to this, and nothing in the repo would have warned
me."** If a test, a type, or a lint rule could enforce it instead, write the
enforcement — an enforced fact needs no note (AGENTS lesson 2).

## The contract: front matter is the interface, the body is the payload

These notes exist to be **absent from context until they earn their way in**.
AGENTS.md is loaded into every session, so every line there taxes every session
forever; a knowledge note costs nothing until someone matches it. That asymmetry
is the entire design, and it only works if you can decide *whether to read a note
without reading it*.

So the front matter carries the two retrieval keys, and nothing decorative:

```yaml
---
title: The lesson itself, stated as a claim you could act on
status: current                      # current | superseded | retired
updated: 2026-07-22                  # living document — this is the reader's staleness signal
applies_to:                          # WHAT YOU ARE ABOUT TO TOUCH — matched while planning
  - src/**/*.module.css
symptoms:                            # WHAT YOU ARE SEEING — matched while stuck
  - element has the right classes but renders in the wrong place
verified_by: tests/usability.spec.ts "the dial reports the SEARCH"; PR #20
---
```

* **`applies_to` and `symptoms` are triggers, not topics.** A tag like `css` is
  useless for retrieval, because nobody goes looking for "a note about CSS" —
  they are editing a file, or staring at a symptom. Write the condition under
  which this note would have saved you.
* **`verified_by` is mandatory.** A finding with no receipt is folklore, and
  folklore is exactly what these replace.
* **`updated` + `status`, because docs state their status or they lie**
  (AGENTS lesson 10). A note whose subject was fixed upstream becomes
  `retired` — it is not deleted, because "we used to have to do X, and no longer
  do" is itself worth knowing.

## Notes vs. ADRs: living vs. immutable

| | ADR | Knowledge note |
|---|---|---|
| Records | a decision, with alternatives rejected | a finding about how things behave |
| Filename | `YYYY-MM-DD-slug.md` — dated | `slug.md` — **never dated** |
| Changes | never; a reversal is a NEW record | edited in place as understanding improves |
| Identity | the slug, cited by prose forever | the slug |

The date prefix is the visible marker of that difference: an ADR is a historical
act and carries the day it happened; a note is current understanding and carries
`updated:` instead. `tests/knowledgeNotes.test.ts` enforces the shape, the
required front matter, and the length cap.
