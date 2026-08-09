---
status: accepted
date: 2026-08-09
supersedes: ""
superseded-by: ""
extends: "an-initiative-template-edit-propagates-by-provenance"
extended-by: ""
tags: [initiatives, schema, programs]
---

# An initiative links devices from the membership to real programs

**Context.** An initiative commonly lands on one or more of each member OEM's
head units, and a head unit already has a canonical row: the partner's REAL
device Program. The snapshot/copy ADR this chain starts from split `Project`
rows into real programs (`initiativeId: null`) and per-partner workflow copies;
"which devices" is a fact about the pair (initiative, partner), and the only
question was where the join hangs and who enforces what it may reference
(bead autoknow-hcz.14).

**Decision.** `InitiativeDevice` joins the MEMBERSHIP to the program — own id,
`initiativePartnerId` + `projectId` FKs, `@@unique` on the pair,
`@@index([projectId])`, the `PhasePartner` house style. The referenced Project
must be REAL (`initiativeId: null`) and belong to the SAME partner as the
membership; both rules are enforced in `linkDevice`
(`src/app/actions/initiatives.ts`) at the mutation boundary — schema owns
shape, resolver owns resolution (AGENTS lesson 3) — and the picker offers only
those canonical rows. Linking an already-linked program is a no-op, the same
retry-safe stance as `addMembers`; unlink names the link row's own id.

**Alternatives rejected.** Hanging the join on the copy: a removal cancels the
copy and a re-add instantiates a fresh one, so device links would die with
every membership cycle while the fact they record — which head units this
initiative lands on for this partner — outlives it on the join row. Restating
`(initiativeId, partnerId)` as columns on the link: duplicates the membership's
unique key and lets the two drift. DB-level enforcement of the two reference
rules: "real program" is a cross-table predicate no FK or Prisma-expressible
constraint states, and same-partner via a composite FK would denormalize
`partnerId` onto the link for half the rule — the boundary guard covers both
and matches every precedent this feature already set.

**Consequences.** Device links survive remove/re-add cycles with the membership
row, deliberately. Deleting a partner's program is RESTRICTed while a link
exists — unlink is part of retiring a device. Any future surface asking "which
initiatives land on this device" reads `@@index([projectId])` from the program
side.

**Receipts.** Bead autoknow-hcz.14 (owner: "we'll do this by linking to a
Program"); migration `initiative_devices`; `tests/initiativeDeviceActions.test.ts`
(copy rejected, other partner's program rejected, re-link no-op, unlink keeps
the program).
