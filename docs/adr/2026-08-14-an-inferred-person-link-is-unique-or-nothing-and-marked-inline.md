---
status: accepted
date: 2026-08-14
supersedes: ""
superseded-by: ""
extends: "a-name-to-fk-backfill-writes-only-the-unambiguous"
extended-by: ""
tags: [identity, people, ingestion, provenance, ui]
---

# An inferred person link is unique-or-nothing, and it is marked where it renders

**Context.** Gemini is required to extract `entities.people` on every digest, and until
#177 the answer was discarded before the database. Persisting it makes the app assert
"this document is about this human" from a model-produced string — and a wrong link
does not degrade, it puts someone else's document on a named person's page. The
resolver (`resolvePersonCandidates`) already embodied the confidence ladder but
discarded which tier fired and whether it was ambiguous.

**Decision.** Three rules, one per layer:

1. **The tier is a value.** `resolvePersonMatch` returns `{ candidates, basis }`
   (`email` | `handle` | `name`); the legacy entry points are thin reads of it, so
   there is one matcher however the answer is consumed.
2. **The floor is the ownerBackfill rule, verbatim**: `ContextMention.personId` is
   written only when the winning tier holds exactly ONE candidate. Ambiguity and
   unknowns persist as `rawName` with a null link — visible, queryable, and
   re-resolvable by `db:backfill:context-mentions` when the directory later gains the
   person. Every mention write path (ingest, refresh, backfill) goes through
   `deriveMentions`, which is the floor's single spelling.
3. **Inferred identity is the one machine-derived value that IS marked** (design.md
   §8): a dotted underline at rest in the cell's own ink, rendered only by
   `PersonCell`'s `mention` prop, hover naming the tier. Certain (FK/session) names
   stay bare — marking both tiers would make the mark meaningless.

**Alternatives rejected.**
- *First-candidate-wins for mentions* (what `resolvePerson` rightly does for live
  forms) — a form has a human looking at it; a mention write has nobody, and the
  wrong guess is permanent and personal.
- *A confidence number instead of a tier* — the model's `Classification.confidence`
  precedent shows a float gets computed, branched on once, and discarded; the tier is
  the fact the UI can explain in words.
- *A glyph mark (✦ or new)* — §8's ✦ means "a model wrote these words", which this is
  not, and the untracked-mention ADR already found per-mention glyphs carpet a page.
- *Marking nothing* (today's §8 reading: derived values carry no mark) — an inferred
  anchor being wrong misfiles a document; an inferred identity being wrong makes a
  false claim about a named human, read by that human.

**Consequences.** Mentions track the LATEST digest (a real re-distillation rewrites
them wholesale, like `ingestedText`); a keyless deployment writes no mentions and no
`mentionsExtractedAt` marker, keeping its rows honestly eligible for the backfill.
What this gives up: recall — same-name collisions and out-of-directory people stay
unlinked until a human or the directory resolves them.

**Receipts.** #177; bead `autoknow-dh7`; `tests/mentionDerivation.test.ts`,
`tests/contextMentions.test.ts`; live validation 2026-08-14 (demo DB, real Gemini:
33 mentions, 28 linked, both Jonas Webers held at the floor).
