---
title: A Prisma back-relation has its own name, so grepping the forward field misses every reader on the other side
status: current
updated: 2026-07-26
applies_to:
  - prisma/schema.prisma
  - sweeping every reader of a field before changing or deprecating it
symptoms:
  - a grep-driven sweep looked complete and a surface with the same bug survived it
  - a field you thought you had removed everywhere still reaches the UI
  - a reviewer asks "what about X?" and X never appeared in your reference count
verified_by: 'docs/adr/2026-07-26-currentpartnerid-is-a-cache-affiliations-are-the-truth.md; tests/partnerQueries.test.ts "lists only who is at the partner TODAY"; PR converting #127 E5'
---

# A Prisma back-relation has its own name, so grepping the forward field misses every reader on the other side

**The lesson.** `grep -r currentPartner src/` is not the set of readers of
`Person.currentPartnerId`. A Prisma `@relation` names each direction independently, so
the reverse side is a different identifier with no textual link to the forward one — here
`Partner.currentEmployees @relation("CurrentPartner")`. Every query that walks the
relation backwards reads the same column under a name your sweep never searched for.
Before declaring a field-level sweep complete, open `prisma/schema.prisma`, find the
relation, and add BOTH names — and the relation's `@relation("Name")` label — to the grep.

**Why it bites.** The forward field is the one you think in, because it is the one that
appears in the model you are changing. The back-relation is declared on the *other* model,
often dozens of lines away, and it is the natural way to write a list query — "all the
people at this partner" is `partner.currentEmployees`, not a `Person` query filtered by
`currentPartnerId`. So the readers most likely to be user-facing lists are exactly the
ones spelled the way you did not search. The count you report is confidently wrong, and
nothing fails: the surviving call sites compile, typecheck and pass their tests, because
the field genuinely still exists.

**What to do.** Two greps and one read:

```bash
grep -n 'model <Model>' -A40 prisma/schema.prisma      # find the relation + its label
grep -rn '<forwardField>\|<backRelationField>\|@relation("<Label>")' src prisma tests
```

Then prefer a mechanical guard over a careful sweep: a `no-restricted-syntax` rule listing
*all* the names is what makes the next person's sweep complete without their having to
know this. Note that the guard has the same blind spot in reverse — a relation name inside
`Prisma.sql` is just text, invisible to any AST selector — so a hand-written query needs a
`TemplateElement` selector or a test that pins its behaviour.

**How we found out.** #127 E5 was scoped from a reference count of 46 across 12 files, all
found by grepping `currentPartner`. The recount at implementation time found 51, and the
sweep then turned up `getAllPartners` reading `currentEmployees` — which had never
appeared in either number. It was worse than the sites that did: it UNIONED the stale
cache with *every affiliation the partner had ever had*, so the /partners team cell listed
leavers permanently and the "My partners" toggle matched companies you left years ago.
Both wrong sets, added together, in the one file the sweep could not see.
