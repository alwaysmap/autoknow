# AutoKnow — Component & Page Specification

Status: **Largely implemented** (SummaryPanel and the component inventory ship
in the app); kept as the reference for what each component is *for* and the
decision-first method behind it.

**Method:** decision-first. Each component and page declares *the single decision it drives*, *for whom*, *in what context*. The **data it requires is reverse-engineered from that decision** and tagged by tier. The union of those data requirements (§5) is the backlog for the ingestion / SoR / AI engine.

> Actionable first, attractive second. A component earns its place only if it changes an action in the context where that action is taken. Data is the byproduct, never the point.

---

## 1. Data tiers (the legend used everywhere below)

| Tag | Tier | Source of truth | Examples |
|---|---|---|---|
| **[SoR]** | 1 — AutoKnow owns it | AutoKnow DB | Phase lifecycle & completion, program metadata (SOP, volume, owner), the relationship graph (partner↔partner, partner↔program, partner↔Googler) |
| **[ING]** | 2 — External system of record, ingested | Chat, Google Docs, Gerrit, Buganizer | Status messages, meeting notes, review threads, bug state — recorded as searchable (pgvector) records |
| **[DER]** | 3 — Derived | Computed from [SoR] history | Cycle time, throughput, SOP-vs-forecast slip, vehicle-volume-at-risk |
| **[AI]** | 4 — Inferred (the goal) | LLM/RAG over [SoR]+[ING] | "This looks stuck," proposed needle, discussion-topic digest, decision-pending detection, relationship rollups |

**Design rule:** [SoR] entry stays minimal — humans enter only what only humans know. Everything narrative is [ING]. The elaborate UI belongs to [AI].

---

## 2. Component specs

Template — **Decision** · **MUST** (one thing) · **COULD** (extras) · **Data required** (tiered) · **Context** · **Excluded from**.

### 2.1 `StatusSignal` (the Needle, reframed)
- **Decision:** does this entity need intervention *now*?
- **MUST:** render a scoped, labeled triage state (program health / phase risk / relationship) — visually distinct per scope so two scopes can never be confused (the Qualcomm screenshot bug).
- **COULD:** trend arrow (improving/worsening); click → the evidence that explains it.
- **Data required:**
  - [SoR] current needle value + scope + target id (human override).
  - [AI] *proposed* needle inferred from recent [ING] context (the primary input going forward).
  - [DER] days-in-state, for trend.
- **Context:** anywhere an entity is triaged. **Excluded:** as a filter control (a filter is not a status).

### 2.2 `CriticalChainStepper` + `ChainStep`
- **Decision:** where are we, what's the current constraint, and what's the next action?
- **MUST:** condensed horizontal chain showing each phase's completion state; current/blocked step emphasized; each step is a control that scopes the rest of the page (action items, decisions, activity) to that phase. Expands on navigation for detail.
- **COULD:** dependency (DAG) highlight of the gating phase; delay-vs-forecast per step; AI "stuck" marker on the constraining step.
- **Data required:**
  - [SoR] phases, ordering, dependencies (`PhaseDependency`), per-phase latest state (status, completion).
  - [DER] elapsed vs forecast per phase; which phase is the active constraint.
  - [ING] count/recency of context attached to each phase (so a step can show "9 days, 3 recent messages").
  - [AI] stuck/at-risk classification + one-line why, per step.
- **Context:** ~~Project (full)~~ **superseded on Project by `PhaseGraph` (§2.13)**. Condensed read-only variant survives on Me and on partner program cards.

### 2.3 `ActionHistory` (ingested context stream + search)
- **Decision:** what actually happened, and what decision is now open?
- **MUST:** a summarized, reverse-chronological stream of ingested context scoped to a phase/project/partner, each item linking to its external source; searchable (pgvector).
- **COULD:** filter to the selected chain step; filter to "decision needed"; group by source system.
- **Data required:**
  - [ING] ingested records (`ContextUrl`-like): text, source type, source URL, timestamp, embedding; **attached to the right phase/project/partner** by the ingestion classifier.
  - [AI] per-item one-line summary; "open decision" extraction; semantic search ranking.
