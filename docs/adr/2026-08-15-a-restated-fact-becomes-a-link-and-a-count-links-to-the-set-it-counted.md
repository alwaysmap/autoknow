---
status: accepted
date: 2026-08-15
supersedes: ""
superseded-by: ""
extends: a-summary-count-uses-the-threshold-of-the-detail-it-summarizes
extended-by: ""
tags: [ui, critical-chain, copy, information-density, people]
---

# A restated fact becomes a link, and a count links to the set it counted

**Context.** `/programs/:id` stated one constraint up to five times. Two of those were
literally the same computation rendered twice: the header's "Immediate focus" banner and
the first Next-steps bullet were both built from `situations.filter(s => s.type ===
'forecastOverrun')`, both ended with the words "Exploit the constraint", and the bullet
was a strict superset — it added the planned days and the re-estimate branch. This repo
had already deleted this exact shape twice and recorded why both times (`ChainLedger.tsx`
retiring the terse Resource Constraints summary; `CRITICAL_CHAIN_VIEW_PLAN.md` §"It
reached screen twice under two different labels"). Meanwhile the one list that is
supposed to say what to DO printed its evidence inline with no cap: the owner-load bullet
rendered every other program the owner is on, each followed by every phase name inside it
as **plain text**, so an owner running thirteen phases elsewhere produced thirteen
unclickable phase names in one sentence.

**Decision.** Two rules, and — as with the ADR this extends — they are one rule seen from
either end.

1. **A fact is stated once, where it is actionable; a surface that must point at it
   LINKS rather than restates.** The banner keeps the part scrolling actually costs you
   — WHICH phase — and hands off with `What to do about it →` to `#critical-chain`. The
   percentage, the days remaining, the count of other overruns and the reaction all live
   in the bullet, which said them more fully anyway. The 2026-07-24 user call that
   created the banner is NOT reversed: its goal was "read this before the needle, the
   briefing and every chart", and that survives — what changed is the mechanism, from a
   second copy of the sentence to a pointer at the first.

2. **A count in prose links to the pre-filtered list it counted, and the two derive from
   ONE definition.** With two or more other programs, the enumeration collapses to a
   single link — `/people/:id?filter=active#programs` (`personActiveWorkHref`). One
   program stays inline, because a single program name is cheaper to read than a click.
   The link only means anything if it lands on what was counted, so "active work" is now
   defined once, in `lib/activeWork.personActivePhases`, and both surfaces call it.

The definition itself draws its two arms at different distances, deliberately: a person
who **leads** a program is on the hook for every active phase in it, while a person
**named on** one phase owns that phase and nothing else. The predicate under both is
`isPhaseActive` (lib/phase) — the same one the rail and the hill chart read.

**Alternatives rejected.**

- **Delete the banner outright.** Cheapest, and it silently drops a decision made
  deliberately three weeks earlier. The issue asked for the goal to be preserved
  explicitly, and a link preserves it.
- **Move the Critical Chain section above the hill chart instead.** The issue's other
  sanctioned option. It relitigates #154's ordering ("the hill reads straight after the
  needle and the briefing and BEFORE the chain") to buy what one anchor buys.
- **Cap or truncate the phase enumeration ("… and 9 more").** The defect is not that the
  list is long; it is that a sentence is carrying a dataset, in plain text, with no route
  to any of it. A cap makes the sentence shorter and the evidence no more reachable.
- **Point the link at the existing `?status=live` filter.** Live means "not every route
  behind this row has finished" — a phase nobody has ever updated is live. That is a much
  larger set than the phases the sentence counted, so the link would have landed on rows
  the number did not include.
- **Give the person page a second column for active work.** A seventh column on a table
  that already scrolls at 360px, to express something the Status column was already
  nearly saying. Splitting `live` into `active` / `live` instead is one column, and it
  fixes a real conflation: a program someone is running a phase in this week used to
  render identically to one they are merely named on.

**Consequences.** The Programs table's Status class is three-valued (`active` / `live` /
`ended`), so `?status=` and the funnel now offer three options where they offered two;
`connectionActive` is a new key in four locales and `personProgramsIntro` had to grow the
sentence that discloses the split. `clFocusPhase`, `clFocusAlso`, `clFocusAlsoOne` and
`clFocusExploit` are retired. The program page's contention counts widen slightly and
correctly: they spelled "active" inline as `p > 0 && p < 100` and so dropped a phase
somebody had marked Active before its hill moved — the rail called that phase In Progress
and the count did not. `immediateFocus` and the `act` register are untouched; the banner's
data still drives the "Time to act" heading whether or not the banner renders it.

This commits us to one more thing: `?filter=active` is now an address that the Critical
Chain's prose depends on, so it is DATA, not just code (AGENTS lesson 15). Retiring it
means migrating what cites it, which is why it is built by `personActiveWorkHref` in
`lib/entityHref` rather than at the call site.

**Receipts.** Issue #167. Guards shipped alongside: `tests/activeWork.test.ts` (the two
arms of the definition, the exclusions, and that the table's ACTIVE status is that same
answer rather than a second one), `tests/person_active_work.spec.ts` (a fixture where the
owner is active in three other programs — the sentence's count, the single link, the
ABSENCE of any other program's phase names, and the rows behind the link being exactly
what was counted), and `tests/program_focus.spec.ts`, rewritten rather than deleted: it
still pins the "read it before scrolling" property, now via the link's target and the
absence of the restated numbers. Signed off from screenshots in both themes at 1440px,
and at 360/768 for the header line, on the demo seed — where the owner-load bullet reads
"Dylan owns this program and is also on 13 active phases across **6 other programs**",
which is the sentence that used to print thirteen phase names.
