---
title: A global `[class*="foo"]` selector styles ANY CSS-module class whose hashed name contains "foo"
status: current
updated: 2026-07-26
applies_to:
  - src/**/*.module.css
  - src/app/globals.css
symptoms:
  - an element has an unexpected background / border / padding / margin nobody wrote for it
  - a compact control (a single input, a small row) renders as a full-width bordered card
  - the surprise style has !important and no matching rule in that component's module
verified_by: 'globals.css `[class*="filterSection"], [class*="filterBar"]` vs the .filterBar→.filterRow rename (#86); `[class*="card"]` erasing the addressed-update highlight in NeedleHistoryList (#111)'
---

# A global `[class*="foo"]` selector styles ANY CSS-module class whose name contains "foo"

**The lesson.** CSS-module class names are scoped by *hashing*, not by isolation:
`styles.filterBar` renders as `DataTable-module__ab12__filterBar`. An attribute
**substring** selector in `globals.css` — `[class*="filterBar"]` — matches that
hashed string, because the readable token survives inside the hash. So a module
class silently inherits a global rule purely by containing the substring in its
name. In this repo `globals.css` has
`[class*="filterSection"], [class*="filterBar"] { …the §1 filter-bar card…
!important }`; naming a compact filter row `.filterBar` turned it into a
full-width bordered card nobody asked for.

**Why it bites.** CSS-module names LOOK scoped, so you never suspect a global
rule is reaching your element — and it carries no `data-` attribute or global
class you added, so nothing in the JSX hints at it. Unlike the specificity trap
in [the `[data-*]` display note](css-module-loses-display-to-global-attribute-rule.md)
(where the element knowingly carries a `[data-*]` attribute), here the collision is the class NAME
itself, and the global rule wins outright because it is `!important`. The DOM
inspector shows only your one module class; the extra chrome comes from a rule
that never names your file.

**What to do.** When you add a component class, avoid the substrings globals.css
matches — grep it for `[class*=` first (today: `filterBar`, `filterSection`).
Pick a name outside them (`.filterRow`, not `.filterBar`). Do not try to
out-specify it — the rule is `!important` and renaming is a one-word fix. If you
genuinely want that global card, opt in *deliberately* by naming into it, don't
back into it.

**When you cannot rename — use a property the blanket does not claim.** Renaming
works when *you* name the element. It is unavailable when the global is
SUBTRACTIVE and the class is load-bearing elsewhere: `[class*="card"]` (all
`!important`) strips `NeedleHistoryList`'s `.card`, and renaming would have put
borders and a `--surface` fill back on the program history popup too — unrelated
churn smuggled in by a deep-link feature (#111). Out-specifying is still wrong.
Instead style what the blanket never names: it claims `border`, `box-shadow`,
`background`, `padding`, so `outline`/`outline-offset` survive and can carry a
selection ring no `!important` can erase. Read the block first — free properties
differ per blanket. Note the tell: the *base* rule was dead too, so the module
had long described an appearance the page never had.

**How we found out.** The DataTable filter row (#86) rendered as a big §1 card;
`getComputedStyle` showed a `--surface` background + border + radius the module
never declared, from `[class*="filterBar"]`. Caught by looking at the page, not
the DOM — a class audit reports one correctly-applied class (AGENTS lesson 18).
#111 hit the subtractive half: a highlight with correct markup and a matching
rule computed `box-shadow: none`, identical to its neighbours.