- **Context:** Project, Phase, Partner, Person. **Excluded:** Ecosystem (too granular).

### 2.4 `InsightCard` (AI guidance — flagship)
- **Decision:** what should I do about this, right now?
- **MUST:** a plain-language call — *"This looks stuck"* / *"This SOP is slipping"* — with **cited evidence** (links to the [ING] records and [DER] metrics it reasoned from) and a recommended next action.
- **COULD:** confidence; dismiss/snooze; "draft the follow-up" action; escalate to owner.
- **Data required:**
  - [AI] the inference itself.
  - [ING] the cited evidence records.
  - [DER] the supporting metric (e.g. days-blocked, slip days).
  - [SoR] the entity + owner to route the action to.
- **Context:** every level at its own granularity — phase, project, and an ecosystem rollup. This component is why the others exist.

### 2.5 `DiscussionDigest` (the exec-prep use case)
- **Decision (exec before a partner meeting):** what should I talk about — which may *not* match program status?
- **MUST:** for a given partner over a time window, the **key discussion topics** synthesized from ingested meeting notes/threads — independent of program state.
- **COULD:** topic trend over time; unresolved questions raised by the partner; topics raised by us but not answered; sentiment shift.
- **Data required:**
  - [ING] **Google Doc meeting notes ingested over months** (NEW feed), chat threads, scoped to the partner.
  - [AI] topic extraction + clustering across the window; per-topic summary + recency; "open question" detection.
  - [SoR] partner identity + the Googlers/programs involved (to attribute topics).
- **Context:** Partner detail (exec view), and a pre-meeting briefing surface. **Note:** deliberately *orthogonal* to program status — it's a different lens over the same ingested corpus.

### 2.6 `EntityTable` (infrastructure)
- **Decision:** which item in this list needs me first?
- **MUST:** scannable, **default-sorted by the decision column** (risk, SOP slip, days-blocked) — never by name; rows expand for detail.
- **COULD:** inline row actions; saved sorts.
- **Data required:** [SoR]/[DER] the rows + the decision-relevant sort key per use. Typed column model (no per-screen `any`).
- **Context:** any list. **Excluded:** as a dumping ground for "all rows" with no decision sort.

### 2.7 `FlowChart` (SOP → vehicle volume) — ecosystem hero
- **Decision (leadership):** are we putting vehicle volume into market on time, and what threatens it?
- **MUST:** continuous flow of programs along their SOP dates against cumulative shipping volume — the market-outcome signal.
- **COULD:** overlay at-risk programs; a "volume in jeopardy" line; click a program → its chain.
- **Data required:**
  - [SoR] per-program SOP date, first-year volume, partner.
  - [DER] cumulative volume curve; volume-at-risk (programs whose state threatens their SOP).
  - [AI] which programs are likely to slip (feeds the at-risk overlay).
- **Context:** Ecosystem.

