---
status: accepted
date: 2026-07-22
supersedes: ""
superseded-by: ""
tags: [ui, charts, urls, auth, embed, kiosk]
---

# Poppable charts: a parameter for humans, a credentialed `/embed` for machines, one shared assembly

**Context.** Every chart-like component should have a **poppable** form — a URL
that renders it alone — for two audiences with different needs: a **digital sign
board** (a wall display left running on one program's chart, no session, wrong
theme by default) and an **agent composing a document** (wanting an image it can
place, not a screenshot). Issue #43 asked for the *decision*, not the build,
because several questions have more than one defensible answer. The binding
constraints are already in the code: the per-chart data assembly lives in the
page (`computeChainLedger` at `programs/[id]/page.tsx`, not in `ChainLedger`), so
a second entry point duplicates it and the two drift; `src/proxy.ts` redirects any
unauthenticated request to `/login`, so a board or a `curl`-ing agent gets a login
page, not a chart; `layout.tsx` reads `data-theme` from `localStorage`, which a
fresh kiosk lacks; and the charts have fixed viewBoxes built for a content column,
not a 1920×1080 wall — the widest canvas the app will ever draw into.

**Decision.**

1. **One shared server assembly per chart; two thin surfaces call it.** Extract
   the per-chart data assembly out of `programs/[id]/page.tsx` into a shared
   server function (e.g. `getChainLedgerView(id)`). The full page and every popped
   surface call it — never a second copy. This is the real work #43 named, and it
   is a precondition, not an option: a duplicated assembly *guarantees* drift.

2. **Humans pop with a query parameter; machines get one `/embed` prefix — not a
   route per chart.** A signed-in human pops a chart in place:
   `/programs/:id?pop=chain` renders that chart alone and keeps the nav (still
   navigable). This reuses the page's session and assembly and — critically —
   avoids a route explosion as the sweep below grows. The **no-session** machine
   case is a single dedicated prefix, `/embed/...` (param-driven by chart kind, one
   route family), because the session-gate exemption belongs to a clean path
   prefix, not smeared across the human page. Both render the same shared view.
   "Everything is a URL" (§2) is satisfied by both.

3. **`chrome` is a parameter, not a route: `full` | `none` | `caption`.** `full`
   (nav, the human-pop default); `none` (the chart alone, for a board); `caption`
   (chart + a one-line provenance strip — program name and an "as of" timestamp —
   for an agent embedding it in a deck, where the chart otherwise loses its
   source).

4. **The `/embed` surface satisfies all three parts of the machine-endpoint rule;
   the credential is the whole security boundary.** Per
   [the machine-endpoint finding](../knowledge/machine-endpoint-needs-exemption-and-credential.md):
   (a) add `/embed` to `isPublic` in `src/proxy.ts`; (b) it carries **its own
   credential** — a signed, scope-limited token in the URL, because a board or an
   agent cannot hold a session or complete OAuth; (c) a **rate-limit class** in
   `limitFor`. A popped chart returns real program data, so — unlike `/api/health`
   — it is *not* credential-free. The token names what it may render (this program,
   these charts) and is the entire boundary. The credential is proven the one
   correct way: request `/embed` **without** the token and assert the rejection,
   never by calling it with the token and asserting success.

5. **One mechanism, two representations.** The surface renders a **live HTML page**
   (the board case — it can refresh). The **image** case is the *same rendered
   view* serialized: `format=svg` returns the chart's own SVG (trivial — the charts
   already are SVG), `format=png` rasterizes that SVG. HTML is the default; the
   image is a serialization of the identical view, so the two products cannot
   diverge. PNG rasterization is deferred if it proves costly — SVG covers most
   embedding.

