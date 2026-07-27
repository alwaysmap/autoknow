---
title: A hydration-guarded retry whose body navigates strands itself on the destination page
status: current
updated: 2026-07-26
applies_to:
  - tests/*.spec.ts  # any `expect(async () => …).toPass()` whose body leaves the page it started on
symptoms:
  - "locator.click: Timeout Nms exceeded — waiting for <a control the CURRENT page does not have>"
  - a toPass guard burns its entire 20s budget and the assertion after it never runs
  - the named control is one the DESTINATION page is correct not to have
  - reproduces only under load, and never on a re-run of the spec alone
verified_by: 'reproduced deterministically by delaying /programs/new past the loop`s 1500ms waitForURL (page.route + 2.5s), which fails verbatim before and passes after; tests/helpers/e2e.ts `clickUntilNavigated`; tests/projects_flow.spec.ts; bead autoknow-i8q'
---

# A hydration-guarded retry whose body navigates strands itself on the destination page

**The lesson.** The suite's first-interaction guard —
`await expect(async () => { …click…; …check… }).toPass()` — is only safe while
retrying leaves the page where it found it. If the body NAVIGATES, retrying is
not idempotent: use `clickUntilNavigated` (tests/helpers/e2e.ts), which checks the
arrival first and skips the body once it has happened.

**Why it bites.** The inner check carries its own short budget (1500ms) so the
outer one gets several attempts. Under load a navigation can take longer than
that and still SUCCEED — the attempt gives up, the page lands a moment later, and
the next attempt starts over on the destination. There the control it clicks does
not exist, so every remaining attempt spends its full click timeout waiting for a
missing element until the outer budget dies. The reported failure then names the
wrong thing entirely: a missing `kebab-menu` on a create-program form, which
correctly has no kebab. Nothing in that message points at the navigation that
already worked, which is why it reads as an unrelated flake in a random spec.

**What to do.** Any retry body that can leave the page needs a terminal-state
check as its FIRST act, so a late success ends the loop instead of restarting it
somewhere else. The same shape is already right where the terminal state is a
dialog or a popover on the same page (`if (!(await dialog.isVisible())) { … }`) —
those loops guard, and are the model. Sweep for it with
`grep -B8 toPass tests/*.spec.ts | grep -E 'goto|waitForURL'`.

**How we found out.** Two failures in five full runs on webkit, in a different
spec each time, both reported as generic timeouts and neither reproducible alone.
Delaying the destination route past the inner budget reproduced one of them
verbatim on the first try.