### 2.8 `ConstraintView` (cycle time / throughput)
- **Decision (leadership):** which phase is the systemic bottleneck across the portfolio?
- **MUST:** the slowest stage(s) by real cycle-time distribution — one truth (merge today's fabricated "Flow Constraint Diagnosis" with the real cycle-time data).
- **COULD:** trend over quarters; per-partner breakdown.
- **Data required:** [DER] cycle time per phase-name from `PhaseState` history; throughput; percentiles. [AI] narrative ("Compliance Testing is your constraint; here's why").
- **Context:** Ecosystem.

### 2.9 `RelationshipPanel`
- **Decision:** is this relationship healthy, and who/what rides on it?
- **MUST:** relationship `StatusSignal` + dependent programs + key contacts (Googlers + partner people), above the fold.
- **COULD:** partner↔partner links (supplier↔OEM); AI at-risk rollup from child programs.
- **Data required:** [SoR] relationship graph, contacts, dependent programs. [AI] rollup of child-program stuck signals. [ING] recency of partner contact.
- **Context:** Partner detail.

### 2.10 Supporting atoms
- `EntityHeader` — name + type + the *correct, labeled* primary `StatusSignal` + primary action. [SoR].
- `MetricStat` / `MetricStrip` — compact above-the-fold numbers; default to decision-relevant metrics only. [DER].
- `SearchToGo` (global search) — jump to the entity I must act on. [SoR]+[ING] (semantic).
- `StatusCapture` / `MetadataEdit` / `PhaseEdit` dialogs — **minimal** [SoR] entry; the mandatory note is the *decision record*. Resist adding fields.
- `EntityLink` — the "everything is a URL" link; one implementation.

### 2.11 Cut
- `ProgramsTable` (orphan), the duplicate ecosystem clients (merge), hill/needle math ×4 (→ `lib/geometry.ts`).

### 2.12 `ProgramBrief` (Gemini program summary — first shipped Tier-4 feature)
- **Decision:** what changed on this program, and what needs my attention — *without reading the feed?* For the program owner (daily standup lens) and any exec dropping in cold.
- **MUST:**
  - A generated brief with fixed sections: **TL;DR** (2–3 sentences) · **Health & trajectory** (needle now vs. previous, direction of travel) · **Risks** · **Decisions made / pending** · **Next steps** · **Partner activity**.
  - **Cited evidence per bullet** — every claim links to the in-app record it came from (`/history/project/{id}`, `/history/phase/{id}`, or the `ContextUrl` source link). "Everything is a URL."
  - Provenance line — *"Generated {date} by Gemini · from {n} updates"* — plus a staleness cue whenever underlying data is newer than the brief.
  - An **UPDATE-style regenerate button** (same visual grammar as the needle/hill cards) for on-demand refresh.
  - Honest degradation: when `geminiConfigured === false` (no `GEMINI_API_KEY`), render an empty state that says so — never fake a synthesis.
  - **Never hits original sources.** Inputs are only what AutoKnow already stores: SoR state rows + previously ingested digests (`ContextUrl.ingestedText`). No re-fetch of Docs/Chat/Gerrit at generation time — satisfied by construction.
- **COULD:** week-over-week diff vs. the previous brief; "what changed since last brief" mode; brief history list (reuse the `NeedleHistoryList` card layout); a `brief` FeedKind so briefs land in the Activity feed with their own filter chip; embed the brief text (768-dim) so unified search finds it.
- **Data required:**
  - [AI] the synthesis itself (**NEW**): `gemini-2.5-flash` + `responseSchema` structured JSON — same call pattern and graceful-fallback convention as `summarizeDocument` in `lib/gemini.ts`.
  - [SoR] needle history (`getNeedleHistory`, `lib/history.ts`); per-phase hill history (`getHillHistory`); open `ActionItem`s; program metadata (owner, partner, SOP).
  - [ING] `ContextUrl.ingestedText` digests scoped to the program — already-distilled text only.
  - [DER] the input window (since last brief, else trailing 14 days); stagnation signals (`isStagnant`); update counts per source (feeds the provenance line).
- **Context:** Project detail, **above the fold on every program page**, side-by-side with the program gauge (`StatusSignal`/needle) and the phases hill chart — the three together are the program's opening read: *the numbers* (gauge + hill) and *the words* (brief). 2-column grid per design.md; the brief takes the wide column, the gauge + hill charts stack beside it. Ecosystem rollup is explicitly **out of scope** for v1 (that's `InsightCard`'s job).
- **Excluded from:** dashboards/tables (too heavy); partner page (that's `DiscussionDigest`'s lens).

**Engine notes (storage · pipeline · triggers):**
- **Storage — new Prisma model `ProgramBrief`, append-only** (one row per generation, like `ProjectState`): `id, projectId → Project, generatedAt, trigger ('scheduled' | 'manual'), model, windowStart, windowEnd, tldr (String), body (Json — sections as arrays of {text, citations: [{label, href}]}), sourceCounts (Json), embedding vector(768) (COULD)`. Append-only enables the diff/history COULDs and feed integration. Precedents: `ProjectState` for the history pattern; `ContextUrl`'s raw-SQL insert for the optional embedding.
- **Pipeline — `generateProgramBrief(projectId)`** (thin orchestrator in `lib/brief.ts`, Gemini call in `lib/gemini.ts`): gather the tiered inputs above → one `generateContent` call with `responseSchema` → persist the row. Prompt persona mirrors the analyst persona in `summarizeDocument`; instructions: cite only the provided records (by their supplied hrefs), flag stagnation, write for a Googler exec.
- **Triggers:**
  - *On demand:* `POST /api/projects/[id]/brief` (route conventions of `api/projects/[id]/needle/route.ts` — params validation → `jsonError`, try/catch → `serverError`), or a server action behind the card's regenerate button.
  - *Daily:* `POST /api/admin/briefs` — batch-generates for every non-archived program **with new activity since its last brief** (skip-unchanged keeps the run cheap); guarded by `adminOperationsAllowed` (mirrors `api/admin/reindex`). No cron infra exists in-repo — an external scheduler (Cloud Scheduler / launchd / GitHub Actions cron) invokes the endpoint.

### 2.13 `PhaseGraph` (vertical phase rail — phases-as-a-graph, chain-first)
- **Decision:** what is the shape of this program's remaining work — which phases are live, what gates what, where is the constraint — in one glance, on any screen.
- **Visual:** a **vertical tube-map / git-graph** of the phase DAG (`PhaseDependency`). A rail runs down the left; lanes indent by dependency depth. **Edges are rectilinear** — 90° jogs with small corner radii, never bezier curves — so merges and branches read like a transit map. One **node per phase**, filled with the **phase's own color** (`phaseColor`); the **critical chain** (longest remaining-duration path: `forecastedDuration × (100 − progress)/100` summed over the DAG, `lib/criticalChain.ts`) is the visualization's spine — **heavier edges**, **ringed nodes**, an amber **Constraint** tag on the first unfinished chain phase, and a one-line chain summary above the rail (names joined by →, ≈days remaining). Tufte: no per-row boxes, the rail is the structure. **Fully vertical and phone-friendly** — expanded row bodies stack on narrow screens; the page grid collapses to one column under 900px.
- **MUST:**
  - **Three row appearances, cycled by tapping the row header** — *collapsed* (one quiet line: node, name, status, date), *minimal* (the default: + mini hill with UPDATE and the latest note, clamped, partners as links), *expanded* (+ full markdown note, editable partner chips, editable dependencies, remove phase). **Done phases default to collapsed**; links/buttons inside the header don't trigger the cycle.
  - **Dependencies visible on the rail and actionable in the expanded row**: an "After" list (upstream) and an "Enables" list (downstream), each entry a chip that **jumps to and flashes** the related row; add via a quiet select (options exclude self and anything that would cycle), remove per chip. The server **rejects cycles** and duplicates; the row shows the rejection inline.
  - **Add / remove phases inline**: add-phase at the rail's end with an optional **"after X"** dependency; removal is *entire* (phase + states + links), confirmed.
  - Derived status only (Not Started / In Progress / Done from progress); no numeric progress anywhere — the hill position, status word, and chain days carry it.
- **COULD:** drag-to-reorder lanes; stagnation cue on the row; ingested-context count per phase; AI stuck marker on the constraint node.
- **Data required:**
  - [SoR] phases + `PhaseDependency` DAG with per-edge ids (add/remove); latest + previous `PhaseState`; `forecastedDuration`; `PhasePartner` links (all exist).
  - [DER] **critical chain** — longest remaining-duration path + current constraint (`lib/criticalChain.ts`); derived status (`hillStatus`); per-phase color (`phaseColor`); lane layout; row-state defaults.
  - [AI] the chain feeds a `chain` evidence record into the `ProgramBrief` generator (§2.12) so risks/next-steps reason about the constraint.
- **Context:** Project detail, the main phase surface — **supersedes `CriticalChainStepper` (§2.2) entirely**: the chain now lives on the rail itself.
- **Excluded from:** ecosystem/dashboards (a program-internal view); anywhere a single summary dot-on-hill suffices (that's the aggregate hill chart card).

---

## 3. Page specs (compose components per context + decision)

Template — **Who** · **The decision** · **Above the fold** · **Components (in order)** · **Data feeds** · **Excluded**.

### 3.1 Ecosystem (`/`, `/ecosystem-summary` → merged)
- **Who:** leadership. **Decision:** is volume reaching market on time, and where is flow constrained?
- **Above the fold:** `FlowChart` (SOP→volume) + an ecosystem `InsightCard` rollup ("3 programs threaten Q3 volume").
- **Order:** InsightCard rollup → FlowChart → ConstraintView → EntityTable of *at-risk* programs (sorted by slip risk).
- **Data feeds:** [SoR] program metadata; [DER] volume-at-risk, cycle time; [AI] slip prediction, constraint narrative.
- **Excluded:** action-item lists (noise here); generic "all programs" dumps.

### 3.2 Project detail (`/projects/[id]`)
- **Who:** TEL/owner. **Decision:** where are we, what's blocking the constraint, what's next?
- **Above the fold:** `ProgramBrief` side-by-side with the program gauge (`StatusSignal`/needle) and the phases hill chart — words next to numbers, one opening read. `EntityHeader` above.
- **Order:** Header → [`ProgramBrief` | gauge + hill charts] (the above-the-fold pair) → `PhaseGraph` (vertical rail; drives selection) → `InsightCard` (per project/phase) → filtered `ActionHistory` + open decisions for the selected phase → minimal `StatusCapture`.
- **Data feeds:** [SoR] phases/states/metadata; [ING] context per phase; [DER] cycle/slip; [AI] program brief synthesis, stuck detection + proposed needle.
- **Excluded:** ecosystem metrics; unrelated programs.

### 3.3 Me (`/me`)
- **Who:** individual Googler. **Decision:** what is mine to move today?
- **Above the fold:** my open action items + decisions awaiting me, sorted by what's blocking flow.
- **Order:** `InsightCard` ("2 of your phases look stuck") → my action items (`EntityTable`) → my programs (condensed `CriticalChainStepper` per program) → my partners.
- **Data feeds:** [SoR] assignments, owned programs; [ING] context mentioning me; [AI] my-stuck rollup.
- **Excluded:** portfolio-wide flow.

### 3.4 Partner detail (`/partners/[id]`) — two lenses
- **Who:** relationship owner **and** exec prepping a meeting. **Decisions:** (a) is this relationship healthy + who/what rides on it; (b) what should I discuss next meeting?
- **Above the fold:** `EntityHeader` (clearly labeled **Relationship** StatusSignal) + `RelationshipPanel` (programs + contacts). Key details (phone/website/region) promoted up, not exiled to a far rail.
- **Order:** Header → RelationshipPanel → `DiscussionDigest` (exec lens, time-windowed) → dependent programs (`EntityTable`) → `ActionHistory` for the partner.
- **Data feeds:** [SoR] relationship graph, contacts; [ING] **meeting-notes ingestion**, chat; [AI] discussion topics, at-risk rollup.
- **Excluded:** the dead center band; conflating relationship needle with program needle.

### 3.5 Person detail (`/people/[id]`)
- **Who:** anyone evaluating a contact. **Decision:** what has this person owned/decided, and where are they now?
- **Order:** `EntityHeader` → career/affiliation timeline → `ActionHistory` of their decisions (grouped by tenure).
- **Data feeds:** [SoR] person + affiliations; [ING] context attributed to them.

### 3.6 Search (`/search`)
- **Who:** anyone. **Decision:** jump to the entity I must act on. Semantic + literal over [SoR]+[ING].

---

## 4. Reverse-engineered data requirements (the engine backlog)

The union of every "Data required" above. **This is what must exist for the UI to mean anything.**

**Tier 1 — System of record (mostly exists):**
- Phase lifecycle, completion, dependencies (DAG); program metadata (SOP, volume, owner); relationship graph (partner↔partner, partner↔program, partner↔Googler). Minimal capture UI.
- `ProgramBrief` append-only table — persisted generations of the program brief *(NEW)*.
- Per-phase partner attribution (phase↔partner link) — feeds `PhaseGraph` rows and the partner page's owned/involved program summaries *(exists — `PhasePartner`)*.

**Tier 2 — Ingestion feeds (partially exists):**
- Chat ingestion + classification → attach to correct phase/project/partner *(exists, naive)*.
- **Google Docs meeting-notes ingestion over time** *(NEW — required by `DiscussionDigest`)*.
- Gerrit / Buganizer state ingestion *(NEW — feeds chain "stuck" evidence)*.
- All ingested records carry: text, source type, source URL, timestamp, **real embedding**, entity attachment.

**Tier 3 — Derived (partially exists, some fabricated):**
- Cycle time & throughput per phase-name from state history *(exists)*.
- **Critical chain** — longest remaining-duration path over the phase DAG (`forecastedDuration × remaining progress`), plus the current constraint phase → drives `PhaseGraph` emphasis and a `ProgramBrief` evidence record *(exists — `lib/criticalChain.ts`)*.
- SOP-vs-forecast slip; cumulative vehicle volume; volume-at-risk *(NEW/real)*.
- Replace fabricated p85 and hardcoded constraint panel with computed truth *(done for p85; constraint panel still hardcoded)*.

**Tier 4 — AI (the product — mostly missing):**
- **Real semantic embeddings** (today: deterministic `Math.sin` fake).
- **Program brief synthesis** — daily/on-demand per-program rollup of needle + hill + ingested digests with cited evidence → `ProgramBrief` *(NEW — first shipped Tier-4 feature)*.
- **Stuck/at-risk detection** with cited evidence → `InsightCard`, chain markers.
- **Proposed needle inference** from ingested context → `StatusSignal` default.
- **Discussion-topic extraction & summarization** over a time window per partner → `DiscussionDigest`.
- **Open-decision detection** from ingested threads → ActionHistory + Me.
- **Slip prediction** per program → FlowChart overlay.
- **Relationship at-risk rollup** from child programs → RelationshipPanel.

---

## 5. Build sequence

1. **Foundation:** `tokens.css`, layout primitives, `lib/geometry.ts` (kill ×4 duplication), Tufte density pass.
2. **SoR surfaces (minimal entry):** `EntityHeader`, `StatusSignal` (scoped), `PhaseGraph` (vertical rail; supersedes the full `CriticalChainStepper`), `RelationshipPanel`, minimal capture dialogs.
3. **Ingestion + context:** real embeddings; Google-Docs + Gerrit/Buganizer feeds; `ActionHistory` with semantic search.
4. **AI layer (the goal):** `ProgramBrief` first — the cheapest real synthesis (one entity scope, every input already exists) — then `InsightCard`, proposed-needle inference, `DiscussionDigest`, stuck/slip detection — built on 2+3.
5. **Recompose pages:** Ecosystem (FlowChart-led), Project (Stepper-led), Me, Partner (two lenses).

The structured app is **scaffolding for the intelligence layer.** Tiers 1–3 make the data exist and trustworthy; Tier 4 is the product. Build bottom-up, but never lose that the `InsightCard` and `DiscussionDigest` are the reason the rest is here.