6. **Sizing follows #36: fill width, own height — no fixed pixel canvas.** Per
   [the box-model ADR](2026-07-22-containers-own-spacing-charts-own-height.md) a
   popped chart fills the viewport's inline size and the popped container sets an
   explicit height/aspect (a `w`/`h` or `aspect` param, with a board-sensible
   default). The fixed viewBoxes (the schedule's `860×246`) become `width: 100%`
   with `preserveAspectRatio`; the popped view is exactly where #36's rule and
   #42's tail-dominated axis-break bite hardest, because it is the widest canvas
   the app draws.

7. **Theme and style are explicit URL parameters.** A kiosk has no `localStorage`,
   so a popped URL states its appearance rather than silently taking the default
   (wrong for a bright wall or a dark room half the time): `theme=light|dark`,
   `style=<instrument|plain>`. `layout.tsx`'s pre-paint script reads the parameter
   when present, falling back to storage only for the in-app human pop.

8. **Freshness is a client refresh parameter, not a human.** The page is
   `force-dynamic` (each request is fresh), but a board open for a week needs
   `refresh=<seconds>` (client-side re-fetch/meta-refresh, default off) so
   "someone reloads it" is never the strategy.

**Pattern sweep — every chart-like component, marked.** The pattern is "a
chart-like component with no standalone representation." Swept
`grep -rln "<svg" src/components/*.tsx` (unchanged from the issue):

| Component | Poppable? | Reason |
|---|---|---|
| `ChainLedger` | **yes** (v1) | named starting set — the board's headline artefact |
| `PhaseTrack` | **yes** (v1) | named starting set — the phase rail |
| `ProjectStatusDashboard` / `NeedleGauge` | **yes** (v1) | named starting set — Progress & health |
| `PhaseGraph` | later | the `?graph=classic` alternative to `PhaseTrack`; ships once the rail is proven |
| `PhaseHillChart` / `PhaseHillGauge` | later | per-phase; useful on a board, but scoped after the program-level three |
| `CapacityChart` | later | ecosystem capacity — a plausible board, different data root |
| `CycleTimeScatterPlot` | later | analytics view; lower board demand |
| `PartnerProgramRows` | later | table-shaped; inherits the `DataTable`/#29 decision below |
| `NeedleHistoryList` | **no** | a log/list, not a chart — `NeedleGauge` is its poppable form |
| `RelationshipScale` | later | a scale *control*, not a standalone data chart |
| `DataTable` | **deferred to #29** | a popped table is a plausible board artefact; the column-kind work lands there first |
| Excluded, not chart-like (recorded, not silent): `AiBadge`, `KebabMenu`, `ThemeToggle`, `StyleToggle`, `SummaryToolbar`, `FeedList`, `PhaseDagEditor`, `TemplateEditor`, `SummaryPanel`, `InstrumentGauge` (a primitive inside gauges), `NeedleGaugeSvg` (the SVG primitive inside `NeedleGauge`) | — | icons/controls/primitives — no standalone data view |

**Alternatives rejected.**
- *Route-per-chart (`/programs/:id/pop/chain`)* — bookmarkable per chart, but it
  duplicates the page's data assembly (problem 1's drift) and explodes into a new
  route for every row of the sweep. The parameter carries the same URL identity
  without either cost.
- *An exemption without a credential* — the dangerous half of the machine-endpoint
  rule: everything works, and the chart is on the open internet. The token is
  non-negotiable.
- *A separate image service* — a second renderer of the same charts, guaranteed to
  drift from the HTML. Serializing the one rendered view keeps them identical.
- *`aspect-ratio` to fit the board* — rejected by #36 for the same reason it was
  there: it re-introduces a fractional height and makes a wide chart tall on a
  portrait board.
- *Inherit the kiosk's default theme* — silently wrong half the time; the URL must
  carry it.

**Consequences.** The shared-assembly extraction (decision 1) is the first
implementation step and unblocks the rest. The `/embed` credential is a new secret
+ proxy exemption + rate-limit class, landing together in one PR and verified by a
no-token rejection test (the finding's rule). Implementation — the extraction, the
`?pop=`/`/embed` surfaces for the v1 three, the token, and the board-resolution
both-theme screenshot the acceptance calls for — is filed as its own issue; this
record is the decision it builds to. As the sweep's "later" rows ship, they add a
parameter value, never a route.

**Receipts.** Issue #43. Data assembly: `computeChainLedger` in
`src/app/programs/[id]/page.tsx`. Auth pattern:
`docs/knowledge/machine-endpoint-needs-exemption-and-credential.md`,
`src/proxy.ts` `isPublic`/`limitFor`, `/api/cron` (`CRON_SECRET`) as the token
model. Sizing: [box-model ADR](2026-07-22-containers-own-spacing-charts-own-height.md)
and issues #36/#42. Sweep: `grep -rln "<svg" src/components/*.tsx` at record time.
