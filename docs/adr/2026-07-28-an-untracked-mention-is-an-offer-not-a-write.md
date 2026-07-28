---
status: accepted
date: 2026-07-28
supersedes: ""
superseded-by: ""
extends: "resolution-searches-every-address-and-takes-no-date"
extended-by: ""
tags: [identity, people, ingestion, prose, ui]
---

# An untracked mention is an OFFER, and how untracked humans enter the system

**Context.** A person named in an ingested document or a handwritten note who has no
`Person` row is invisible to the whole app — not linkable, assignable, countable or
attributable — and the only remedy was to leave the page, go to `/people`, and retype
what you were just reading. #126 asked for an inline affordance. The reason it waited for
the end of #127 is that the obvious implementation manufactures duplicate humans: an
untracked-*looking* `alice.waters@bosch.com` may be a *tracked* person whose address has
since changed, and one click forks her — every `personId` FK stranded on the original,
her history split, both rows then competing in `resolvePerson`. That is `copyPerson`'s
damage (#124 Class 3) with a friendly button, at ingestion scale.

**Decision.** Four rules, and the last two are the ones that generalise beyond this
feature.

1. **Detection is addresses and `@handles` only.** No bare-name matching. This domain is
   full of capitalised multi-word nouns — *Ford Explorer*, *Digital Key*, *Rich Media*,
   *Launch Readiness* — that a capitalised-bigram matcher cannot tell from *Dieter
   Meyer*, and an affordance people learn to ignore is worse than none.
2. **Detection resolves against every address a person has EVER held**, not the current
   one. This is only possible because #127 E8 made the address a property of an
   employment period; `untrackedContext` builds its tracked set from `addressesOnFile`,
   the same composer the feed's actor aliases use, so the two cannot disagree about who
   a 2023 address names.
3. **The offer is an OFFER.** Nothing is created without a human click, and the dialog
   states every prefill rather than presenting a guess as a fact: the address verbatim,
   the company inferred from the domain by an *exact* fold or not at all, and the start
   date from the MENTION's own date — a person first seen in a 2023 document becomes a
   2023 fact, not a "joined today" lie. We are scanning third-party text and offering to
   persist PII from it, so a crafted document must not be able to talk the app into
   writing a `Person` on its own.
4. **"Not a person" is a table, not a column.** A dismissal records a decision about an
   address that belongs to *no row we hold* — inventing a `Person` to carry "this is not
   a person" would be precisely the duplicate-human write rule 2 exists to prevent.

**Alternatives rejected.**

- *Match bare names too.* Rule 1's nouns are indistinguishable from people without a
  model, and a wrong offer costs more than a missed one — the asymmetry the whole feature
  is built around.
- *Auto-create on ingestion.* The fastest way to a directory full of distribution lists,
  and unrecoverable at ingestion volume.
- *Check only current addresses.* Ships the fork. This is the dependency that held #126
  behind #124 Phase 3 rather than a preference about ordering.
- *An icon beside each mention.* design.md §8c keeps icons scarce; at ingestion volume a
  per-mention glyph carpets the page.
- *Suppress dismissals per surface.* A distribution list recurs everywhere, so a
  per-surface silence is a decision the reader has to keep re-making.

**Consequences.** The detector is pure and client-safe (`lib/untrackedPeople`), so it
unit-tests without a database and the renderer shares its `Segment` type with `linkify`;
the database half is a separate module for exactly that reason. It reaches five prose
surfaces through ONE change, as a rehype plugin inside the shared `Markdown` component —
a pass over the markdown *source* would corrupt `[Dieter](mailto:…)` by splitting the
address inside the link syntax, whereas by plugin time the tree is HTML and a text node
is the unit the detector splits. A surface opts in by supplying the context; omitting it
leaves the pipeline untouched, so nobody gets the affordance by accident or loses their
prose by forgetting it.

What this does NOT do: it does not detect people named in prose without an address, and
it does not dismiss per-person — a dismissal is about the ADDRESS. Both are honest gaps
rather than deferred work.

**A UI note worth keeping.** The mention itself is the control. An adjacent button
revealed on hover cannot work in running prose: `visibility: hidden` keeps its box, so a
button-width gap sits mid-sentence at rest, and `display: none` reflows the paragraph
under the reader's cursor. Neither is visible in the DOM — both were found in a
screenshot (AGENTS lesson 18).

**Receipts.** #126; bead `autoknow-f0t`; `tests/untrackedPeople.test.ts` (22 cases,
including the domain-noun fixture asserting zero annotations and the former-address
safety case). Verified live on a seeded note naming two unknown people and one tracked
person: exactly two mentions claimed, the tracked address untouched, company prefilled
from the domain, date from the mention.
