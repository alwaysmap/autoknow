---
title: A server-action redirect() did not navigate the tab under `npm run demo`, while the prod build did — so verify a broken-looking form flow against the prod build before believing it
status: current
updated: 2026-07-27
applies_to:
  - verifying a form or mutation flow in `npm run demo` / `next dev`
  - src/app/actions/** — any server action ending in redirect()
  - concluding that your own change broke a submit button
symptoms:
  - the form submits, the row IS created in the database, and the tab still shows the form
  - the picker still holds the value you selected, as if the submit never happened
  - a reload, or a fresh browser context, shows the correct new state
verified_by: 'reproduced ~6 times under npm run demo (next dev, Next 16.2.10 Turbopack, headless chromium) against src/app/actions/people.ts byte-identical to main; the same flow passes against the prod build as tests/me.spec.ts "a login without a Person self-provisions from /me"; autoknow-6q3, follow-up autoknow-p90'
---

# A server-action `redirect()` did not navigate the tab under `npm run demo`

**The lesson.** Driving `createMyProfile` in the demo, the submit committed the mutation
and then **left the tab exactly where it was**, still rendering the pre-submit tree with
the caller's own selection in the picker. The server was not wrong: the row was in the
database, and requesting the target URL by hand — curl, a reload, a fresh browser context
— rendered the new state correctly. The same interaction navigates correctly against the
production build Playwright serves, which is how `tests/me.spec.ts` is green on a flow
that looks broken in the demo. **The mechanism is unknown**; what is established is that
the verdict differs between `next dev` and the prod build for identical code, so the demo
alone cannot convict your diff.

**Why it bites.** Every signal points at what you just changed. You changed a page, you
drove it in the browser as this repo insists, and the form appears not to work. The DB
check ("the row exists") then reads as a half-broken redirect rather than a whole-working
action, and `revalidatePath` is the natural next guess — `revalidatePath('/me')` and
`revalidatePath('/', 'layout')` were both tried here and neither changed anything, which
is half an hour spent on a lever that may not even be attached. The one experiment that
settles it — re-running the flow against code **byte-identical to `main`** — is the one
nobody thinks to run, because the flow was working on `main`.

**What to do.** When a submit looks broken in the demo, before touching the action:

0. Read the browser console. A client-side exception or a failed hydration produces every
   symptom above and IS a real bug. (None appeared in the run this note comes from —
   `console` and `pageerror` were both captured.)
1. Reload, or open the target URL in a **fresh browser context**. If the new state is
   there, the mutation and the render are both fine.
2. Re-run the same flow against code byte-identical to `main`. If it fails there too, it
   is not your diff.
3. Confirm against the prod build — `npm run test:e2e` is the cheap version, since the
   specs run against `.next-test` from a real `next build`.

Do not "fix" it with a `revalidatePath` that made no difference: it would ship as cargo
cult in a file the next reader trusts.

**How we found out.** autoknow-6q3 made `/me` render the person page instead of
redirecting to `/people/:id`, which raised the question of whether self-provisioning
should also come back to `/me`. A `/me`-landing version appeared to fail in the demo; so,
after the revert, did the untouched original that redirects to `/people/:id` — while
`tests/me.spec.ts` asserts that exact navigation and passes. Same code, two verdicts.
