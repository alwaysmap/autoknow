---
status: accepted
date: 2026-07-28
supersedes: ""
superseded-by: ""
extends: "findings-get-a-third-home-priced-by-retrieval"
extended-by: ""
tags: [docs, knowledge, agents]
---

# Records are reviewed from the directory; there is no index table

**Context.** `docs/knowledge/README.md` carried a 40-row index and
`docs/adr/README.md` a 36-row one, both hand-maintained. Each row was a third copy
of facts the note already held: the link text duplicated `title:`, the trigger
column paraphrased `applies_to` + `symptoms`. Nothing compared them —
`knowledgeNotes.test.ts` only checked that every note was linked exactly once with
no dead links — so they could drift silently, and did: retitling a note during
PR #232 required hand-syncing its row, and nothing would have failed if that had
been missed. The rows were also prose, so they could not be parsed, diffed or
enforced, unlike the YAML they restated.

**Decision.** No index table in either directory. The filesystem listing is the
index: it is generated, cannot drift, and the slug states the claim. Reviewing
both directories is a STEP in any feature, change or debugging session, and that
procedure lives in AGENTS.md — it is how agents work, not what the directories
are. Retrieval is: read the slugs, open the few that bear on the work, confirm
against `applies_to`; when stuck, match `symptoms:` by grep; run a broad sweep in
a subagent so forty notes never enter the main context to yield two.

**Alternatives rejected.**

* *Generate the table from front matter.* Removes the drift but keeps an artifact
  that has to be built, committed and checked, to restate what `ls` and the YAML
  already say.
* *Assert row text equals `title:` in the tests.* Enforces agreement between two
  copies rather than removing the second copy.
* *Keep hand-maintaining it.* The only option with no argument for it once the
  drift was demonstrated.

**Consequences.** Slug quality becomes load-bearing: a note that cannot be triaged
from its filename is now unfindable, so the `compound` skill spends its "finish the
loop" step on the slug instead of on an index row. A few existing slugs are opaque
(`a-literal-ink-over-a-literal-ground-measures-fine.md`) and want rewriting. The
"note missing from the index" failure mode disappears entirely, along with the test
that checked for it. Citation-resolution, filename shape, front-matter and the
length cap are unchanged and still enforced.

**Receipts.** PR #232 (the retitle that exposed the drift), bead `autoknow-yz9`,
`tests/knowledgeNotes.test.ts`, `tests/adrNaming.test.ts`.
