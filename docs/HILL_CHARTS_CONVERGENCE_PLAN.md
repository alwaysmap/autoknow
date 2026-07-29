# Hill Charts Convergence — Design & Build Plan

Status: **Specified, not built — and one of its premises has since moved.** This is
the buildable spec for issue #37. Written against the per-phase DETAILS popover as a
phase's home; that popover RETIRED with autoknow-crw.4, so the reference assembly in
§4 is now the card's **update & history** view at `#phase-:phaseId-progress`, and the
phase itself is its card at `#phase-:phaseId` (design.md §5). The convergence this doc
specifies is unaffected in substance — the drawing, the snapshot card and the
affordance taxonomy all still apply — but every `-detail` fragment below reads as
`-progress`, and "the popover" reads as "the progress view". The
architectural decisions and hard rules are the immutable record in
[ADR: Converge the hill charts on one drawing](adr/2026-07-23-converge-the-hill-charts-on-one-drawing.md);
this doc carries the component API surface, the card layout, the usage audit, and
the follow-on PR sequence. Section numbers are stable — code comments and the
tracking issue cite them (`hill plan §7.2`).

The convergence rests on three settled decisions it does not relitigate: the
box-model rule ([#36](adr/2026-07-22-containers-own-spacing-charts-own-height.md) —
a chart fills width and owns its height in `rem`), the one overlay container
([#34](../src/components/OverlayDialog.tsx)), and the halo primitive (`ChartLabel`,
#23). Read design.md §3 (no percentages, drag-only), §4b (the popup holds the
record; update in place), §5 (a phase has no page; the popover is its home and
carries the complete log), §8c (one drawing across sizes), and §9b before building.

## 1. Goal & non-goals

**Goal.** One hill drawing at one owned size, used everywhere; one component that
serves the read-only aggregate and the editable single phase without letting a
caller ask for the illegal combination; the Basecamp point-in-time snapshot card;
and two history views — per-phase (exists, buried) and aggregate (new) — built from
that one card.

**Non-goals.** No change to how progress is stored or to the append-only
`PhaseState` model; no schema change (author is already `source`, §5.3). No new
health/percentage surfaces (design.md §3 stands). The program **needle** and its
`NeedleHistoryList` are a different graphic and out of scope — the vertical-stack
card *may* later suit them, but this plan does not touch them. Poppable/`/embed`
forms of these charts are a separate decision already recorded
([#43](adr/2026-07-22-poppable-charts-a-parameter-a-shared-assembly-and-a-token.md),
which scopes `PhaseHillChart`/`PhaseHillGauge` popping to "later") and are not
pulled forward here.

## 2. The one drawing — `HillChart`

Replaces `PhaseHillChart`, `PhaseHillGauge`/`PhaseHillSvg`, `PhaseTrack.MiniHill`,
and the inline popover SVG. Pure and read-mostly: it draws, and it emits a progress
value while dragging. It never owns a dialog, a note, or a mutation.

### 2.1 Size contract (ADR Decision 1)

- **viewBox `0 0 200 104`** — the base `HILL_PATH` space, both roles. No `sx`
  stretch. `layoutHill` may extend the viewBox *height* to clear a tall stack, on
  the fixed 200-unit x-axis.
- **`width: 100%`**; **height author-set in `rem`** via a `size` token (§2.2). Never
  `height: auto`, never `aspect-ratio` (#36).
- Dot radius, stroke widths, the Instrument groove + baseline graticule, and axis
  captions are authored once in this space, so they are identical everywhere.
- Filling a width wider than the drawing's natural aspect must keep **markers
  circular and strokes crisp**. Implementation chooses the mechanism (a non-scaling
  marker overlay, `vector-effect="non-scaling-stroke"`, etc.); the invariant is
  verified from a **screenshot** in both themes and styles, not a passing count
  (AGENTS lesson 18).

### 2.2 API

A discriminated union — a call site passes `phase` XOR `phases`, and only `phase`
can be edited (ADR Decisions 2–3). Illegal states do not typecheck.

```ts
type HillSize = 'gauge' | 'band';
// 'gauge' — the compact height for a sidebar/feed/history-card single hill.
// 'band'  — a taller height, opt-in, so the aggregate has room for shingled labels.

interface HillDot {
  id: number;
  name: string;
  progress: number;            // 0..100; status inferred (lib/phase.hillStatus)
  color: string;               // phaseColor(id)
  previousProgress?: number | null; // ghost marker; single-phase only in practice
}

type HillChartProps =
  | {                                   // AGGREGATE — read-only, many dots
      phases: HillDot[];
      size?: HillSize;                  // default 'band'
      axisLabels?: { left: string; right: string } | null;
      onActivate?: (phaseId: number) => void; // dot → deep-link (JUMP_PHASE_EVENT)
      // NOTE: no `edit` field exists on this arm — updating the aggregate is
      // unrepresentable (ADR Decision 3).
    }
  | {                                   // SINGLE — read-only unless `edit` is given
      phase: HillDot;
      size?: HillSize;                  // default 'gauge'
      axisLabels?: { left: string; right: string } | null;
      edit?: {                          // present ONLY where the caller permits drag
        value: number;                  // controlled progress (0..100)
        onChange: (progress: number) => void; // fires on drag / range input
        trail?: HillDot['progress'][];  // recent prior positions (ghost trail, capped)
      };
    };
```

Notes that carry design rules:

- **Aggregate dots are deep-links, not controls.** Each dot keeps its `role="link"`,
  focus stop, tooltip (`name — status`), oversized invisible hit area, and the
  y-shingling from `layoutHill`. The aggregate SVG stays `role="group"` (focusable
  children); a single read-only hill stays `role="img"` (today's split in
  `PhaseHillChart` vs `PhaseHillSvg` — keep it).
- **`edit` is a capability, not a boolean.** Its presence turns the single dot
  draggable (pointer-capture per design.md §3) and mounts the off-screen `range`
  input (`left: -624.9375rem`) so e2e stays drivable. Its *absence* is a plain
  read-only hill. There is no `editable={false}` state to reason about.
- **No numbers, ever** (design.md §3): status is a colour + inferred word outside
  the drawing, never a `%` inside it.
- The old `PhaseHillGauge` responsibilities that were NOT drawing — the status row
  (`status · date · Update`), the `OverlayDialog`, the note field, the
  `updatePhaseHill` call — move OUT to the caller (§4). `HillChart` shrinks from 10
  props to the union above.

## 3. The snapshot card — `HillSnapshotCard` (ADR Decision 4)

One status update, as the Basecamp vertical stack. Replaces the side-by-side card in
`HillHistoryList` (a relayout of `NeedleHistoryList.module.css`'s `.card`, not a
rebuild).

```
┌─────────────────────────────────────┐
│ ◯  Dana Lee · Jun 06, 3:58 PM        │  header: avatar + author + timestamp
├─────────────────────────────────────┤
│            ╭───╮                     │  the hill AT THAT MOMENT, full card width,
│      ─────╯     ╰─────               │  dot at this update's progress + ghost of prior
├─────────────────────────────────────┤
│  The text of the update, as markdown.│  note BELOW, comfortable prose width
└─────────────────────────────────────┘
```

```ts
interface HillSnapshotCardProps {
  progress: number;
  previousProgress: number | null;   // ghost marker
  note: string | null;               // markdown; empty renders the "no note" line
  at: string;                        // ISO timestamp
  author: string | null;             // the stored `source` handle
  color: string;                     // phaseColor(phaseId)
  phaseName?: string;                // shown ONLY in aggregate history (§5.2)
  locale: Locale;
}
```

- **The hill inside the card is `HillChart` single-phase, read-only** (no `edit`),
  at `size='gauge'`, full card width — so it is legible, not the cramped
  fixed-width left rail of today's card.
- **Header order: avatar, author, then timestamp** — the eye picks up who while
  scanning (matches `NeedleHistoryList`'s author-before-date choice). Timestamp is
  prose-style (`localDate`, "Jun 06"), never ISO — this is narrative, not a table
  cell (design.md §6).
- **Avatar** (ADR Decision 4, image-proxy ADR): initials from `initialsOf` are the
  resting state; the signed-in user's photo via `/api/me/avatar` is an enhancement
  that may fail. Historical authors are a stored handle string with no photo
  available, so they show initials derived from the handle — record this honestly;
  do not invent a per-author photo lookup. A small shared `Avatar` component is
  introduced here (none exists today; `UserMenu`/`layout` reference `/api/me/avatar`
  ad hoc — fold them in if cheap, else leave for a sweep).
- **Note provenance**: human-written, so no ✦ AI mark (design.md §8); the author
  attribution is the provenance.

## 4. The single-phase surface — read, then update in place

The per-phase popover (design.md §4b/§5) is the reference assembly the converged
pieces slot into. It is `OverlayDialog` (#34), opened by the phase's fragment
`#phase-:phaseId-progress`, and holds:

1. **VIEW (rest)** — `HillChart` single-phase, read-only, above the story
   (§5.1). One `status · date · Update` action line (design.md §7).
2. **UPDATE (in place)** — the SAME overlay reveals the edit form; `HillChart` gets
   an `edit` capability (draggable dot + off-screen range), the REQUIRED note field
   appears, Save/Cancel drop back to VIEW. **Never a second `<dialog>`** (design.md
   §4b). Save calls `updatePhaseHill` and reloads the phase's complete log
   (`getPhaseLog`) so the new card joins the story the popover is showing.

This is what `PhaseHillGauge` did inline for `PhaseGraph`, and what `PhaseTrack`'s
`detailsOverlay` does with a hand-rolled scrim. Convergence: both use `HillChart` +
`OverlayDialog`, and `PhaseTrack`'s scrim/`popover`/manual-Escape/`body.overflow`
lock are deleted in favour of `OverlayDialog` (ADR Decision 5; the last hill overlay
still dodging #34).

## 5. The two history views — `HillHistory` (ADR Decision 5)

A list of `HillSnapshotCard`s. Both views use it; they differ only in what they are
handed.

```ts
interface HillHistoryEntry {
  at: string; progress: number; previousProgress: number | null;
  note: string | null; author: string | null;
  phaseId: number; phaseName: string; color: string; // phaseName shown only when asked
}
interface HillHistoryProps {
  entries: HillHistoryEntry[];       // newest first
  showPhaseName: boolean;            // false = per-phase, true = aggregate
  emptyLabel?: string;
  locale: Locale;
}
```

### 5.1 Per-phase history (exists, buried → extracted)

- **Home unchanged**: the phase's progress view at `#phase-:phaseId-progress`
  (design.md §5). It still carries the **complete** log — the program page preloads
  only the 6 newest states per phase, and the popover fetches the rest on open via
  `getPhaseLog` (already true; keep it). No "full history →" link — the popover *is*
  the record (ADR: alternative rejected).
- `showPhaseName={false}` — every card is the same phase; naming it each row is
  noise.
- The current inline "latest update is the headline, older ones compact" split
  (`PhaseTrack.storyView` + a `compact` `HillHistoryList`) becomes `HillHistory` over
  the full log. Whether to keep a visually-larger "latest" card is an implementation
  choice; the data is one list newest-first.

### 5.2 Aggregate history (new)

- **What**: every progress update on every phase in the program, newest first, each
  card naming its phase (`showPhaseName={true}`, colour = `phaseColor(phaseId)`).
- **Data**: a new server reader, e.g. `getProgramHillLog(projectId)` in
  `app/actions/hill.ts` (or `lib/history.ts`) — union of all phases' `PhaseState`
  rows, ordered by timestamp desc, each carrying `{ at, progress, previousProgress,
  note, author=source, phaseId, phaseName }`. `previousProgress` is per-phase (the
  prior state of the SAME phase), so compute it within each phase's series before
  the global merge. This is the only new data the convergence needs.
- **Home**: an `OverlayDialog` opened from the aggregate summary hill's affordance
  (§6), as its own URL fragment on the program page — `#phase-updates` (a program
  fragment, distinct from `#phase-:id-progress`; "everything is a URL", design.md §2).

## 6. Affordances (ADR Decisions 3, 5)

| Hill | Gesture | Opens | Editable? |
|---|---|---|---|
| Aggregate summary (`PhaseTrack` band) | click the chart's affordance | aggregate history `#phase-updates` | **No** — read-only; dots still deep-link to rows |
| Single phase (rail card / `PhaseGraph` / feed) | open the phase | per-phase progress view `#phase-:id-progress` | **Yes**, via in-place UPDATE (where the caller permits) |

The aggregate gets a **history** affordance, never a drag — it has no unambiguous
subject to update (ADR Decision 3). A single-phase hill's affordance is the phase's
own popover, which carries UPDATE.

## 7. Implementation follow-ons — the PRs this tracking issue spawns

Ordered by dependency. Each is its own screenshot-verified change (design.md §9,
AGENTS lesson 18: 360/768/1024/1440, both themes, both styles, a long phase name,
and a program with enough phases to force label shingling). **Nothing below is built
in the PR that lands this spec.**

1. **`HillChart`, the one drawing (§2).** Build the discriminated-union component at
   the `0 0 200 104` viewBox with owned rem heights (`gauge`/`band`), markers-round
   proof from a screenshot. Port `layoutHill` to the fixed x-axis (drop `sx`). Ship
   the guard that makes "editable aggregate" fail (a unit test that the aggregate
   arm has no `edit`, + a dev assertion) — AGENTS lesson 2. Keep `ChartLabel` for
   every label (#23).
2. **Swap the read-only single hills onto `HillChart`.** `FeedList` (`PhaseHillSvg`)
   and `PhaseTrack.MiniHill` → `HillChart` single-phase read-only. Pure visual
   swap; no behaviour change. Verifies the size contract before the editable path
   depends on it.
3. **`HillSnapshotCard` (§3) + `Avatar`.** Relayout the history card to the vertical
   Basecamp stack; introduce the shared `Avatar` (initials + `/api/me/avatar`).
   Scope the relayout to the hill history so `NeedleHistoryList` is untouched.
4. **`HillHistory` (§5) replaces `HillHistoryList`.** Per-phase view first, driven by
   `getPhaseLog`, `showPhaseName={false}`. Wire it into the phase popover in place of
   the inline `storyView` + `compact` `HillHistoryList`.
5. **Move `PhaseGraph`'s per-phase gauge onto `HillChart` + the in-place UPDATE
   surface (§4).** Retire `PhaseHillGauge`'s dialog/note/mutation ownership into the
   caller; delete `PhaseHillGauge`/`PhaseHillSvg` once no importer remains.
6. **Move `PhaseTrack`'s phase-detail popover onto `OverlayDialog` (ADR Decision
   5).** Delete the hand-rolled `scrim`/`popover`, manual Escape, and manual
   `body.style.overflow` lock. Behaviour parity verified against §4b's two `<dialog>`
   traps.
7. **Aggregate history (§5.2).** Add `getProgramHillLog(projectId)`; add the
   aggregate-history affordance on the summary band opening `#phase-updates` in an
   `OverlayDialog`, rendering `HillHistory` with `showPhaseName={true}`.
8. **Retire `PhaseHillChart`.** Point `PhaseTrack`'s summary band at `HillChart`'s
   aggregate arm; delete `PhaseHillChart`. Confirm the audit (§8) has no remaining
   importer of a retired component.

## 8. Usage audit — every hill, converge or exempt

Swept `grep -rn "PhaseHillChart\|PhaseHillGauge\|PhaseHillSvg\|HillHistoryList\|MiniHill\|HILL_PATH\|hillCoordinates" src --include="*.tsx"` (re-run before closing #37; where this list enumerates the instances, that listing IS the sweep — confirm it is still complete, AGENTS lesson 7).

| Site | Today | Converge to | PR |
|---|---|---|---|
| `PhaseTrack` summary band | `PhaseHillChart wide` | `HillChart` aggregate + `#phase-updates` affordance | 7, 8 |
| `PhaseTrack` rail card | inline `MiniHill` (`0 0 200 90`) | `HillChart` single read-only | 2 |
| `PhaseTrack` phase popover — log | `HillHistoryList compact` + inline `storyView` | `HillHistory` + `HillSnapshotCard` | 3, 4 |
| `PhaseTrack` phase popover — chrome | hand-rolled `scrim`/`popover` | `OverlayDialog` (#34) | 6 |
| `PhaseTrack` phase popover — update SVG | inline `viewBox="0 0 200 104"` | `HillChart` single + `edit` | 5, 6 |
| `PhaseGraph` row | `PhaseHillGauge` (10 props) | `HillChart` single + in-place UPDATE | 5 |
| `FeedList` hill entry | `PhaseHillSvg` | `HillChart` single read-only | 2 |
| `HillHistoryList` | side-by-side card | `HillHistory` / `HillSnapshotCard` | 3, 4 |

**Explicitly exempt (recorded, not silent):**

- **`ProjectStatusDashboard` → `NeedleGauge`** is the program **needle** (health +
  overall position), not a hill chart. design.md §8c: the needle is off limits and
  is a different graphic. Its field is confusingly named `currentHillChartProgress`
  (it is the needle's position), but it renders `NeedleGauge`. Out of scope.
- **`NeedleHistoryList` / `NeedleGaugeSvg`** — the needle log and primitive; a
  different graphic. `HillHistoryList` currently borrows `NeedleHistoryList.module.css`,
  so the card relayout (PR 3) is scoped to the hill history and leaves the needle
  history as-is.
- **`ActivityFeed`** references "Hill updates" only as a feed *category label*; it
  renders no hill.

## 9. Acceptance (from #37)

- One hill drawing, one owned rendered size, used everywhere.
- The aggregate cannot update (unrepresentable in the type + guarded); the single
  phase can, in place (design.md §4b).
- Both history views use the same snapshot card, laid out per §3.
- Per-phase history still carries the complete log and still lives at
  `#phase-:phaseId-progress`.
- Label halos preserved (`ChartLabel`, #23).
- No responsive regression: verified from screenshots at 360/768/1024/1440, both
  themes, both styles — a long phase name and a shingling-forcing phase count
  included (AGENTS lesson 18).
