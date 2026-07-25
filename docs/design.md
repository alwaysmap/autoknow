# AutoKnow UI/UX Design System & Product Principles

This document defines the core product design decisions, graphic presentation standards, and UI/UX interaction patterns for the AutoKnow project. All developers and agents modifying the codebase must strictly adhere to these patterns.

---

## 1. Edward Tufte Data-Ink Principles
To maximize readability and ensure a clean, distraction-free environment:
* **No Excess Borders**: Do not use heavy borders, drop shadows, or background wrappers around page sections, cards, or lists. All standard cards/panels must be transparent and borderless.
* **Separated Filter Bars**: The only exception to the border rule is the **Filter Bar** concept. Controls, status gauges, search inputs, and sliders must be grouped inside a dedicated card styled with a cream background (`var(--surface)`), thin solid border, and rounded corners to separate them visually from database reports.
* **Minimalist Tables**:
  * Tables must have generous breathing room (`padding: 0.875rem 1.125rem !important` on cells — 14/18px equivalent; rem-first per §9).
  * Use only thin horizontal rules (`border-bottom: 1px solid var(--border)`).
  * Never use vertical lines or solid background highlights behind headers.

---

## 2. "Everything is a URL" Navigation Pattern
* **Sections own their deep link**: every `<h2>` renders through
  `AnchorHeading` — hovering (or tabbing to) the heading reveals a quiet `#`
  beside it, and clicking it puts the section anchor in the address bar to
  share. No standing "on this page" nav rows. The id is passed explicitly and
  is never derived from the heading text: headings are localized, so a
  slugified anchor would differ per locale and break links already shared. The
  `#` link is a SIBLING of the heading, never a child — nested, its text joins
  the heading's accessible name.
Every entity displayed in a dashboard view or detail card must serve as an active navigation affordance:
* **Hyperlinked Names**: Partner names, OEM names, Supplier lists and program owners must
  always be links leading to their respective detail pages (`/partners/[id]`,
  `/people/[id]`). **A person is written by NAME, never by their LDAP email**
  (2026-07-25, issue #153 — this line used to say "owner LDAP emails", which sanctioned
  the label the app actually shipped: `/partners` printed
  `marcusw@google.com, dylan@google.com` in one column and `Marcus Webb` in the next).
  The affordance is unchanged; only the visible text moved from the storage format to
  the reading format. An email is a person's ADDRESS, not their name, so it appears only
  where the address is the point — `/people`'s Email column, which is a `mailto:`.
  One implementation: **`PersonCell`** (`src/components/PersonCell.tsx`) owns the name,
  the route (via `personHref`) and the plain-text fallback, so a call site cannot get
  half of it right. Enforced by `tests/dataTableConvention.test.ts`.
* **Interactive Cells**: Count fields (e.g. "Active Programs") must link to pre-filtered lists (e.g., `/partners/[id]?filter=active`). Phase names must link to that phase's record — `/programs/[id]#phase-[phaseId]-detail`, the DETAILS popover (§5).
* **No Plain-Text Dead Ends**: Sighted users must never be presented with static, non-clickable entity names when a corresponding detail route is available in the application.

---

## 2b. `/` is a landing page; the dashboard lives at `/ecosystem`
(2026-07-20, user call.) The root route is **not** a dashboard. Its one job is to
get you to the thing you came for:

* **A big search box is the primary affordance** — the largest control in the app,
  autofocused, and the only place `hero`-sized styling is sanctioned
  (`UnifiedSearch` takes a `hero` prop). It deep-links: `/?q=…` runs the query on
  load, and `/search?q=…` redirects here so older shared links keep working.
  **It is the whole control — there is no submit button beside it** (2026-07-22,
  user call): Enter and the suggestion panel's "see all results" row commit, and
  the app's own gauge sits at the field's trailing edge reporting whether a query
  is in flight (§8c).
* **It suggests while you type, and hands off to the full list.** Hero mode adds a
  debounced autosuggest panel (top 8, overlaying rather than pushing the page
  down) with a "see all results" row that runs the real search into the same
  `UnifiedSearch` + `FeedList` below. One component, two depths — never a second
  search implementation. Type-filter chips wait for results: filled chips under an
  empty box are loud and filter nothing.
* **Under it, the five most recent updates as teasers** — ingested documents and
  human-written notes alike, from the same `getActivity` feed the rest of the app
  uses. Title, provenance, two clamped lines of the actual words. Teasers are
  `LatestTeasers`, deliberately NOT `FeedList`: the feed renders gauges, hill
  charts, and delete controls, which is the full record, not an invitation.
* **The ecosystem dashboard is `/ecosystem`** and the nav points there.
* **No search box in the nav, on any page.** One search surface, and it is the
  page you land on. (This retired the global `/` focus shortcut with it.)

---

