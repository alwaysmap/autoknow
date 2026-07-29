---
status: accepted
date: 2026-07-29
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [dates, storage, ui]
---

# Instants are stored in UTC and localized only at the point of display

**Context.** Every timestamp in this app is a Postgres `TIMESTAMP(3)` written by Prisma
from a JS `Date`, which is UTC-backed — so storage was already UTC by accident of the
stack rather than by a rule anyone had stated. The absence of the rule cost a real bug
the day it was written down: `isOverdue` compared a target date against `now` using
`new Date('2026-07-29')`, which the ECMAScript spec parses as **UTC midnight**, while
`new Date('2026-07-29T00:00:00')` is **local** midnight. West of Greenwich the two differ
by a day, so an escalation read as overdue a day early. The test caught it only because
it asserted the boundary from both sides.

**Decision.** **Store instants in UTC; convert to the reader's local zone only when
rendering.** Concretely:

* Every stored moment is UTC. Nothing writes a wall-clock string, a zone name, or an
  offset alongside it. `DateTime` columns and `new Date()` already satisfy this — the
  rule makes it deliberate rather than incidental.
* Comparisons, ordering, windowing and freshness arithmetic are done **on instants**,
  never on formatted strings.
* Localization happens at the LAST step, in the component that renders — `DateCell`
  (ISO in `dateTime`, locale-short visible) and `RelativeTime` (a duration against now).
  Those two are the boundary; a page that formats its own date has moved the boundary and
  `tests/dataTableConvention.test.ts` fails it.
* **The exception, and it is the one that bites: a DATE-ONLY field is a calendar day, not
  an instant.** `Escalation.targetDate` and `Project.sopDate` are what a human typed into
  a date picker. "Is it past?" is a question about *their* calendar, so a bare
  `YYYY-MM-DD` must be rebuilt as a LOCAL day (`new Date(y, m-1, d)`) rather than handed
  to `new Date(string)`, which would read it as UTC. `localDay` in `src/lib/escalation.ts`
  is the reference implementation; day-granular predicates elsewhere follow
  [the as-of note](2026-07-27-an-address-is-unique-at-an-instant-not-forever.md)'s
  precedent of moving the boundary into the parameter.

**Alternatives rejected.**

* *Store a zone or offset per row.* Only earns its keep when the ORIGINATING zone is
  itself data — a meeting's local start time, say. Nothing here is: every timestamp
  records when something happened to the system, and the reader's zone is the only one
  that matters at display.
* *Store local time and convert on read.* Ambiguous twice a year across a DST boundary,
  and it makes ordering depend on where the writer was sitting.
* *Format on the server.* Kills the machine-readable half `DateCell` exists to preserve
  (ISO in `dateTime` for assistive tech, copy-paste and anything parsing the DOM), and
  bakes the server's zone into an artefact the client caches.

**Consequences.**

* Ordering and comparison are correct without anyone thinking about zones — the property
  that makes UTC storage worth the rule.
* A wrong-day bug becomes a DISPLAY defect, always local to one component, never a
  corrupted row.
* The date-only exception must be applied consciously: a `YYYY-MM-DD` column handed to
  `new Date()` in a comparison is now a reviewable mistake with a name.
* Deliberately given up: representing "9am in the partner's timezone" as a stored fact.
  If a future feature needs that — a scheduled Chat post, an SLA measured in the
  partner's working day — it needs its own zone column and its own ADR, and this record
  is not an argument against it.

**Receipts.** `isOverdue`/`localDay` in `src/lib/escalation.ts` and the boundary
assertions in `tests/escalation.test.ts` ("is not overdue before, or ON, its target day"),
which failed against the UTC parse before `localDay` existed — #245's target-date change.
