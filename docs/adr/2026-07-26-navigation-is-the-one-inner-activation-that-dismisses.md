---
status: accepted
date: 2026-07-26
supersedes: ""
superseded-by: ""
extends: ""
extended-by: ""
tags: [ui, popover, menus, navigation, components]
---

# Navigation is the one inner activation that dismisses a popover, and the popover decides it

**Context.** `AnchoredPopover` deliberately does not close on clicks inside its panel:
unmounting a menu item's `<form>` aborts its in-flight server action. That rule is
correct and is stated in the component's own header. But it left navigation with no
answer. A `<Link>` child navigates client-side, unmounts nothing and fires no native
light-dismiss, so the panel simply stayed open over the new route — permanently in the
collapsed nav (`NavLinks`), whose ⋯ survives every navigation. Dylan reported it there
(`autoknow-6mn`); two more call sites had the same shape, and `PhaseTrack` had already
worked around it privately with its own `onClick={() => close()}` on one link — the
"three hand-rolled variants" of AGENTS lesson 7, caught one variant in.

**Decision.** Dismissal is `AnchoredPopover`'s job — no call site writes the Escape
handler or the outside-click handler either — and **a link that replaces the current page
is a dismissal trigger**. The component closes on a delegated panel click whose target is
an `a[href]` that will actually navigate this page: primary button, no modifier keys, no
`target` other than `_self`, no `download`. Everything else in the panel — buttons, form
submits, checkboxes — is untouched, so the no-close-on-inner-click rule stands exactly
where it was written to stand. Call sites render a plain `<Link>` and add nothing.

**Alternatives rejected.**
- *Four `onClick={close}` copies at the call sites.* Two of the sites are SERVER
  components, where the `{ close }` render-prop cannot cross the boundary at all; and
  `autoknow-qdd` turns nav-only controls into links app-wide, so every future link would
  have to remember the wiring. This is the variant-multiplying answer lesson 7 forbids.
- *A sanctioned `MenuLink` client component consuming `close` from context.* Works in
  server components, but still an opt-in each new call site must know exists — it moves
  the forgetting rather than removing it, and buys nothing the delegated handler doesn't.
- *Close on any inner click.* Deletes the rule that this component was given a header
  comment to protect. A server action would abort mid-flight.

**Consequences.** A panel that WANTS to stay open across a link activation can no longer
have one; if that case ever arrives it needs an explicit opt-out prop, not a call-site
workaround. `e.defaultPrevented` is deliberately not consulted — `next/link`
preventDefaults in its own handler to run the navigation, so the flag is true in exactly
the case that must close — which means an `<a href="#">` used as a fake button would also
dismiss. No such anchor exists in any panel today (all nine consumers were swept), and
an anchor that does not navigate is already an anti-pattern here.

**Receipts.** `autoknow-6mn`; PR for `fix/6mn-menu-closes-on-navigate`;
`tests/menu_dismiss.spec.ts` (red on the nav case before the fix, green after, and its
fourth test holds the server-action side of the rule).