## 3. Non-Gameable Visual-Only Status Gauges
* **No Percentages or Category Labels in Editors**: The overall health gauge (The Needle) and progress chart (Hill Chart) must **never** display numeric percentages (no `%` symbols or strings like `31% Done`) or text labels (like `Critical Risk`) inside the update dialog views.
* **Visual-Only Affordances**: The only visual affordance to update these values is direct graphical dragging on the SVG visual chord curve itself (dragging the needle pointer or the progress dot).
* **Pointer Capture API**: Dragging must utilize `setPointerCapture` to ensure smooth tracking even if the cursor leaves the boundary of the SVG elements.
* **Hidden Range Bindings**: Keep hidden range input controls (`#needleSlider` and `#progressSlider`) positioned off-screen to retain 100% compatibility with E2E automation tests without introducing visual noise to users.

---

## 4. Reusable 2-Column Sidebar Layouts
**Exception — program detail pages (2026-07-20, user call):** `/programs/[id]`
opens with a quick-links anchor row, then ONE two-column row — the Needle
(20rem) beside the AI briefing — and everything from the Critical Chain section
down (chain, phase rail, activity) spans the full width of both columns.

For other detail pages (like Partner details):
* **Sidebar (Left Column)**: 20rem (320px) wide. Contains compact overall status widgets (Needle and Hill Chart progress visualizers), primary metadata grid properties (TEL, SOP targets, volumes), and action managers.
* **Content Area (Right Column)**: Occupies the remaining horizontal space. Displays long lists, action items grids, visual timeline flows, and update logs.
* **Space Efficiency**: This prevents massive empty areas and keeps critical timeline indicators visible on standard screens.

---

## 4b. Status updates: the gauge states a fact, the popup holds the record
Program health (the Needle) follows one pattern, and new status surfaces should
copy it (2026-07-20, user call):
* The resting row is **graphic · date · DETAIL** — no note text beside the
  gauge. Every update REQUIRES a written note (dialog gate + `zText` at the
  mutation boundary), but that prose feeds the AI briefing and the log, not the
  card.
* **DETAIL** opens a popup covering most of the viewport listing every update
  with its graphic, health label, author, timestamp, and full note. Body scroll
  locks while it is open; the log scrolls inside it.
* **UPDATE inside that popup reveals the form in place** (save/cancel), never a
  second `<dialog>` — stacked modals layer their scrims and trap focus in the
  wrong layer. The health picker sits inside the gauge's own container, since
  picking a value repaints the gauge directly above it.
* The open popup is a URL: `/programs/:id#status-history` opens it, and opening
  it writes that hash. There is no separate history *page* for needles — and as
  of 2026-07-21 none for phases either (§5), so `/history/**` is gone entirely.

Two `<dialog>` traps this pattern hit, worth knowing before writing another:
`display: flex` on the dialog overrides the UA's `display: none` for the CLOSED
state, leaving an invisible full-size overlay that swallows clicks — scope it to
`[open]`. And a click on the dialog's own padding reports the dialog as the
event target, so `target === dialog` treats it as a backdrop click and can
discard an in-progress form; compare against the element's box instead.

---

## 5. Phase Management Lifecycle
Every project detail page must include a direct way to see, edit, add, or delete phases inside the sidebar:
* **Add Phase**: An explicit "Add Phase" button opening a `<dialog>` for inputting names and duration.
* **Edit Phase**: Prefilled edit controls inside a dialog.
* **Delete Phase**: Forms calling server actions to clean up associated log histories, dependencies, and tasks with confirmation.

**A phase has no page of its own** (2026-07-21, user call — `/history/phase/:id`
retired, the last of the `/history/**` pages to go). Its home is the DETAILS
popover on its program page, and that popover follows §4b's rule exactly:
`/programs/:id#phase-:phaseId-detail` opens it, opening it writes that fragment,
closing takes the fragment back off. Every link to a phase anywhere in the app —
feeds, AI briefing citations, partner and person pages — goes there
(`phaseDetailHref`, `src/lib/phase.ts`; never hand-built).

Two consequences that are easy to get wrong:
* **The popover must hold the COMPLETE log, or the retirement lost data.** The
  program page renders a dozen phases and preloads only the 6 newest states per
  phase, so the popover fetches the rest on demand for the one phase you opened
  (`getPhaseLog`). Whatever it renders is the whole record — there is nothing
  further to click through to, and no "full history →" link to offer.
* **`#phase-:id` and `#phase-:id-detail` are one family, not a collision**: the
  bare id is the rail row's scroll anchor, the `-detail` suffix is the popover
  over it. Fragments that are not ours are left untouched when the popover
  writes or clears its own.

---

## 6. Tables & Lists — the one grammar

Applies to every tabular/list surface (Programs, Partners, Sources, Me, ecosystem
tables) so nothing has to be relearned page to page.

