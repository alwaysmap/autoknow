---
status: accepted
date: 2026-07-23
supersedes: ""
superseded-by: ""
extended-by: "a-phase-is-read-on-its-card-the-only-overlay-is-the-write"
tags: [ui, charts, hill, components, urls]
---

# Converge the hill charts on one drawing, two roles, and the Basecamp snapshot card

**Context.** The hill chart — a phase's progress on the bell curve (`HILL_PATH` in
`src/lib/geometry.ts`) — exists today as three unrelated drawings with three
unrelated APIs, plus two more hand-inlined copies:

- `PhaseHillChart` (`{ phases, wide }`) draws the AGGREGATE: every phase as a dot
  on one hill, read-only, used only by `PhaseTrack`'s summary band. It stretches x
  by `sx = 2.1` (an affine map on the bézier control points) into a `layoutHill`-
  derived viewBox (`0 <minY> 420 <h>`), and `width: 100%; height: auto`.
- `PhaseHillGauge` (10 props: `phaseId, projectId, progress, previousProgress,
  updatedAt, phaseName, editable, showStatus, color, strings`) draws a SINGLE
  phase, drag-to-update, used only by `PhaseGraph`. Its inner `PhaseHillSvg` uses
  `viewBox="0 0 200 104"`, `width: 100%; height: auto`.
- `HillHistoryList` (`{ changes, color, emptyLabel, locale, compact }`) is the log
  — a list of side-by-side cards (hill left, note right), reusing
  `NeedleHistoryList.module.css`.
- Two more hills are hand-inlined in `PhaseTrack`: `MiniHill` (`viewBox="0 0 200
  90"`, current + prior dot only) on each rail card, and the update/preview SVG
  (`viewBox="0 0 200 104"`) inside the phase-detail popover.

Two things are already right and must survive convergence. **The curve is one
bézier** — every drawing renders `HILL_PATH`, and the aggregate's `sx` stretch is
an affine map, so design.md §8c's "the wide summary hill and the small per-phase
gauges stay the same drawing" holds. **The author is already captured** — every
`PhaseState` stamps `source = getCurrentUser().handle` (`updatePhaseHill`,
`app/actions/hill.ts`) and `getPhaseLog` returns it as `by`, so "who made the
update" needs no schema change.

Three gaps remain. (1) **The frames differ**, so hills are not the same size across
the app: `0 0 200 104` vs a computed `0 -1 420 106` vs `0 0 200 90`, each landing
at a different rendered size in each slot, and every one uses `height: auto`, which
design.md §9b / the box-model ADR made a defect (a chart owns its height in `rem`,
never `height: auto`). (2) **Per-phase history + update live only inside
`PhaseTrack`** — the `#phase-:id-detail` popover, its `getPhaseLog` fetch, and its
inline story — reachable by nothing else. (3) **Aggregate history does not exist**:
nothing shows "every update on every phase in this program."

This record decides the architecture; `docs/HILL_CHARTS_CONVERGENCE_PLAN.md` holds
the component API surface, the card layout, the audit, and the build sequence.

**Decision.**

1. **One drawing, one coordinate space, one owned height.** There is ONE chart
   component. It renders `HILL_PATH` in the **single base viewBox `0 0 200 104`** —
   the space `hillCoordinates` already maps into — for BOTH roles. It **fills its
   container's inline size** (`width: 100%`) and **owns its height in `rem`** (a
   small named set of heights, never `height: auto` and never `aspect-ratio`), per
   the box-model ADR. The aggregate's `sx = 2.1` stretch and the `layoutHill`-
   derived variable-width viewBox are **retired**: they existed only to fight
   `height: auto` making a wide hill a tall dome, which owning the height in `rem`
   eliminates. `layoutHill` keeps its y-shingling and may extend the viewBox
   *height* to clear a tall label stack, on the fixed 200-unit x-axis. "One size"
   means one shared height token; width follows the container by rule. Because dot
   radius, stroke widths, the Instrument groove/graticule, and the axis captions
   are now authored once in one space, they are byte-identical in every context —
   which is the literal meaning of "one drawing." A hill that fills a width wider
   than its natural aspect must keep its **markers circular and its strokes crisp**
   (the one hazard of filling width by non-uniform scale); the mechanism is the
   implementation PR's to choose, but the invariant is signed off from a
   **screenshot** in both themes and both styles (AGENTS lesson 18), never from a
   passing element count.

2. **Two roles, one component, and the wrong combination is unrepresentable.** The
   component takes EITHER a single `phase` OR a set of `phases`, never both, as a
   discriminated union — the same "declare the kind once, derive behaviour so a
   call site cannot express the wrong combination" rule design.md §6 applies to
   table columns. The AGGREGATE (`phases`) is **read-only**: many dots, each a
   deep-link to its phase row, no drag, no update path in its type. The SINGLE
   (`phase`) is read-only by default and **editable only when the caller passes an
   edit capability** — and only the single variant's type has that field.

3. **Updates happen on a single phase, never on the aggregate — a hard rule, not a
   default.** An aggregate hill has no unambiguous subject to update, so "update the
   aggregate" is not a thing a caller may express: the edit capability exists only
   on the `phase` variant (Decision 2), and a dev-time assertion + a unit test guard
   it so the rule needs no memory (AGENTS lesson 2). The drawing itself never owns
   the note/save flow — dragging emits a progress value; the CALLER owns the
   required note, the mutation, and the overlay (which keeps the drawing pure and
   testable, the way `OverlayDialog` owns dismissal but not content).

