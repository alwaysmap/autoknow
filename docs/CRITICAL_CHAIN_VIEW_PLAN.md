# Critical Chain view — buffer gains & losses per phase and program

STATUS: IMPLEMENTED (v1, 2026-07-20) — the deterministic layer and both surfaces
are live: `src/lib/chainLedger.ts` (pure ledger + situation packets, TDD'd in
`tests/chainLedger.test.ts`), `src/lib/chainLedgerData.ts` (server loaders),
`src/components/ChainLedger.tsx` (program page §4a/§4b/§4c) and
`src/components/BusiestResources.tsx` (ecosystem §4c portfolio notice), i18n'd
en/de/ja/ko, with seed showcase programs covering every situation in the
taxonomy (`lib/seed.ts` "chain-ledger showcase"). Still open: the structured
Gemini prompt evaluation (Q11), forecast snapshot on PhaseState (§7.1), and
the other deferred questions in §8.

UPDATE (2026-07-23, issue #75): the §4a Schedule was RE-ENCODED. The time-scaled
Gantt with full-height hatch/stipple buffer bands was method-correct but unreadable
on a complex chain (a band belonged to no row; the textures vibrated). It is now a
**phase × week state grid** (`src/components/ChainSchedule.tsx`) — one row per chain
phase, one column per ISO week, each cell coloured by state (on-plan / over / early /
idle / forecast), so a COLUMN is a moment in time and reading down it compares every
phase at once. Transitions are drawn **to the day** (cells clip to true start/end;
idle handoffs render to the day — the relay-runner "start ASAP" behaviour). A
**buffer-on-hand lane** sits below on the same axis (the old §4b waterfall's numbers,
now positioned in time), each inflection labelled with the buffer actually in hand
there. This also SUPERSEDED the "break the time axis" work (was issue #42): the axis
now reaches the SOP, and a run of ≥ 6 EMPTY weeks (no phase, no handoff — the buffer
tail, or the SOP-overshoot span) COLLAPSES to a marked break (the conventional
double-slash glyph) that states how much time it compresses, keyed on emptiness so
the overshoot case collapses the right span (design.md §8c / #42's honesty rules).

Two follow-ons completed #75's readability arc. (1) The buffer lane now KEEPS every
per-phase step when several move the buffer in one week and FANS their labels out in y
(`dodgeLabels` in `src/lib/labelPlacement.ts`) rather than hiding the losers — a hidden
step hides a real move. (2) An operable **zoom/pan focus window**: the x-axis narrows to
a date range (Fit / 2-week / zoom ±, `src/lib/focusWindow.ts`) that the user slides by
dragging the chart, so day-level detail in a busy fortnight is legible; markers and
risers outside the window are dropped rather than edge-clamped. Still open from #75's
neighbours: the #22 touch-gesture story (the pan is mouse-only for now).

UPDATE (2026-07-25, issue #161 step 2/4): the buffer-on-hand LANE described above is
GONE, replaced by a **two-tone buffer flow** — one value per day, buffer LEFT (green,
in hand) against buffer SPENT (red), with the boundary between them as the whole
reading. The lane's per-move fidelity was deliberately dropped, not moved: it already
exists twice, in §4b "Where the buffer went" and in the day summary (`lib/chainDay`),
and most of the lane's code existed to stop ~10 riser labels colliding. The day series
is `src/lib/bufferSeries.ts` (gated against the §4b waterfall by a balance test, so the
two renderings of one set of books cannot disagree) and the render frame is
`src/lib/bufferFlow.ts`. The frame is DERIVED at render time and never clipped: it
holds 0% and 100% and extends past either end — above 100% when a phase hands back more
than the program started with, and below 0% when the buffer is blown, where the axis is
labelled in what it means (`−50% · 83d past SOP`) and the day the buffer ran out is
marked. `guidelineDays` is a marker at the right edge rather than a full-width rule,
because it is `remainingTotal / 2` — a value that only exists as of now — and it is
omitted rather than clamped when it falls outside the frame. The phase × week grid
above is UNTOUCHED by this step; #161 steps 3–4 replace it with per-row bars and swap
the row hover card for a docked day strip.

UPDATE (2026-07-24, user call): **an overrun against a phase's own estimate is now a
LEVER, and past a threshold it is the program's headline.** The taxonomy always
detected `sunkOverrun` / `forecastOverrun`, but only §4b spent them — the response
ladder never composed a reaction from either, so a phase could pass double its
estimate under a judgment sentence reading "Nothing needs to change today". Three
changes: (1) every overrun packet now carries `overPct` — days as a share of the
estimate, because 5 days over a 10-day phase and 5 over a 200-day one were both
reported as "5 days"; (2) the ladder's rungs lead with root-cause-or-re-estimate
bullets (live phases one each, finished ones collapsed into one re-planning bullet
with a link to the phase editor), placed FIRST since fixing a phase is less
disruptive than moving people or moving the SOP; (3) a RUNNING phase at or past
`SEVERE_OVERRUN_PCT` (10%) becomes `ledger.immediateFocus`, which forces the `act`
register — a buffer only says the damage hasn't reached the SOP yet — and renders a
program-level line in the page header ("Immediate focus — … Exploit the constraint"),
above the needle and the chain section. Finished overruns never take that flag: that
time is spent, so they earn a re-plan, not an all-hands.

## 1. Why

AutoKnow exists to support decision making and best use of a limited team — not
to produce theoretically complete program-management tooling. Critical chain is
the lens because it fits these programs, but the levers leadership can actually
pull are few:

1. **People** — who works on what, across programs.
2. **Program count** — which programs to run, pause, or stop.
3. **Program benefits** — market impact: first-year volume, products carried,
   SOP timing.

Every surface in this view must inform at least one lever; anything that is
method-correct but lever-neutral stays out.

| Surface | Lever | Decision it informs |
|---|---|---|
| Headline + Schedule (§4a) | count / benefits | Will this SOP hold? Is the slip acceptable given the volume and products at stake? |
| Where the buffer went (§4b) | people | The loss was contention or an idle handoff — reassign, escalate, or start the waiting phase |
| Constraint resources (§4c) | people | Alice gates two SOPs — rebalance, resequence, or protect their calendar |
| Portfolio notice (§4c) | people + count + benefits | Which program gets the constrained resource — weigh buffer loss against units at stake |

The program page already *finds* the critical chain and paints it on the PhaseTrack
rail, and the ecosystem dashboard already answers "on track for SOP?" as a single
slack number. What no surface answers is the question a program driver actually acts
on: **where is my schedule buffer going, and what is eating it?**

Critical Chain (CCPM, not critical path) frames that as buffer accounting:

- The chain's remaining work plus **one program buffer** protects the SOP date.
- Every phase that runs longer than its forecast **consumes** buffer; every phase
  that finishes early **returns** buffer.
- The driver watches buffer *consumption rate* vs. chain *completion* — not
  per-phase due dates — and intervenes when consumption outpaces completion.

This document inventories what the schema and libs already give us, defines the
buffer ledger as pure derivations over that data, and proposes the component view.

### Goldratt's Critical Chain, formally — and its mapping onto AutoKnow

The reference definitions are Goldratt's *Critical Chain* (1997) and the TOCICO
dictionary, not our own paraphrase. Formally:

> The **critical chain** is the longest sequence of dependent tasks, where
> "dependent" covers BOTH precedence (task) dependencies AND **resource
> dependencies** — two tasks competing for the same scarce resource are chained
> even when no edge connects them. It is identified **once, at planning, after
> resource leveling, and does not change during execution.**

Around that chain, Goldratt's method has five more load-bearing parts: task
estimates stripped of per-task safety (~50%-confidence, "aggressive but
achievable"), with the removed safety pooled into buffers; a **project buffer**
at the chain's end protecting the commitment date; **feeding buffers** wherever
a non-critical path merges into the chain; **resource buffers** — alerts, not
time — warning a chain resource its task is coming; and execution managed by
**buffer penetration** (consumption vs. chain completion), never by per-task
dates. Behavioral corollaries: relay-runner handoffs, remaining-duration
reporting instead of %-complete, and multi-project multitasking as the cardinal
sin (the multi-project "drum").

Element by element against AutoKnow's data and structures:

| # | Goldratt element | Formal meaning | AutoKnow mapping | Status |
|---|---|---|---|---|
| 1 | Chain identification | Longest chain over precedence **+ resource** dependencies; fixed at planning | `computeCriticalChain` is precedence-only and re-derived per render over *remaining* work | **Divergent, twice** — corrections below |
| 2 | Project buffer | Explicitly **sized** (≈50% of chain, Leach's cut-and-paste rule) and placed before the commitment date | SOP slack (`sopOutlook`) is the buffer — residual, not sized | Approximated; §4 headline adds an advisory 50%-rule comparison |
| 3 | Buffer management | Track buffer penetration vs. chain completion; act by zone | Buffer level + 4-week change (from the §3 replay) set the headline's judgment sentence — management by buffer consumption, rendered as words rather than a control chart | **Aligned** in mechanism |
| 4 | Feeding buffers | Time buffers inserted at every merge into the chain | Merge-point **penetration alarms** (§3) — monitored, not inserted | Approximated (monitor-only) |
| 5 | Resource buffers | Wake-up alerts on chain resources; consume no elapsed time | Contention pills, the Resource notice, `constraintWhy` | Approximated — flags *current* contention; no "your chain task starts soon" lookahead |
| 6 | No task due dates | Dates exist only at the buffer/commitment | Phases carry no dates; only the SOP does | **Aligned** |
| 7 | Relay runner | Start when handed the baton, pass it immediately | `startedAt`/`completedAt` handoff-gap detection (§3) | Aligned (detects violations) |
| 8 | Remaining-duration reporting | Ask "how many days left?", never %-complete | Hill % mapped linearly to remaining (`D × (1 − p/100)`) | Divergent-lite — the hill is a subjective judgment (closer to Goldratt than earned-value %), but the linear map is ours; open question 10 |
| 9 | Safety-stripped estimates | ~50% estimates; pooled safety funds the buffers | `forecastedDuration` as entered, padding unknown | Absent — a process change, not a UI one (§5) |
| 10 | Multi-project drum | Stagger programs around the constraint resource | Cross-program `otherActive` counts exist; no scheduling uses them | Absent (the raw signal is already computed) |

**Two design decisions follow from element 1:**

1. **Split chain identification from constraint-finding.** Goldratt identifies
   the chain at planning over full durations and keeps it fixed; execution is
   managed through buffers. `computeCriticalChain`'s longest-*remaining*-path
   solve is a constraint finder, not the chain. v1 separates the two with no
   schema change: the **planned chain** = the longest path by full
   `forecastedDuration` (progress ignored) — deterministic, stable across
   progress updates, changing only when someone edits structure or durations,
   which is a replan. The buffer, ledger rows, and trend numbers all anchor to
   the planned chain. The live remaining-path solve becomes a **detector**:
   when it disagrees with the planned chain, the view raises a re-baseline
   notice instead of silently repainting the spine.
2. **Resource dependencies stay out of the v1 solve, explicitly.** A chain link
   Goldratt would draw — two phases with no edge, sequenced only because the
   same partner/person must do both — is invisible to a precedence-only solver.
   The data to level with exists (`PhasePartner`/`PhasePerson` + cross-program
   activity); the instruments take a chain as input and would accept a
   resource-leveled one unchanged (open question 9). Until then contention
   renders as evidence (pills, notices, waterfall annotations), and no surface
   claims the chain accounts for it.

## 2. What exists today (the building blocks)

### Schema facts

| Fact | Where | Notes |
|---|---|---|
| Phase DAG | `PhaseDependency` (`prisma/schema.prisma:179`) | acyclic + single-sink enforced by `validateTemplateDag` at save |
| Planned duration | `Phase.forecastedDuration` (days, default 30) | editable any time; **no history** — see §7 |
| Explicit start | `Phase.startedAt` | the Active toggle; wins over derived first-progress timestamp |
| Progress history | `PhaseState` (append-only, `hillChartProgress` 0–100, timestamped) | the replayable record — this is what makes the buffer trend computable |
| Program target | `Project.sopDate` | month-end normalized (`lib/sop.ts`); required by policy, absence is its own flag |

### Derived facts (already computed on the program page, `src/app/programs/[id]/page.tsx`)

- **startedAt** — explicit toggle if set, else first `PhaseState` with progress > 0
  (SQL aggregate, never full-history loads).
- **completedAt** — first `PhaseState` with progress ≥ 100.
- **progress** — latest `PhaseState`.
- **Resource contention** — per partner/person/owner: count of active phases in
  *other* live programs (CCPM's resource dimension, flagged not leveled).

### Existing math (all pure, client-safe)

- `lib/criticalChain.ts` — longest path by **remaining** duration, where
  `remaining = forecastedDuration × (100 − progress) / 100`. Yields the path, the
  chain's remaining days, and the **constraint** (first unfinished phase on it).
  NB: per §1, this is formally a *constraint finder*, not Goldratt's chain
  identification — the view uses it as the former and adds a planned-chain solve
  (same algorithm, progress ignored) as the latter.
- `lib/sop.ts` `sopOutlook()` — `now + remainingChainDays` vs. SOP →
  `slackDays` / `onTrack`. **This slack is already, implicitly, the program
  buffer.** It's just never framed, trended, or attributed.
- `PhaseTrack.tsx` `pace()` — per-phase "took 5w vs 3w planned" / "over plan"
  chips. **This is already, implicitly, per-phase buffer loss/gain.** Same gap:
  computed for a chip, never aggregated.
- `lib/forecast.ts` — **DELETED 2026-07-24 (#129).** Was a Monte Carlo over a phase
  *count* with a fixed normal(12,4), ignoring the actual DAG and forecasts. It reached
  screen twice under two different labels; the second time it was a sortable column. The
  SOP outlook now derives from the real chain (`sop.sopOutlook` over
  `criticalChain.remainingDays`). See ADR
  `forecasts-derive-from-the-real-chain-never-a-synthetic-model`.

### Existing surfaces

- **PhaseTrack** (default phases UI): chain as the heavy mainline, amber-ringed
  constraint, `constraintWhy` evidence line, pace chips, contention pills.
- **Ecosystem dashboard**: per-program `slackWeeks` / `lateByWeeks`.
- **Leadership summaries** (`lib/summaries.ts`): narrate chain → constraint → SOP
  slack as evidence lines.

**The gap in one sentence:** we compute today's chain and today's slack, but nothing
shows slack *over time*, nothing attributes its movement to specific phases, and
nothing catches buffer lost *between* phases (handoff dead air).

## 3. Definitions — the buffer ledger

All quantities in days, derived per phase; no schema change required for any of them.
Let `D = forecastedDuration`, `p = progress`, `S = startedAt`, `C = completedAt`.

| Quantity | Done phase | Active phase | Not started |
|---|---|---|---|
| Actual/elapsed `A` | `C − S` | `now − S` | — |
| Remaining `R` | 0 | `D × (1 − p/100)` | `D` |
| **Duration variance** `V` | `A − D` (＋ = loss, − = gain) | `max(0, A − D)` (a *growing, unbooked* loss once elapsed > plan) | 0 |

Two variances the per-phase table cannot see, which the ledger must:

- **Handoff gap `G`** — for each chain edge where the upstream phase is done and
  the downstream hasn't started: `now − C_upstream` (or `S_downstream − C_upstream`
  once started). Days nobody's phase owns, but the program pays. Fully derivable
  from existing timestamps; today it is *invisible on every surface*. In
  Goldratt's terms: a relay-runner violation, caught by the baton timestamps.
- **Planned chain vs. live constraint** (correction 1 in §1) — all ledger
  quantities anchor to the **planned chain** (longest full-duration path, stable
  under progress). The live longest-*remaining*-path solve runs alongside as a
  detector: when its path diverges from the planned chain, the view raises a
  **re-baseline notice** naming the branch that now gates the program. A
  re-baseline (structure or duration edits changing the planned chain) is an
  *event the view calls out* (the re-baseline notice, §4a), never a silent
  repaint.

Program level:

- **Projected finish** `F = now + Σ R over the planned chain` (`sopOutlook`'s
  forecast, fed the planned chain's remaining work).
- **Program buffer** `B = sopDate − F` (exactly `slackDays`, reframed). Positive =
  buffer in hand; negative = SOP overshoot. Goldratt would *size* this buffer
  (≈50% of the chain) and commit to `F + buffer`; we inherit a committed SOP and
  read the buffer off as the residual — the 50%-rule ratio feeds the
  judgment-sentence calibration (§4) rather than appearing as its own display.
- **Buffer delta since t₀** `ΔB = B(now) − B(t₀)`, attributable as
  `ΔB ≈ −Σ V_done-since-t₀ − Σ V_active − Σ G ± (re-baseline effects)`.
  The attribution won't always sum exactly (durations get edited, re-baselines
  land); the view shows the components and an explicit "unattributed" remainder
  rather than forcing the books to balance.
- **Feeding-branch penetration** — for each off-chain branch joining the chain at
  phase `J`: `branch remaining − (chain remaining up to J)`. Positive means the
  branch, not the chain, will gate `J` — the CCPM feeding-buffer alarm. Cheap to
  compute from the same solve; worth a one-line notice, not its own chart (§8).

### Replaying `B(t)` — the trend

`PhaseState` is append-only, so progress at any past `t` is reconstructable:
latest state per phase at `t`, plus `startedAt`/`completedAt` clamped to `t`,
fed through the planned-chain remaining sum + `sopOutlook` with `now = t` — the
chain itself stays pinned across the replay (Goldratt: buffers move, the chain
doesn't). Sample weekly from the earliest phase start to now — tens of points,
each over tens of rows; one indexed query for
`(phaseId, timestamp, hillChartProgress)` tuples serves the whole replay.

Replay limitations (disclosed in the UI):
`forecastedDuration` and `sopDate` have no history, so the replay uses their
*current* values — the trend shows progress-driven buffer movement, not
plan-editing history. §7 discusses the one cheap schema addition that would fix
this going forward.

## 4. The proposed view

A new **Critical Chain** section on the program page (see §6 for placement), built
from two instruments plus a headline. All follow the house grammar: monochrome
ink + theme tokens, the amber `--chain` accent only for the constraint, words for
judgments instead of color fills, every mark clickable through to the phase
(jump-and-flash or the details popover PhaseTrack already owns).

### Language rules: sentences, judgments, and reactions

The audience is a program manager / technical engagement lead who has not read
Goldratt and should not have to. Goldratt's vocabulary lives in this doc and
(optionally) the ⓘ key. Every UI string goes through `lib/i18n` like the rest
of PhaseTrack and passes three tests:

1. **No mental translation.** Facts are written as sentences with the units and
   dates spelled out — "61 days of buffer between the estimated end on
   December 30, 2026 and the SOP at the end of February 2027", never
   "Buffer: 61d to SOP (2027-02)".
   Inside dense charts a label may be a short phrase ("9 days over plan"),
   never bare signed notation ("+9d"). No framing filler either — phrases like
   "the practical levers" or "key considerations" name nothing; state the
   options directly. Dates: ISO (`yyyy-mm-dd`) only in
   tabular/sortable cells (design.md §6); everywhere else the localized prose
   form — "July 2027", "May 13" — via the existing `localDate`/locale plumbing.
2. **Every fact carries its judgment.** A number alone forces the reader to
   decide whether to worry. "About 42 days of work left" must say which it is:
   "…— on pace with its plan". Non-problems say so explicitly ("on pace —
   nothing to do here"); silence is ambiguous.
3. **Every visible problem names the reasonable reactions**, and the reactions
   are *computed from the data*, never canned advice. "Alice gates Cert and is
   active in 3 other programs" is followed by which of Alice's other
   commitments have slack (those programs' buffers are known) — so the reader
   sees the actual moves available: shift their time from the programs that can
   afford it, or accept the slip and know its size. Sunk losses say they're sunk ("already
   spent — shown so the next plan with Bosch is realistic").
4. **Never gender a person.** Gender is not in the data; sentences use the
   person's name or they/them ("decide which program gets their time"), in
   templates and generated text alike. Repeating the name over a pronoun also
   keeps the de/ja/ko templates free of pronoun inflection.

Judgments are sentences, not status chips. The headline's second line — 
"Nothing needs to change today…" / "Time to act: …" — *is* the program's
status; a separate status word ("watch") duplicated it and was removed. The
three reaction registers (no action needed · have a plan ready · intervene
now) live in the sentence itself.

| In this doc (method term) | On the surface |
|---|---|
| Program buffer / buffer penetration | "61 days of buffer between the estimated end on December 30, 2026 and the SOP at the end of February 2027" (the headline; consumption detail lives in Where the buffer went) |
| Chain ledger (§4a) | Section titled **Schedule** — bars, dates, and the SOP line |
| Buffer waterfall (§4b) | Section titled **Where the buffer went**; rows read "cost 9 days" / "gave back 3 days" |
| Feeding-branch penetration | "A side branch is running late: *Cert prep* will hold up *Cert* by about 6 days" |
| Re-baseline notice | "The longest remaining work now runs through *Cert prep*, not the planned chain. Review the phase plan?" |
| Handoff gap / relay-runner violation | "Idle 6 days: *SW integration* finished May 13, *Cert* didn't start until May 19" — with the forward-looking reaction: "the next handoff (*Cert* → *Production readiness*) can be agreed now" |
| Resource buffer (wake-up call) | "Up next: *Production readiness* — *Bosch*, also active in 2 other programs. Worth confirming their staffing before *Cert* finishes" |
| 50%-rule sizing advisory | Not shown on the page — calibrates the judgment sentence; the ratio appears in the ⓘ key |
| Constraint | "Constraint" — already established on the rail and in the key |
| Constraint resource / multi-project drum | "*Cert* is with **Alice** — also active in 3 other programs", followed by which of those can afford to give time back; ecosystem card titled **Busiest people and partners**. Surface copy avoids "chain work"/"chain resources" — "also active in N other programs" carries the fact in plain words |
| Critical chain | Kept as the feature name (already on the rail), always shown as the actual phase names, never discussed abstractly |

### Headline

> **61 days of buffer** between the estimated end on December 30, 2026 and the
> SOP at the end of February 2027.
>
> Nothing needs to change today. If the trend keeps falling: *Cert* is with
> Alice — their other programs' slack is listed below — and the *Cert* →
> *Production readiness* handoff can be agreed now so no idle days repeat
> there.

The headline is ONE sentence (2026-07-20 user call): buffer, the estimated end
date, the SOP. The history it used to carry — started with N days, M used, and
which phases took them — is exactly what §4b's "Where the buffer went" shows
with evidence, so the headline no longer repeats it.

Fact, then judgment-with-reactions — all generated from the ledger (the
reactions sentence composes from §4c's computed options, not canned text). The
judgment sentence's register comes from the buffer's level and 4-week change
(computed from the §3 replay), with the 50%-rule ratio (§1 element 2) as a
second calibration input — thin reserve
against remaining work keeps the sentence cautionary even when the trend is
flat. The ratio itself lives in the ⓘ key, not on the page: it calibrates
urgency but doesn't move a lever on its own.

### The response ladder — urgency in the app's own status vocabulary

The judgment sentence escalates through three registers of urgency, and the
top rung speaks the app's existing status language
(`lib/health.ts`: **On Track / Some Risk / Concerned** — the needle's three
colors). Each rung's reactions are computed, ordered by least disruption:

1. **No action needed** — "Nothing needs to change today." Levers listed as
   available, not urged.
2. **Have a plan ready** — "Next Step:" followed by the computed options
   (which of Alice's programs have slack, the next handoff to agree, and — if
   the needle still shows On Track — "consider declaring *Some Risk* so
   leadership sees this coming").
3. **Intervene now** — "Time to act. In order of least disruption:" move
   named time from the named programs that can afford it; agree the named
   handoff; and if those don't close the gap, **"declare the program
   *Concerned* and propose moving the SOP to April 2027"** — with the benefit
   impact stated from the same ramp math as the capacity chart ("45k of the
   120k first-year units would shift into ’28").

The declaration is a doorway, not an automation: the link opens the existing
program update dialog with the evidence note pre-composed (chain, buffer
numbers, what was tried), and a proposed SOP sized by the overshoot. The
needle stays human-set — design.md §3 makes the gauges non-gameable, and a
self-setting needle would be exactly that. The view supplies the evidence and
the button; a person makes the call.

### What is deterministic and what is AI

**Critical chain is deterministic — pure functions and data, no exceptions.**
Every number (buffer, deltas, variances, gaps, unit impact), every ranking
(movable slack ordered by those programs' buffers, ties broken by volume), and
the *situation detection* itself. The situations form a finite taxonomy —
sunk overrun · forecast overrun · idle handoff · upcoming handoff to confirm ·
oversubscribed person with movable slack · partner gating one SOP · SOP
overshoot with a sized proposal · nothing to do — each detected by a rule over
the ledger. This layer's output is a **situation packet**: a structured record
per detected situation carrying the type, every relevant number, the candidate
moves with their slack, the stakes, and any named precedents.

**What to consider *doing* about a situation may be more nuanced — that is
the one place a structured Gemini skill is under consideration.** Two ways to
turn a situation packet into the Consider/reaction sentences:

- **Templates (v1, and the permanent fallback):** one `lib/i18n` template per
  situation type, slots filled from the packet. Testable, translatable,
  identical for identical data, cannot hallucinate. Everything drafted in this
  document and the mockup is expressible this way.
- **A highly structured Gemini prompt/skill (under evaluation):** the packet
  is the *entire* input — the prompt is tightly constrained, DB-resident like
  `SummaryPrompt` (tunable without a deploy), output through the
  `geminiSchemas` pattern, every number cited from the packet and no new
  numbers permitted. What it can add over templates: weighing options *across*
  situations (a handoff fix vs. a people move vs. accepting the slip) and
  folding in the qualitative why from update notes and `ContextUrl` digests —
  the composition cases where per-situation templates get clumsy.

Separately and regardless of that choice, narrative "why" context stays AI's
job where it already lives: `lib/summaries.ts` consumes the chain and SOP
outlook as evidence today; fed the ledger, the program brief can say "Cert is
over plan because the OEM security signoff has been pending since June (per
the June 12 update)". The evidence note pre-filling a Concerned declaration
can be AI-drafted the same way, for the human to edit before saving.

Boundaries, all existing law, whichever way the recommendation question lands:
AI text carries the ✦ mark (design.md §8); AI never produces a number or a
ranking — it may only cite the packet's; and when Gemini is unconfigured the
view is whole on templates alone (lesson 5, the `geminiConfigured` pattern).

### (a) Chain ledger — time-scaled chain vs. SOP

The instrument for "where does the time go." A single horizontal time axis from
the earliest phase start to a bit past SOP; the SOP as a labeled vertical rule.
One row per **planned-chain** phase, in chain order:

- **Done**: a solid bar from `S` to `C`; a thin tick at `S + D` marks where plan
  said it would end. Bar past tick = loss, visible as overhang; the variance as a
  quiet `+9d` / `−4d` label (the pace chip's numbers, now positioned in time).
- **Active**: solid bar `S → now`, then an outlined (open) bar `now → now + R` —
  the forecast remainder. The constraint ring/amber accent lives here.
- **Not started**: outlined bar of length `D`, cascaded ASAP after its
  predecessor's projected end (phases have no planned start dates — the cascade
  *is* the schedule, and the doc/UI should say so plainly).
- **Handoff gaps**: hatched span between an upstream `C` and downstream `S` (or
  `now`) — dead air made visible.
- **Buffer movement as full-height background bands** — the buffer matters
  enough to shade the whole diagram, complementing the bars: each realized
  overrun (plan tick → actual end) and each idle gap is a soft red band; each
  underrun a soft green band; a *forecast* overrun on the active phase (its
  outline running past its plan tick) a paler red band — visibly at risk, not
  yet spent; and the remaining buffer (forecast end of work → SOP) is one soft
  green band. The bars say what happened; the bands say what it cost or what's
  left. Overshoot renders past the SOP rule in the warn color.

Off-chain phases are not rows here (the rail already shows the full DAG); a branch
whose penetration is positive (§3) gets a one-line notice under the ledger, linking
to its gating phase — and when the live constraint-finder says that branch has
become the longest remaining path, the notice escalates to the **re-baseline
notice** (§1 correction 1): the planned chain no longer matches reality, and the
fix is an explicit replan, not a silent repaint.

### (b) Buffer waterfall — who took it, who gave it back

The instrument for attribution, and the "summarized on a phase level" ask. A small
Tufte-style waterfall: one row per non-zero contributor, sorted by |impact|:

- `HW bring-up +9d over plan` (loss)
- `Kickoff −3d early` (gain)
- `handoff: SW integration → Cert 6d idle` (loss)
- net line = ΔB over the selected window.

The "or signed bar list — decide in UI iteration" this section used to carry is
**decided: no bar** (2026-07-24 user call). The magnitude bar shipped first, sized
0.55rem/day and clamped at 12rem; because it sat in the value column under
`white-space: nowrap` that clamp became a hard min-content floor which starved the
label track and wrapped long phase names (at a 440px column: label 138px vs the
319px it gets without). The signed number alone carries the magnitude, which is
also what design.md §6 "one measure per cell" asks for; gain/loss stays legible as
red/green ink on the text.

Each row cites its evidence (planned vs actual dates) on hover and jumps to the
phase on click. Windowed: since program start by default, "last 4 weeks" toggle.

*(A fever chart — buffer consumed vs. chain complete, the classic CCPM control
instrument — was drafted here and removed 2026-07-20: it didn't add value over
the headline's words. The trend it carried survives as numbers the reader
already gets — "started with 75 days; 14 used" and the 4-week delta — computed
from the same §3 replay, which also feeds the portfolio table's trend column.
The judgment sentence's register is set from that buffer level + trend
directly; no chart needed.)*

### Interaction summary

- Every bar/row → `jumpTo(phaseId)` on the rail or `openDetails` popover
  (both mechanisms exist in PhaseTrack; the section shares its container).
- Hover → evidence tooltip (dates, planned vs actual — never just a number).
- The section collapses like other program-page sections; the headline sentence
  stays visible when collapsed (the summary survives the fold).
- i18n via `lib/i18n` like every PhaseTrack string.

## 5. Exclusions

- **No per-phase due dates.** CCPM's core discipline — dates belong to the SOP and
  the buffer, not to phases. The ledger shows spans and variances, never "Phase X
  due Aug 4".
- **No proportional fill on the rail.** The track's segments keep their binary
  done/not ink (the existing rule); time lives in this section's time-scaled bars.
- **No fabricated precision.** Remaining work is `D × (1 − p/100)` — a hill-chart
  guess times a forecast. Everything renders in days/weeks rounded, and the
  headline says ≈. Concretely: a *forecast* variance under
  `FORECAST_NOISE_DAYS` (2) is noise and is reported nowhere — one exported
  predicate (`isForecastOver`) governs the chart band, the bar label, the
  waterfall row, and the situation packet, because when the chart and the
  ledger each carried their own threshold a +1-day phase drew a red band and
  an "over plan" label with no waterfall row behind it. Realized (done)
  variances come from real dates and count from 1 day. That threshold rule
  generalized (2026-07-27, autoknow-4dr.1): `chainLedger` now exports all FIVE
  waterfall predicates — `hasIdleGapBefore`, `isRealizedOverrun`,
  `isRealizedUnderrun`, `isForecastOver`, `isForecastUnder` — and the buffer
  flow, the day summary, the schedule chart and the row card all choose from
  them. Comparing `varianceDays`/`gapBeforeDays` anywhere else fails `npm run
  lint` (`no-restricted-syntax`, the `chainPredicates` family), so the
  "+1-day phase" class of disagreement can no longer be re-introduced by hand. A single-point projection dressed as certainty is worse than
  useless; v1's forecasts state their simple basis (the hover shows the
  arithmetic), direct "days left" answers override the formula when present
  (open question 10), and the upgrade path to a *grounded* forecast with a
  range is open question 6.
- **No buffer *sizing* doctrine (yet).** Orthodox CCPM cuts padded estimates in
  half and pools the savings as an explicit sized buffer. We have one estimate per
  phase and a hard SOP; the buffer is *whatever slack the SOP leaves*. The
  50%-rule ratio (§4, ⓘ key) is a calibration input only — a yardstick beside
  the residual, not a resizing of anyone's estimates. Adopting actual
  safety-stripped estimation (§1 element 9) would be a process change, not a UI
  change — out of scope.

## 6. Where it lives + plumbing

**Placement — recommendation:** a new section on the program page between the
summary hill and the PhaseTrack rail (it answers "how are we doing" before the
rail's "what's the structure"), collapsed by default to the headline sentence.
Alternative: a `/programs/[id]/chain` sub-route if the instruments prove too tall
for the page. Start inline; promote to a route only if real use demands it.

**New pure lib** `src/lib/chainLedger.ts` (client-safe, mirroring
`criticalChain.ts`): takes the phase rows the page already builds plus the state
tuples, returns `{ plannedChain, ledgerRows, waterfall, bufferTrend, headline,
rebaselineNotice }` (bufferTrend: the replayed `B(t)` samples powering the
headline delta and the portfolio trend column). The planned chain reuses `computeCriticalChain` with
progress zeroed (identification, §1) beside the existing call (constraint
finding) — one algorithm, two questions. Unit-testable with zero DB — same
pattern that made `phaseTrackLayout.ts` testable.

**One added query** in `page.tsx`: `(phaseId, timestamp, hillChartProgress)` for
the project's phases (the existing `spans` aggregate query's sibling; indexed by
`[phaseId, timestamp]`). Everything else the page already fetches.

**New component** `src/components/ChainLedger.tsx` (+ module CSS): renders the
the instruments from the lib's output. Shares jump-and-flash with PhaseTrack via
the existing `autoknow:jump-phase` custom event — no new coupling.

### Seeding direction (2026-07-20)

Seed data should flow through the application's API rather than direct Prisma
writes: it exercises the API and enforces the mutation-boundary constraints
(entity resolution, cycle rejection, validation), so seeded data is correct by
construction. The API surface already covers most of it (`/api/partners`,
`/api/people` + affiliations, `/api/projects`, `.../phases`, `.../state`,
`.../needle`, `.../action-items`). One genuine gap: `PhaseState` is
append-only and stamped at write time, so the showcase's *dated histories* —
what the buffer-trend replay feeds on — cannot be posted through the API
as-is; an API-driven seeder needs either a test-only timestamp override on the
state route or acceptance that trend data stays direct-write. Tracked as a
follow-up; the current seeder stays direct-write until then.

## 7. Schema deltas considered

**None required for v1.** The whole ledger is derivable. Two candidates,
both deferred:

1. **Snapshot the forecast on every state row** — add `forecastedDuration Int?` to
   `PhaseState`, written by `updatePhaseHill` from the phase's current value
   (additive, ships with app code per the playbook). Makes the replay reflect
   plan edits *going forward* — today, editing a forecast silently rewrites the
   past trend. Recommended as a fast-follow once the trend numbers ship; the
   view degrades gracefully without it.
2. **Baseline/planned start dates per phase** — rejected. It reintroduces the
   date-per-phase management CCPM exists to avoid, doubles the editing surface,
   and the ASAP cascade from dependencies + startedAt already yields a schedule.

A third additive candidate — `PhaseState.remainingDays` for direct
remaining-duration reporting — rides open question 10.

### (c) Constraint resources — merged into the next-steps list

Shipped first as its own block ("Who is oversubscribed" → "Resource
Constraints"), then **merged into the headline's next-steps list**
(2026-07-20 user call) once the duplication was visible on a real program:
the terse reactions under "Next Step:" were lossy summaries of the same
facts the block stated in full ("move Bosch's time here from Qualcomm (3
days of buffer)" vs. "Integration is with Bosch — also active in 2 other
programs. If Integration needs more of their time: Qualcomm (3 days of
buffer) can afford to give some back. Ford Evos has no buffer to give").
The fuller sentences won.

The single list now carries, in order: oversubscribed people/partners with
their movable slack, the next phase's staffing confirmation (folded into the
oversubscription bullet when it names the same phase), the program owner's
cross-program load, and — at the `act` register — the Concerned declaration
with its unit impact. The owner line moved here from the phase rail's
notices for the same reason: one place for every schedule/contention
recommendation. The rail keeps only structural DAG problems.

Committed scope (decision 2026-07-20, see §8): the resource dimension is the
leadership priority — in Goldratt's terms, identifying and exploiting the
constraint. Two surfaces:

- **In-program**: a block under the headline naming who is doing chain work now
  and next, each fact followed by its computed reactions. "*Cert* is with
  **Alice** — also active in 3 other programs. Of those, *Nova* (34 days of
  buffer) and *Meridian* (21 days) could give time back; *Polaris EV* is
  tighter than this program." The ranking is real: Alice's other phases joined to
  those programs' buffer numbers. The next-up line is the wake-up call:
  "**Bosch** does the next chain phase — worth confirming their staffing before
  *Cert* finishes." Data: `PhasePartner`/`PhasePerson` on chain phases + the
  existing `otherActive` counts + each program's buffer. Waterfall loss rows
  carry the contention annotation (open question 8, now committed).
- **Portfolio/ecosystem**: a "busiest people and partners" notice on the
  ecosystem dashboard — for each person/partner, which programs' chains they are on, in
  how many they are the current constraint, and the buffer trend of those
  programs **with the benefit at stake beside it**: first-year volume and
  products carried (`Project.volumeFirstYear`, the product flags — the same
  facts the capacity chart uses). Buffer loss translates directly to market
  impact: a slipped SOP shifts that program's whole unit ramp right
  (`unitsAt` in `lib/sop.ts`). The aggregation is the per-program chain solve
  joined across programs; every input already exists. This is the
  cross-portfolio decision surface for all three levers: rebalance Alice
  (people), resequence or pause a program (count), or accept the slip knowing
  exactly how many units it delays (benefits). **Each row ends with a
  computed "Consider:" line** — the so-what for decision makers, built from
  the same data as the row: where the person's movable slack is (their
  involvement in programs whose buffers can afford it), which choice costs the
  least, and what breaks the tie when two SOPs compete (volume at stake). For
  a partner: the concrete ask ("one company active in 5 programs — ask for
  their staffing plan; a named team on the one SOP they gate closes the
  biggest exposure"). A row with nothing to suggest says so and gets no
  Consider line.

Full resource-leveled chain identification (open question 9) remains roadmap —
visibility does not wait for the leveling math.

## 8. Open questions for review

**Decisions 2026-07-20:** Questions 8 and 9's visibility half are committed —
constraint-resource surfacing in-program and at portfolio level is the priority
(§4c); the leveling math itself stays roadmap. Questions 1–7 and 10 are deferred
until example UIs exist for (a) the single-program view and (b) the
portfolio-level notice.

1. **Placement** — inline section (recommended) vs. sub-route?
2. **Waterfall window default** — since-program-start or trailing 4 weeks?
3. **Handoff-gap attribution** — charge gaps to the downstream phase's row in the
   waterfall, or keep them as their own named rows (drafted as own rows — they
   have a different fix: "start the phase" vs "speed it up")?
4. **Feeding-branch penetration** — one-line notice under the ledger (drafted), or
   full feeding-buffer rows in the ledger chart?
5. **PhaseState forecast snapshot** (§7.1) — ship with v1 or fast-follow?
6. **Grounded forecasts (Monte Carlo, re-scoped twice)** — dropped 2026-07-20
   as lever-neutral, revived the same day for a narrower job: the difference
   between a projection and a forecast. The linear hill-derived number ("≈42
   days left → ~20 over plan") is a point projection; where it matters — the
   active chain phase, the SOP outlook — a forecast should carry a stated,
   real basis. NOT the old `forecast.ts` (phase-count × synthetic
   normal(12,4) — no basis). It was retired in #129; see the ADR
   `forecasts-derive-from-the-real-chain-never-a-synthetic-model`.

   **Second re-scope (2026-07-20): the variance pool is not "this org's own
   work."** Phase execution is a partnership effort, so variance is conditional
   on program type and team composition — an HW bring-up with Bosch as Tier 1
   and an OEM-led cert phase are different populations, and pooling them
   grounds nothing. The conditioning keys already exist in the schema (the
   program's `ProgramTemplate`, the phase's `leadPartner`,
   `PhasePartner`/`PhasePerson` composition); the ledger must *record* them
   with every variance from day one so history accumulates correctly labeled.
   But conditioned that finely, N will be 2–5 for years — and resampled
   percentiles from an N of 3 are fake statistics. So the small-N form is
   **named precedents, not distributions**: "the last two programs with Bosch
   on this phase type ran 8 and 9 days over plan" — evidence a leader can
   weigh, in the same register as every other reaction line. A resampled range
   earns its place only if some stratum ever accumulates the history to
   support it. Sequencing: v1 ships the linear basis with its arithmetic in
   the hover; the ledger records conditioning keys from the start; precedent
   sentences appear as soon as one comparable case exists.
7. **Does the ecosystem dashboard adopt the headline?** The per-program slack cell
   could become "buffer + 4-week trend arrow" nearly for free from the same lib.
8. **Resource contention in the waterfall?** Leveling contention into the path
   math stays out of scope (§1 definition), but the waterfall *could* annotate a
   loss row with its likely cause when the phase's people/partners were multiplexed
   while it ran over ("+9d over plan — Bosch was active on 3 other programs").
   Correlation presented as evidence, not causation. Include in v1 or defer?
9. **Resource-leveled identification (§1 correction 2)** — when do we invest in
   folding resource dependencies into the planned-chain solve? It needs a
   scarcity model first (which partners/people are genuinely serial — a Tier 1's
   integration team is; a large OEM probably isn't), and it's exactly the kind of
   mechanism lesson 12 says to red-team before building. Roadmap item; the
   instruments are designed to accept a leveled chain unchanged.
10. **Ask for remaining duration directly?** Goldratt's reporting question is
    "how many days left?" (§1 element 8). The update popover could ask it as an
    optional field (additive `PhaseState.remainingDays Int?`), overriding the
    linear hill-derived remaining when present. Cheap, strictly more Goldratt —
    but a second number to maintain per update. v1, fast-follow, or never?
11. **Recommendation sentences: templates or a structured Gemini skill?**
    (§4 "What is deterministic and what is AI.") v1 ships templates; the
    evaluation is to run a tightly structured prompt against the same
    situation packets and compare outputs side by side — adopt the skill only
    where it beats the template on the same data, with templates remaining
    the unconfigured/degraded path forever.

## 9. References

- Goldratt, *Critical Chain* (1997) — the method's source.
- [TOCICO Dictionary](https://cdn.ymaws.com/www.tocico.org/resource/resmgr/files-public/toc-ico_dictionary_first_edi.pdf)
  — canonical definitions: critical chain as "the longest sequence of dependent
  tasks considering both task and resource dependencies"; buffer types.
- [PMI — PMBOK and the critical chain](https://www.pmi.org/learning/library/pmbok-critical-chain-approach-4646)
  and [PMI — Critical chain buffer sizing](https://www.pmi.org/learning/library/critical-chain-project-management-theory-7118)
  (Leach's 50% cut-and-paste rule and alternatives).
- [Wikipedia — Critical chain project management](https://en.wikipedia.org/wiki/Critical_chain_project_management)
  — buffer taxonomy (project / feeding / resource) and execution-phase buffer
  management.
