---
title: An explicit ARIA role replaces a native element's implicit role — role="combobox" un-searchboxes an <input type="search">
status: current
updated: 2026-07-23
applies_to:
  - src/components/UnifiedSearch.tsx
  - adding combobox/autocomplete ARIA to any search or filter input
  - any getByRole('searchbox') selector in tests/**
symptoms:
  - getByRole('searchbox') times out / finds nothing right after adding ARIA to the input
  - a debounced fetch "never fires" in e2e, yet the feature works when you drive the page by hand
  - the live browser (driving by element ref) is green while every e2e that fills the searchbox hangs
verified_by: 'tests/search.spec.ts "navigable with the arrow keys"; tests/home.spec.ts "leads with search and shows the latest updates"; 2026-07-23'
---

# An explicit ARIA role replaces a native element's implicit role

**The lesson.** `<input type="search">` has the implicit ARIA role `searchbox`.
Adding `role="combobox"` (the "canonical" autocomplete pattern) **replaces** that
role, so `getByRole('searchbox')` — used across `home.spec`, `usability.spec`,
`search.spec`, and by real assistive tech — stops matching the element. The
landing search is deliberately a searchbox (`home.spec` asserts the page has one
and the nav has none); don't silently turn it into a combobox.

**Why it bites.** The symptom is maximally misleading. Playwright's `fill()`
waits for `getByRole('searchbox')`; with the role gone it times out → the input
value never changes → the debounced suggest effect never re-runs → no
`/api/search` request → the dropdown never appears. It reads as a hydration or
fetch bug, and it reproduces **only** under role-based selectors: driving the
page by ref (the in-app browser, or a click on a `ref_N`) works perfectly, so the
live demo looks green while every e2e `fill()` hangs.

**What to do.** Give an autocomplete searchbox its combobox-*like* a11y without
the role: keep the implicit `searchbox`, add `aria-autocomplete="list"`,
`aria-controls` pointing at the listbox, and `aria-activedescendant` pointing at
the active `role="option"`. That announces the highlighted row during arrow-key
navigation and keeps every `getByRole('searchbox')` working. (`aria-expanded`
isn't a supported state on `searchbox` anyway — it belongs to `combobox` — so
drop it too.) If you genuinely need `role="combobox"`, change every searchbox
selector in the *same* commit and re-run the searchbox-invariant specs.

**How we found out.** Adding arrow-key navigation to the landing typeahead:
`role="combobox"` made three UI e2e tests (including a pre-existing one) time out
waiting for the searchbox, while the live demo — driven by element ref — worked.
A stash-and-baseline run isolated it to the client change; a temporary
console/request listener showed `fill()` failing on "waiting for
getByRole('searchbox')", not on the fetch.
