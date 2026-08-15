---
title: An unstated Prisma onDelete is RESTRICT on a required FK and SET NULL on an optional one, so the same missing-children bug crashes in one child and silently orphans another
status: current
updated: 2026-08-15
applies_to:
  - prisma/schema.prisma
  - any `prisma.<model>.delete` / `deleteMany` on a row other models point at
  - reviewing a delete path for what it forgets to clean up
symptoms:
  - a delete works in tests and throws P2003 "Foreign key constraint violated" on real data
  - a row survives a delete having quietly lost one of its attributions, and nothing logged it
  - a delete writes a state no mutation could — a row failing an invariant the zod boundary enforces
verified_by: 'tests/deleteFeedItem.test.ts; tests/partnerDeleteBlockers.test.ts "refuses when an escalation is about this partner and NOTHING else"; tests/deleteProjectEscalations.test.ts; autoknow-805; autoknow-40f'
---

# An unstated Prisma `onDelete` is RESTRICT on a required FK and SET NULL on an optional one

**The lesson.** When a delete path forgets a child table, what happens next is decided by
one thing nobody wrote down: whether the child's FK column is `Int` or `Int?`. Prisma
supplies the referential action when the relation omits it, and the two defaults are
opposites — `Restrict` for required, `SetNull` for optional. So the identical omission is
a loud 500 in one child and an invisible corruption in another, and finding the first
tells you nothing about the second. When you fix a P2003, enumerate *every* model pointing
at the row; the children that did NOT crash are the ones worth checking.

**Why it bites.** The crash trains you to think the database is guarding you. It guards
only the required relations. `ContextUrl`'s three children each behave differently under a
bare `contextUrl.delete`: `ContextRevision` (`Int`, RESTRICT by default) throws P2003;
`ContextMention` (`onDelete: Cascade`, declared) cleans up; `Escalation.contextUrlId`
(`Int?`, SET NULL by default) strips the citation and says nothing. The silent one is the
dangerous one. The same default let `deletePartner` null `Escalation.partnerId`, landing a
partner-ONLY escalation on `partnerId=null, projectId=null` — which `src/lib/schemas.ts`'s
`ABOUT_SOMETHING` refinement rejects on every create and update. The FK bypassed the
mutation boundary, so the delete wrote a state no user action could reach
(`autoknow-40f`, fixed).

**The right answer differs per delete.** Program and partner deletes could orphan an
escalation identically, and were fixed differently because the two MEAN different things:
a partner delete is REFUSED while things point at it (so a partner-only escalation became
a third blocker), a program delete removes the program's world (so one goes with it).

**What to do.** Before changing or reviewing a delete, read the parent's back-relations out
of the schema rather than grepping the delete path:

```bash
grep -n 'model <Parent> {' -A40 prisma/schema.prisma   # the back-relation list IS the checklist
grep -n '<parent>Id' prisma/schema.prisma              # then read each child's optionality
```

Then handle every child explicitly in one `$transaction` — including the SET NULL ones,
which is where the decision lives. `deletePartner`'s `phase.updateMany({ leadPartnerId:
null })` is the convention written out: the FK would have done it anyway, and the line
exists so the choice is on the page. A declared cascade is the other honest answer. What
is never an answer is leaning on a default nobody read.

**How we found out.** `deleteFeedItem`'s `ctx-` branch was a one-line
`prisma.contextUrl.delete`, so the delete button on an ingested context card 500'd 100% of
the time while the childless rows it was presumably tried against worked (`autoknow-805`).
Both sibling call sites already had the revision cleanup: the schema, not the codebase,
was what nobody had re-read. `Escalation` is the half the crash hid.
