# AutoKnow UI/UX Design System & Product Principles

This document defines the core product design decisions, graphic presentation standards, and UI/UX interaction patterns for the AutoKnow project. All developers and agents modifying the codebase must strictly adhere to these patterns.

---

## 1. Edward Tufte Data-Ink Principles
To maximize readability and ensure a clean, distraction-free environment:
* **No Excess Borders**: Do not use heavy borders, drop shadows, or background wrappers around page sections, cards, or lists. All standard cards/panels must be transparent and borderless.
* **Separated Filter Bars**: The only exception to the border rule is the **Filter Bar** concept. Controls, status gauges, search inputs, and sliders must be grouped inside a dedicated card styled with a cream background (`var(--surface)`), thin solid border, and rounded corners to separate them visually from database reports.
* **Minimalist Tables**:
  * Tables must have generous breathing room (`padding: 14px 18px !important` on cells).
  * Use only thin horizontal rules (`border-bottom: 1px solid var(--border)`).
  * Never use vertical lines or solid background highlights behind headers.

---

## 2. "Everything is a URL" Navigation Pattern
Every entity displayed in a dashboard view or detail card must serve as an active navigation affordance:
* **Hyperlinked Names**: Partner names, OEM names, Supplier lists, and owner LDAP emails must always be links leading to their respective detail pages (e.g. `/partners/[id]`, `/people/[ldap]`).
* **Interactive Cells**: Count fields (e.g. "Active Programs") must link to pre-filtered lists (e.g., `/partners/[id]?filter=active`). Action phase names must link directly to the history logs of the project detail view.
* **No Plain-Text Dead Ends**: Sighted users must never be presented with static, non-clickable entity names when a corresponding detail route is available in the application.

---

## 3. Non-Gameable Visual-Only Status Gauges
* **No Percentages or Category Labels in Editors**: The overall health gauge (The Needle) and progress chart (Hill Chart) must **never** display numeric percentages (no `%` symbols or strings like `31% Done`) or text labels (like `Critical Risk`) inside the update dialog views.
* **Visual-Only Affordances**: The only visual affordance to update these values is direct graphical dragging on the SVG visual chord curve itself (dragging the needle pointer or the progress dot).
* **Pointer Capture API**: Dragging must utilize `setPointerCapture` to ensure smooth tracking even if the cursor leaves the boundary of the SVG elements.
* **Hidden Range Bindings**: Keep hidden range input controls (`#needleSlider` and `#progressSlider`) positioned off-screen to retain 100% compatibility with E2E automation tests without introducing visual noise to users.

---

## 4. Reusable 2-Column Sidebar Layouts
For detail pages (like Project details or Partner details):
* **Sidebar (Left Column)**: 320px wide. Contains compact overall status widgets (Needle and Hill Chart progress visualizers), primary metadata grid properties (TEL, SOP targets, volumes), and action managers.
* **Content Area (Right Column)**: Occupies the remaining horizontal space. Displays long lists, action items grids, visual timeline flows, and update logs.
* **Space Efficiency**: This prevents massive empty areas and keeps critical timeline indicators visible on standard screens.

---

## 5. Phase Management Lifecycle
Every project detail page must include a direct way to see, edit, add, or delete phases inside the sidebar:
* **Add Phase**: An explicit "Add Phase" button opening a `<dialog>` for inputting names and duration.
* **Edit Phase**: Prefilled edit controls inside a dialog.
* **Delete Phase**: Forms calling server actions to clean up associated log histories, dependencies, and tasks with confirmation.

---

## 6. Tables & Lists — the one grammar

Applies to every tabular/list surface (Programs, Partners, Sources, Me, ecosystem
tables) so nothing has to be relearned page to page.

* **One type grammar**: 13–14px cell text in the foreground color; links are quiet
  (foreground text, **weight 400 app-wide** — color/underline is the affordance,
  weight stays reserved for hierarchy; underline on hover, never bold green); no
  background-color badges. Semantic color (health) is colored *text* only. Muted gray is reserved
  for secondary facts (types, provenance, dates' fallbacks).
* **Dates are ISO** (`yyyy-mm-dd`, tabular-nums, via the shared `DateCell`), which
  sorts lexicographically = chronologically; hover reveals the ISO calendar week
  ("W29"). Never locale-formatted dates in table cells — they misalign and
  mis-sort.
* **Header click sorts. Filtering is a secondary, per-column action**: a small
  three-line funnel icon beside the label opens a checklist of that column's
  distinct values. Selections within a column are OR-ed ("Concerned" *and* "On
  Track"), columns are AND-ed together. An active funnel shows an accent color and
  a count. No standalone filter bars — a single compact free-text search input is
  the only filter allowed outside the table, and page-level deep links
  (`?minRisk=…`, `?filter=active`) initialize column filters rather than adding
  widgets.
* **One measure per cell**: a value gets exactly one visual rendering (a face, a
  number, a bar — never a face *plus* the number *plus* a word). The redundant
  forms live in the tooltip/accessible name.
* Implementation home: `src/components/DataTable.tsx` (sort, pagination, column
  filters) + `DateCell`. New tables must use them rather than re-implementing.

---

## 7. Information density & scanning

The test for every block: could a human scan it top-to-bottom without their eyes
stopping on empty space? Rules:

* **Label:value pairs live on ONE line** — small-caps label left, value right (or
  inline) — never stacked, except when the value is multi-line prose.
* **Icon + fact + action cluster horizontally**: a status glyph, its date, and its
  action button form one row (e.g. face · "Updated Jun 30" · Update), never a
  three-line stack.
* **Vertical rhythm scale**: ~14px between sibling blocks, ~7px between rows
  inside a block. Page headers are one line of title + one hairline, ≤ ~26px tall.
* **Separation hierarchy — one mechanism per boundary, never stacked**:
  1. *Rows within a block*: whitespace only (~7px). No rules.
  2. *Sibling blocks in a column*: ONE hairline **between** them
     (`.block + .block { border-top }`), never above the first — the page
     header's rule already bounds the column.
  3. *A block that needs naming*: the heading **is** the separator. A headed
     block gets no border-top of its own and the heading gets no underline —
     heading + spacing does all the work. Either a rule or a heading, never
     both.
  4. *Page level*: the title hairline is the only full-width rule.
  If two horizontal lines are ever visible with nothing between them, one of
  these levels is being double-applied.
* **Few titles**: a sidebar gets at most one heading; groups of facts flow in one
  list rather than one titled section each. If a heading merely restates what the
  content obviously is, delete it.
* **Prose is the exception**: summaries and notes get comfortable line-height and
  width; facts get density.

## 8. Machine vs. human provenance

Readers must never wonder whether a model or a person wrote what they're reading.
One treatment, applied app-wide via the `AiBadge` component:

* **LLM-written text carries the ✦ AI mark** adjacent to its first line: the AI
  briefings (SummaryPanel provenance row) and every ingested-content digest or
  update delta in feeds. The mark is a quiet ink chip (`--muted`, hairline pill)
  — the ✦ sparkle is the identifier, deliberately hueless because every color in
  the palette already carries a meaning (health, chain, feed kinds) and
  provenance is a fact, not a verdict. Its hover title spells out the rule.
* **Human-written text is never marked.** Its provenance is author attribution
  ("by dylan", "by seed") — absence of the sparkle means a person typed it.
* Machine-*derived* values that aren't prose (embeddings, inferred anchors,
  derived health) don't get the mark; it flags authorship of words, not
  computation.