4. **One status update is a Basecamp snapshot card: a vertical stack, hill full
   width.** Header (who + when) on top, the hill at that moment in the middle, the
   note below — never today's side-by-side card, which crams the hill into a
   fixed-width left rail. Author identity is an avatar following the app rule
   (initials from `initialsOf`, `src/lib/people.ts`, as the resting state; the
   signed-in user's photo via `/api/me/avatar` as an enhancement that may fail —
   never a `googleusercontent` URL, per the image-proxy ADR). No schema change:
   `source` is the author (Context above).

5. **Two history views, one card, both are URLs.** Per-phase history (one phase over
   time) and aggregate history (every update on every phase, newest first, each card
   naming its phase) render the SAME snapshot card and differ only in what they are
   given. Per-phase history keeps its home — the phase-detail popover at
   `/programs/:id#phase-:phaseId-detail` (design.md §5) — and still carries the
   COMPLETE log, since a phase has no page of its own. Aggregate history is new and
   gets its own fragment on the program page. Both open through the shared
   `OverlayDialog` container (#34), and UPDATE reveals its form **in place** inside
   that overlay, never a second `<dialog>` (design.md §4b). This retires
   `PhaseTrack`'s hand-rolled `scrim`/`popover` — the last hill overlay still
   dodging #34.

6. **Every hill label keeps its halo.** All text routes through `ChartLabel`
   (`paintOrder="stroke"`, the one halo primitive, issue #23) — the converged
   component keeps what `PhaseHillChart` already does right and gives it to the
   contexts that hand-rolled a bare `<text>`.

**Alternatives rejected.**
- *Keep the `wide` boolean and the `sx = 2.1` stretch.* The stretch is a workaround
  for `height: auto`; once the height is owned in `rem` (Decision 1) it has no job,
  and a magic per-role constant is exactly the "different frames" the issue is
  closing. A single owned height is the same size by construction.
- *`preserveAspectRatio="xMidYMid meet"` (uniform, letterboxed) for both roles.* It
  keeps markers round for free, but a wide summary band would shrink to its natural
  aspect and float in a sea of side-margin, crushing 15 dots and their shingled
  labels into a narrow hill — the readability the aggregate width exists to buy.
  The aggregate must use the width; the cost is the round-marker care Decision 1
  names.
- *Two components sharing a `HillSvg` primitive (roughly today, minus the copies).*
  Leaves two APIs to keep in sync and two places for the update/read-only rule to
  drift; the discriminated union makes "read-only aggregate" and "editable single"
  one type whose illegal state does not typecheck.
- *An editable flag on a single component that takes `phases`.* Representable
  nonsense: `editable` + many dots. Decision 3's hard rule would then live in prose
  and a runtime check only, not the type.
- *A "full history →" link out of the per-phase popover.* There is nowhere to link
  to — `/history/phase/:id` was retired 2026-07-21 (design.md §5). The popover IS
  the record; it loads the complete log (`getPhaseLog`) on open.

**Consequences.** `PhaseHillChart`, `PhaseHillGauge`/`PhaseHillSvg`,
`HillHistoryList`, `PhaseTrack.MiniHill`, and `PhaseTrack`'s inline popover SVG all
collapse onto three components — `HillChart`, `HillSnapshotCard`, `HillHistory` —
specified in the plan doc. The aggregate-history view needs a new server reader
(every phase's `PhaseState` for a program, newest first, each row carrying its
phase's id/name/colour); nothing else needs new data. `HillHistoryList` shares
`NeedleHistoryList.module.css` today, so the card relayout is scoped to the hill
history and leaves the needle history untouched (a later, separate call may adopt
the vertical stack for needles too). The phase-detail popover moving onto
`OverlayDialog` deletes a hand-rolled scrim, its manual Escape handler, and its
manual `body.style.overflow` lock. This is a spec: no behaviour ships in the PR that
records it. Acceptance is screenshot-verified at 360/768/1024/1440 in both themes
and both styles — a long phase name and a program with enough phases to force label
shingling included (design.md §9, AGENTS lesson 18).

**Receipts.** Issue #37 (tracking issue + spec). Curve + coordinate space:
`src/lib/geometry.ts` (`HILL_PATH`, `hillCoordinates`), `src/lib/hillLayout.ts`
(`layoutHill`, the derived viewBox). Current drawings: `src/components/PhaseHillChart.tsx`,
`src/components/PhaseHillGauge.tsx` (`PhaseHillSvg`), `src/components/HillHistoryList.tsx`,
`src/components/PhaseTrack.tsx` (`MiniHill`, the `detailsOverlay` scrim/popover,
`getPhaseLog`), `src/components/PhaseGraph.tsx`, `src/components/FeedList.tsx`.
Author capture: `updatePhaseHill`/`getPhaseLog` in `src/app/actions/hill.ts`,
stamping `getCurrentUser().handle`. Depends on and applies:
[box-model ADR](2026-07-22-containers-own-spacing-charts-own-height.md) (#36),
[the #34 overlay container](../../src/components/OverlayDialog.tsx),
[image-proxy ADR](2026-07-21-proxy-third-party-images-keep-csp-self.md) (avatars),
issue #23 (`ChartLabel` halos). Follow-on PRs enumerated in
`docs/HILL_CHARTS_CONVERGENCE_PLAN.md` §7.
