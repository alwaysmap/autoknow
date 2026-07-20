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
* **Hyperlinked Names**: Partner names, OEM names, Supplier lists, and owner LDAP emails must always be links leading to their respective detail pages (e.g. `/partners/[id]`, `/people/[ldap]`).
* **Interactive Cells**: Count fields (e.g. "Active Programs") must link to pre-filtered lists (e.g., `/partners/[id]?filter=active`). Action phase names must link directly to the history logs of the project detail view.
* **No Plain-Text Dead Ends**: Sighted users must never be presented with static, non-clickable entity names when a corresponding detail route is available in the application.

---

## 2b. `/` is a landing page; the dashboard lives at `/ecosystem`
(2026-07-20, user call.) The root route is **not** a dashboard. Its one job is to
get you to the thing you came for:

* **A big search box is the primary affordance** — the largest control in the app,
  autofocused, and the only place `hero`-sized styling is sanctioned
  (`UnifiedSearch` takes a `hero` prop). It deep-links: `/?q=…` runs the query on
  load, and `/search?q=…` redirects here so older shared links keep working.
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
  it writes that hash. There is no separate history *page* for needles.

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
* **BOX vs PILL is a rule, not a per-table choice** (2026-07-20, user call):
  a **box** (squared corners, `ClassBox`) marks a CLASS the thing shares with
  others — Partner Type, Region, a result's kind. A **pill** (fully rounded)
  marks a PROPER NOUN, one specific named entity — "Bosch", a person. The SHAPE
  carries the distinction, so it survives greyscale and colour blindness. Names
  in table cells stay quiet links: the rule says which decoration to use *when
  you decorate*, not that every name must be decorated.
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

* **`standard` is the app as it was, and must stay that way.** Adopting a second
  style is only safe if going back is free, so the base token blocks are frozen:
  Instrument adds `:root[data-style="instrument"]` on top, never edits what's
  underneath. Both pickers live in the user menu and share one control shape.
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
* **The dial lives on the primary CTA, and only there.** Never on a text input:
  an instrument is an affordance, and affordances belong on the thing you press.
  **Hover** drives it (plus `:focus-visible`, so keyboard users get the same
  affordance) — never click.
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
  moves, so switching styles never shifts layout. Two traps: the heading row needs
  `width: 100%` or a shrink-wrapped row gives a 40px stub of a rule, and the
  `::after` belongs on the TITLE ROW, never on a `flex-direction: column` header —
  there it becomes a row of its own and drops a tick fragment mid-header.
* **Every search bar gets the rounding and the dial**, not just the hero, and the
  dial lights as soon as suggestions appear — not only on hover.
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
with `width: 100%; height: auto` computes a fractional height at almost any
width — this is the one **known remaining** source (the needle gauge and hill
containers), left alone deliberately because fixing it means choosing how gauges
behave when they shrink, which is a design decision, not a cleanup.

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