* **One type grammar**: 0.8125–0.875rem (13–14px) cell text in the foreground color; links are quiet
  (**weight 400 app-wide** — color/underline is the affordance, weight stays
  reserved for hierarchy; underline on hover); no background-color badges.
  Semantic color (health) is colored *text* only. Muted gray is reserved
  for secondary facts (types, provenance, dates' fallbacks).
* **Links are BLUE — `var(--link)` / `var(--link-hover)`, never the brand
  green** (2026-07-20, user call). Green is this app's "good / early / saved"
  signal, so painting navigation green made every link read as a status. The
  green ramp (`--p-600`) stays for semantic positives — pace chips, saved
  ticks — and for solid button fills.
* **A date cell carries the machine form and the reading form at once** (2026-07-25,
  issue #153 — this replaces "dates are ISO … never locale-formatted dates in table
  cells"). Via the shared `DateCell`, one `<time>` element holds both: `dateTime` stays
  ISO (`2018-06-01`) for assistive tech, copy-paste and anything parsing the DOM, while
  the VISIBLE text is locale-short — **`Jun 1, 2018`**, `day: 'numeric'` and never
  `'2-digit'`, so it reads `Jun 1`, not `Jun 01`. Hover still reveals the ISO calendar
  week ("W22").

  The old rule forbade this for two reasons; **exactly one of them survived**, and it is
  worth stating which, so the next person does not re-derive the wrong one:
  * *Mis-sort* — **no longer true.** `DataTable` sorts the ROW VALUE, not the rendered
    node, and the server ships full ISO strings. The visible text was never what ordered
    the column; ISO-as-label was buying a property the table already had.
  * *Misalign* — **still partly true.** `Jun 1` and `Sep 30` differ in day-field width,
    so the digits no longer form one straight column edge. `tabular-nums` and
    `white-space: nowrap` stay (they still align digits WITHIN a field), and we accept
    the residual ragged edge: a reader parses "Aug 12, 2027" at a glance and has to
    decode "2027-08-12", and legibility beats a flush right edge in a column nobody
    reads as a ruler.

  **ISO is a TABLE format, not a prose one** — unchanged, and now the cell side has moved
  toward the prose side rather than away from it. Dates in narrative text (AI briefings,
  status notes, any running prose) read the way a person says them — "August 2027", "end
  of March" — at the coarsest truthful altitude. The boundary is still the cell edge, and
  `tests/summaryProseDates.test.ts` still guards the prose side (issue #20).
* **Header click sorts. Filtering is a secondary, per-column action**: a small
  three-line funnel icon beside the label opens a checklist of that column's
  distinct values. Selections within a column are OR-ed ("Concerned" *and* "On
  Track"), columns are AND-ed together. An active funnel shows an accent color and
  a count. No standalone filter bars: the ONE free-text control a listing gets is
  `DataTable`'s own, on the **KEY (first) column** — a case-insensitive substring
  over the rows already loaded, which is a **filter, not a search** (client-side,
  no request), so it is **squared, not the search near-pill** (its corner
  is the tell — box-vs-pill applied to inputs) and it is a member of the same
  **"× Clear filters"** set as the funnels, which resets all of them in one action
  (#86). Page-level deep links (`?minRisk=…`, `?filter=active`, `?q=`) initialize
  that state rather than adding widgets.
* **BOX vs PILL is a rule, not a per-table choice** (2026-07-20, user call):
  a **box** (squared corners, `ClassBox`) marks a CLASS the thing shares with
  others — Partner Type, Region, a result's kind. A **pill** (fully rounded)
  marks a PROPER NOUN, one specific named entity — "Bosch", a person. The SHAPE
  carries the distinction, so it survives greyscale and colour blindness. Names
  in table cells stay quiet links: the rule says which decoration to use *when
  you decorate*, not that every name must be decorated. **Settled for people by
  screenshot** (2026-07-25, issue #153): `/partners`' TEL column holds 2–3 people, and
  pilling them was tried side by side against comma-separated quiet links. The pills
  lose: they widen both person columns until the second name clips, they add a row of
  outlined objects beside the Partner-Type and Region boxes already there, and they make
  the row's own subject — the partner name in the frozen first column — the quietest
  thing on the row. People in cells are `PersonCell`'s quiet links.
* **SHAPE marks the kind; BEHAVIOUR follows from it** (2026-07-22, issue #30) —
  §6 named the shape and left three tables to each guess the behaviour:
  * A **noun** (one named entity) **navigates** to its RESTful route and never
    filters. It is a quiet link (not every name must be pilled); a name **with** a
    route must be clickable (§2, "No Plain-Text Dead Ends"); a name with **no**
    route is plain text.
  * A **class** (a shared category, `ClassBox`) **filters its own column** on
    click and **never navigates**. The click sets that column's filter to the
    clicked value — it **replaces** the column's selection (a focused drill; the
    header funnel is the multi-value OR tool, §6 above). A class only belongs in a
    filterable column — an inert `ClassBox` that does nothing on click is a bug.
  * Declare the column's kind once and derive both decoration and behaviour, so a
    call site cannot express the wrong combination (the `DataTable` column-kind
    version, tracked with #29 — until then the rule is enforced by review).
* **Result types are BOXED readouts, not coloured words** (`KindBox`, shared by
  the suggestion dropdown and the full result list so they cannot drift). The
  inks are `--kind-*` tokens: the hexes they replace were picked against a light
  page and rendered at 1.7:1 on both dark themes, which made "Program"
  effectively invisible. The box is a hairline in the label's own ink — a rule,
  not a filled badge — so the type no longer depends on colour alone to separate
  itself from the title beside it. Kind colour is IDENTITY, never health.
* **One measure per cell**: a value gets exactly one visual rendering (a face, a
  number, a bar — never a face *plus* the number *plus* a word). The redundant
  forms live in the tooltip/accessible name.
* Implementation home: `src/components/DataTable.tsx` (sort, pagination, column
  filters, the squared key-column filter box) + `DateCell` + `PersonCell`. New tables
  must use them rather than re-implementing — `tests/dataTableConvention.test.ts` fails a
  `DataTable` host that renders its own date or builds its own person route. A funnel
  over a person column keeps the STORED string as its value (a locale-stable shareable
  token) and reads the name only in `filterLabel`, so the header and the cells agree
  without the URL changing meaning. The identity column is a **`<th scope="row">` frozen
  first column** (#29): `position: sticky; left: 0` with an opaque `--bg` so, on a
  narrow viewport, the name you are reading the row FOR stays put while the rest
  scrolls sideways in the wrapper (§9) — and the row-header associates each row's
  cells with its subject for a screen reader. Page size is a **per-user preference**
  (`ROWS_PER_TABLE`, the #31 registry), read hydration-safe and written by a
  rows-per-page control in the footer, so the density a reader picks survives reload;
  an explicit `pageSize` prop is a fixed override for the rare table that wants one.

---

## 7. Information density & scanning

The test for every block: could a human scan it top-to-bottom without their eyes
stopping on empty space? Rules:

* **Label:value pairs live on ONE line** — small-caps label left, value right (or
  inline) — never stacked, except when the value is multi-line prose.
* **Icon + fact + action cluster horizontally**: a status glyph, its date, and its
  action button form one row (e.g. face · "Updated Jun 30" · Update), never a
  three-line stack.
* **Vertical rhythm scale**: ≈0.875rem (14px) between sibling blocks, ≈0.4375rem
  (7px) between rows inside a block. Page headers are one line of title + one
  hairline, ≤ ≈1.625rem (26px) tall.
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
  these levels is being double-applied. Rule 3 is enforced by
  `tests/separation-hierarchy.test.ts` — a headed block that also declares a
  `border-top` fails CI (the page-title `border-bottom` of rule 4 is exempt).
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

## 8b. Color: warm neutrals, and NO literal colors in components

The palette lives entirely in `globals.css` as tokens, restated under
`:root[data-theme="dark"]`. Two standing rules:

* **The neutral field is warm in both themes** (2026-07-20, user call, adjusted
  toward [pearish-theme](https://github.com/dvhthomas/pearish-theme)): warm stone
  in light, roast brown in dark — never a blue-grey, and never near-black. Dark
  sits at ~16% lightness, not 11%; a dark theme should read as dim paper, not as
  a void. The stacking order `--bg` < `--paper` < `--surface` is load-bearing, and
  every "soft" chip background must stay ABOVE `--paper` or it reads as a hole
  punched in the card rather than a tint. The brand `--hue: 142` stays locked, and
  links stay blue (§6) — pearish's mint/pear accents are inspiration for the
  NEUTRALS, not a license to recolor semantics.
* **Components never hard-code a color, including inside SVG.** `fill="#fff"` is
  the recurring offender: it means "the surface behind me", which is
  `var(--paper)` — as literal white it survives the theme switch and glares. This
  existed in six components at once (gauges, hill charts, capacity bands, phase
  graph); fix the whole family when you find one.
* **Third-party widgets carry their own palettes and ignore our tokens.**
  MDXEditor is the live example: it needs its `dark-theme` class, which CSS alone
  cannot add, so `MarkdownNoteEditorImpl` reads the resolved theme via
  `useResolvedTheme()` (a `useSyncExternalStore` over `<html data-theme>`, neutral
  server snapshot). That hook is ONLY for handing the theme to something CSS can't
  reach — anything stylable uses tokens.

Verify both themes by eye. Text-content assertions all passed while the note
editor rendered black ink on black paper for weeks; `tests/needle.spec.ts` now
compares ink and paper luminance because that is the property that was broken.

---

## 8c. Two appearance axes: STYLE and THEME

(2026-07-20, user call.) `<html>` carries two independent attributes, and every
combination must work:

| Attribute | Values | Stored in |
|---|---|---|
| `data-style` | `standard` · `instrument` | `autoknow-style` |
| `data-theme` | `light` · `dark` (resolved from `light`/`dark`/`system`) | `autoknow-theme` |

* **`instrument` is the DEFAULT** (2026-07-21, user call): it is what the app
  should look like out of the box, for everyone with no stored preference. Only an
  explicitly stored `standard` opts out, so nobody who chose the old look loses it.
  The default lives in TWO places that must agree — the inline script in
  `layout.tsx` and `StyleToggle`'s server snapshot — or the picker shows the wrong
  row as current for one frame.
* **`standard` is the app as it was, and must stay that way.** Adopting a second
  style is only safe if going back is free, so the base token blocks are frozen:
  Instrument adds `:root[data-style="instrument"]` on top, never edits what's
  underneath. That holds regardless of which one is the default — the default says
  what you see first, not which tokens are allowed to move. Both pickers live in
  the user menu and share one control shape.
* **Both are resolved by the inline script in `layout.tsx` before first paint.**
  Neither may move into React — that reintroduces the flash the script exists to
  prevent, and `tests/appearance.spec.ts` asserts the attribute before hydration.
* **Instrument's vocabulary** is the cluster behind the wheel: pear accent
  (`--hue` 142 → 76 — the only sanctioned move of the locked brand hue), a
  `--redline` used solely to show a control is live, `--graticule` tick-mark
  rules replacing plain hairlines, and tabular numerals throughout.
* **Style-conditional graphics render in BOTH styles and are revealed by CSS**
  (`[data-inst-only]`, hidden by default). Nothing may read the style in JS to
  decide what to draw: hill charts appear dozens to a page, and a per-instance
  subscription to buy a decoration is a bad trade. `useResolvedTheme()` stays
  reserved for third-party widgets CSS genuinely cannot reach.
* **The needle gauge is off limits.** Its shape and mechanics are identical in
  both styles; it picks up the new tokens and nothing else. The hill charts are
  where the graphic experiment lives — a groove under the curve and a
  quarter-tick baseline graticule, both scaled so the wide summary hill and the
  small per-phase gauges stay the same drawing.
* **Icons stay scarce.** The app mark is untouched, and Instrument adds no icon
  set — its identity is carried by rules, numerals, and one graphic: the app's
  OWN gauge, at glyph size, at the trailing edge of the hero search field.
* **The dial lives INSIDE the search field, and reports the search** (2026-07-22,
  user call — this reverses "the dial lives on the primary CTA, and only there",
  which had it answering to hover). It sits at the field's trailing edge, rests
  while nothing is running, and hunts while a request is in flight — the suggest
  while you type, the full search once you commit. Two consequences:
  * **The hero has no submit button.** A field that answers as you type does not
    also need a button saying "answer": Enter and the panel's "see all results"
    row commit, and the dial is what tells you the machine heard you. Scoped
    searches (partner/program pages) genuinely wait for a submit and keep their
    button — as a plain label, since the dial no longer rides on it.
  * **The dial is a READOUT, so it needs a state to report.** `SearchField`
    filter boxes still get none: they filter rows already in the page, and a
    needle parked forever is decoration. A dial driven by hover was the same
    mistake in a better costume — it reported the mouse, not the machine.
* **Motion uses the real instrument, never a stand-in, and never a CSS rotation.**
  Two attempts failed first. A CSS gradient bar that swept on focus read as a
  progress bar in costume, because that is what it was. Rotating the real needle
  path about an assumed origin then pivoted visibly wrong. `InstrumentGauge`
  animates the gauge's `progress` and lets the primitive redraw `needlePath` —
  the same thing that happens under a drag — so the travel is correct by
  construction rather than by a transform-origin someone got right once.
* **The dial is monochrome and empty.** No redline (busy at 18px) and no fill
  ribbon (a filled arc trailing the needle is a readout, and this dial reports
  nothing). Track, graticules and needle are all inked from the button's
  `currentColor`. `Gauge` gained only `data-needle` / `data-track` styling
  handles — CSS beats presentation attributes, so a variant re-inks the dial
  without widening the primitive's API. Its geometry is untouched.
* **The graticule has to appear where headings do, or the style does not read.**
  Every heading follows one order: **text → affordances (ⓘ, menus) → graticule to
  the end of the line.** It rules trailing every `AnchorHeading` (so every `<h2>`),
  every page title row, and underlines every `DataTable` header — not just the
  nav. In both cases the border keeps its place in the box model and only its ink
  moves, so switching styles never shifts layout. Three traps: the heading row needs
  `width: 100%` or a shrink-wrapped row gives a 40px stub of a rule; the
  `::after` belongs on the TITLE ROW, never on a `flex-direction: column` header —
  there it becomes a row of its own and drops a tick fragment mid-header; and
  **affordances go INSIDE the row (`AnchorHeading`'s `actions` prop), never as
  siblings of it.** The graticule is a `::after`, so it is last within its row and
  nowhere else: a sibling lands after the whole row, which flings the ⓘ/⋯ to the
  far right — divorced from the title they act on, and with no room for a
  left-anchored popup, which then opens off the container's edge. Enforced by
  `tests/project_details.spec.ts` "the Phases affordances sit against the title".
* **One anchored-menu control, and it can no longer open off-screen (#24).** Every
  "a ⋯/funnel/avatar trigger opens a panel anchored to it" surface is `AnchoredPopover`
  — the kebab menu, the phase-track title menu, the user/settings card, the DataTable
  column filter all route through it. It renders the panel in the TOP LAYER (the
  `popover` attribute, so it clears every `overflow` clip and needs no z-index) and
  places it with the pure, unit-tested positioner in `lib/anchoredPosition.ts`, which
  FLIPS above when the bottom would overflow and CLAMPS into the viewport — so the
  off-the-edge symptom above is now defended in depth, not just avoided by careful
  authoring. Do not hand-roll a fifth: a new anchored menu is a new `AnchoredPopover`
  (`variant='menu'` for an action list, `variant='panel'` for a card/checklist). MODAL
  overlays are the OTHER family — native `<dialog closedby="any">`, not this — and stay
  separate (§4b, and the #34 overlay container).
* **Motion is ONE idea, not a collection of effects: an instrument settles.**
  A reading sweeps from its stop to its value once, quickly, easing out. There
  are exactly two implementations and adding a third needs a reason:
  1. **State-driven** — `useSettle` (rAF, `prefers-reduced-motion` aware) drives
     the search dial as a query starts and stops. JS, because the needle's
     geometry is a React prop, not something CSS can reach. The dial's *hunt*
     while a request is in flight is not a fourth idea: it is this one repeated —
     an instrument with no reading yet swings between two stops looking for one,
     each leg the same settle. Repeating motion has to branch on
     `prefers-reduced-motion` (`usePrefersReducedMotion`) rather than lean on
     `useSettle`'s degrade: a single settle degrades by jumping to its value, but
     a hunt that jumps is a needle flicking between two stops forever.
  2. **Reveal** — *retired with the buffer bands it swept* (issue #75). It was a
     CSS animation (never JS — a JS reveal gates the data on an effect firing, and
     an IntersectionObserver that never fired once left the chart with no visible
     bands at all). The state grid that replaced the bands renders without a reveal;
     the principle stands for the next one that needs it — start from a state the
     element already has, so nothing the motion does can hide a reading.
  3. **Flow** (2026-07-21, user call) — the phase rail drifts a dashed overlay
     down the track LEAVING an in-progress phase. What earns it a third slot: a
     plan is a static picture of something that is actually moving, and nothing on
     the rail said where. This makes the live front of the program the only thing
     with movement, and the movement points the direction dependencies run. Scoped
     hard so it stays one idea rather than an effect: only phases that are
     started-and-unfinished, only the track carrying their work, one shared
     keyframe. The drift runs from the phase to wherever its work lands, and
     stops at the first phase that is not itself under way. Note the quantifier
     differs from the ink's: a stretch is "done" only if EVERY dependency on it
     has departed a finished phase, but it is "carrying live work" the moment ONE
     has — requiring all of them stopped the drift at the first shared stretch,
     which on a converging plan is a stub nobody can see. The same drift also runs
     the traced route when a phase is SELECTED, over exactly the stretches the
     direction bands colour (both come from one filter, so colour and motion can
     never name different track): the band says which side, the drift says which
     way. Two rules a re-implementation must keep — a tie drawn against the work it
     carries (the middle stops of a fan-out) reverses the offset rather than the
     geometry, and the dashes take the BAND's colour on a finished line, since a
     finished line is already ink and ink-on-ink is an animation nobody can see.
     CSS, and `display: none` unless
     `prefers-reduced-motion: no-preference` — gating only the animation would
     leave a dashed line sitting on the track for a reader who asked for stillness,
     which is decoration they never asked for rather than an effect they opted out
     of.
  Rejected deliberately: a gauge on every boxed label (30+ per table is noise,
  and the point of these is to be scannable at rest), and animating dialogs open
  (the `<dialog>` top-layer/focus behaviour is correct now and not worth risking
  for a flourish).
* **A REQUEST gets the near-pill rounding and the dial; a FILTER gets neither.**
  `UnifiedSearch` issues a query, so it is the rounded (1.25rem) bar with the dial at
  its trailing edge. The built-in `DataTable` filter box (`SearchField`) narrows rows
  already in the page, so it is **squared (0.375rem)** and dial-less — the corner is
  what tells a filter from a search (box-vs-pill, §6; #86). `SearchField` shares
  UnifiedSearch's type and focus ring (keep those in sync); the radius and, since #158,
  the HEIGHT diverge on purpose — a search is the page's primary affordance and is sized
  like one, while a filter belongs to the control strip of the list it filters, so it takes
  the compact 0.375rem vertical padding that matches a table's own footer controls. Both
  are COMPONENTS, not shared classes, because CSS modules cannot share a class across files
  and this control had drifted into three separate definitions.
* **The Schedule is a phase × week STATE GRID, not textured buffer bands** (issue
  #75, `ChainSchedule.tsx`). The earlier encoding painted buffer movement as
  full-height hatch/stipple bands (crosshatch/hatch/dots) across every row; on a
  complex chain that was method-correct but unreadable — a band belonged to no row,
  and the multi-directional textures vibrated against each other. It is replaced by
  a grid of cells, one row per chain phase, one column per ISO week, each cell
  coloured by that phase's state that week: **state separates by colour + position,
  never texture** — on-plan ink (`--fg`), over-plan `--bad`, finished-early `--ok`,
  idle handoff `--warn` (dashed, in the channel between rows), forecast/not-started
  a dashed `--muted` outline. Transitions are drawn **to the day** (cells clip to
  the phase's true start/end; idle gaps render to the day, so the chart drives
  "start the day the baton lands", not "wait until Friday"). A **buffer-on-hand
  lane** sits below on the same week axis — a stepped line, each step pinned under
  the phase that moved it and labelled with the buffer in hand there. Every step is
  labelled — where several phases move the buffer in the same week the labels FAN OUT
  in y rather than any being dropped (a hidden step hides a real buffer move); only the
  redundant anchors (a y-axis tick still read from the scale) may yield. There is no
  texture layer and no `data-std-only` / `data-inst-only` pair here any more; the grid
  reads identically in both styles. The axis always reaches the SOP; a run of ≥ 6
  **empty** weeks (no phase, no handoff — the buffer tail, or the SOP-overshoot span)
  COLLAPSES to a marked break (the conventional double-slash) that **states how much
  time it compresses** — an unmarked break would be a false statement about duration.
  Collapse keys on emptiness, never on band kind, so the overshoot case (where the
  interesting span is the loss, not the buffer) collapses the right side.
* **Lines never cross unexplained.** A subway map and a circuit diagram both owe
  the reader an account of every intersection, and the phase rail owes the same:
  where a branch line must pass over track it is not joining, it draws a HOP — a
  small arc lifting the line clear (`hopsBetween` / `runX` in `PhaseTrack.tsx`).
  A bare crossing reads as a junction that isn't there, which is a false statement
  about the dependency graph, not a cosmetic issue. Simplicity is the only valid
  reason to let lines meet at all, and it buys the hop, not the ambiguity.
* **The gauge face is near-WHITE in both themes** (`--gauge-face`). It is the one
  surface that does not follow the page into the dark: a real instrument has a
  light face whatever the light in the cabin, and it is what makes the coloured
  sweep read.

---

## 8d. Vertical rhythm: everything that affects HEIGHT lands on a whole pixel

(2026-07-20, user call — 1px hiccups are the whole problem.) A 1px border on a
fractional y renders as a soft 2px smear, and the drift accumulates down the
page, so section rules end up a pixel apart from each other. Four rules, all
enforced by `tests/vertical-rhythm.test.ts` rather than by good intentions:

1. **The body line box is a whole number.** `line-height: 1.5` at 16px = 24px.
   The `1.6` it replaced computed 25.6px and put 547 elements off-grid on the
   program page alone.
2. **Every `font-size` resolves to a whole pixel.** No `12.5px`, no `1.15rem`
   (18.4px). Half-pixel type can never produce an integer line box.
3. **An ODD font-size states an explicit integer `line-height`.** 13px × 1.5 =
   19.5px; the small label steps (9/11/13/15px) are deliberate, so they pin
   14/16/20/22px boxes instead of inheriting a ratio.
4. **No fractional `padding`/`margin`/`gap`/`height`.** `padding: 0.5px 6px` on
   the AI badge was a real instance. `letter-spacing` and `border-width` are
   exempt — a hairline is allowed to be thin.

Two traps worth knowing. `vertical-align: super` on a sized inline (the briefing
citations) grows the LINE BOX, so each bullet became 21.66px tall; offset the
glyph with `position: relative; top` and `line-height: 0` instead. And an SVG
with `width: 100%; height: auto` computes a fractional height at almost any width
(the needle gauge and hill containers) — the design decision that resolving it
required (how a chart behaves when it shrinks) is now **taken**: a chart fills its
container's inline size and owns its height, author-set in `rem` so it lands on a
whole pixel. See §9b and [ADR: Containers own outer spacing; charts fill width and
own their height](adr/2026-07-22-containers-own-spacing-charts-own-height.md).

Measure, don't eyeball: the audit that found all of this compares rendered
rects, and reported 0 near-miss horizontal edges throughout — the defects were
all vertical.

---

## 9. Sizing & responsive widths — rem-first

**Use `rem` for every size** — font-size, padding, margin, gap, width,
max-width, border-radius. The root stays at the browser default (16px), so the
entire UI scales coherently with browser zoom and user font-size preferences.
Sanctioned `px` exceptions (the *specific reasons not to*):

1. **1px hairlines** and SVG stroke widths — a hairline must stay a hairline.
2. **SVG internal geometry** (viewBox coordinate space).
3. **Media-query breakpoints** (see below — px is the convention and avoids
   em-in-query quirks).

Anything else in `px` needs a comment saying why. **`tests/vertical-rhythm.test.ts`
enforces this** — it fails on any px length outside the sanctioned list, so the
rule is checked rather than remembered.

Two traps the conversion hit, worth knowing before the next one:
* **Media-query conditions are not declarations.** A declaration-level regex will
  happily rewrite `@media (max-width: 960px)` to `60rem` and silently move where
  every layout collapses. Breakpoints stay px; a mechanical unit refactor must
  never change responsive behaviour.
* **React treats `lineHeight` as unitless.** Inline `lineHeight: 1.55` is a RATIO,
  so converting the bare number yields a 1.55px line box. `borderRadius: 999px`
  is likewise a "fully round" sentinel, not a measurement.

Form controls are the silent exception: the UA gives `button`/`input`/`select`/
`textarea` 13.3333px Arial and they do NOT inherit page type, so they ignore root
scaling entirely until reset (globals.css does this).

**Compliance widths.** Every layout must render correctly — no horizontal page
scroll, no clipped controls, no overlapping text — at these viewport widths:

| Width | Stands for |
|---|---|
| **360px** | small phone (worst case that must remain readable + operable) |
| **768px** | tablet / split-screen laptop |
| **1024px** | narrow laptop |
| **1440px** | desktop — the primary design target |

Wide content (tables, rails, diagrams) scrolls inside its own
`overflow-x: auto` container; the page body never scrolls horizontally.

**Canonical breakpoints — exactly two; don't invent new ones:**

* `@media (max-width: 960px)` — collapse 2-column layouts (sidebar grids,
  detail panes) to a single column.
* `@media (max-width: 560px)` — phone adjustments (tighter paddings, stacked
  toolbars).

Existing stray breakpoints (900/860/700/520) migrate to these when their file
is next touched.

---

## 9b. Box-model ownership: the container owns outer spacing; a chart owns its height

(2026-07-22 — [ADR: Containers own outer spacing; charts fill width and own their
height](adr/2026-07-22-containers-own-spacing-charts-own-height.md).) Two rules so a
component can be dropped into any layout unchanged and a chart sizes predictably:

* **A component's root element never sets an outer margin.** No `margin`,
  `margin-top`, or `margin-bottom` on the root — the **parent** supplies the space
  between siblings with `gap` (or `padding`). This is already the majority
  convention (`gap` outnumbers root margins ~2:1); the rule states it so it stops
  drifting. Centring (`margin: 0 auto`) and resets (`margin: 0`) are not outer
  spacing and are fine. Inner elements may still use margins where `gap` doesn't
  reach — the rule is about the **root**, not every class.
  `tests/componentRootMargins.test.ts` enforces it: a new component root with an
  outer margin fails CI. It runs as a ratchet with an explicit allowlist of the
  remaining legacy violators, and the allowlist may only shrink.
* **A chart fills its container's inline size and owns its own height.**
  `width: 100%`, and it does **not** read its container's width in JS to size
  itself. Height is author-set in `rem` (which also lands it on a whole pixel —
  this is the resolution of the fractional-height source §8d used to defer).
  `aspect-ratio` height is rejected (it re-introduces a fractional height and makes
  a wide chart tall on a phone). **A `viewBox` drawing takes a rem `max-height`
  rather than a fixed `height`** (#154): a fixed height letterboxes it at every width
  below the cap — ~160px of dead space at 360px — whereas a max-height leaves the
  drawing filling its column when it is small and only caps the scale at the wide end,
  which is where a fluid viewBox magnifies its own type past legibility. Measuring for pointer math, popup placement or
  scroll anchoring is unrelated and unaffected — the rule bans measuring to
  **size**, not measuring at all.
