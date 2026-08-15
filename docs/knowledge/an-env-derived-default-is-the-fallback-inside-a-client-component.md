---
title: A shared function whose default reads process.env silently uses the FALLBACK inside a client component
status: current
updated: 2026-08-15
applies_to:
  - src/lib/** functions with a `= readSomethingFromEnv()` default parameter
  - src/components/** files carrying 'use client' that import math from src/lib
  - adding a new server-only env var that any UI also has to reflect
symptoms:
  - the figure the UI plots disagrees with the ceiling the server enforces, with no error anywhere
  - a value is correct in an API route and stale/default on the page that renders the same thing
  - a filter/match built from config selects the wrong rows on one page and the right ones everywhere else
verified_by: 'tests/ingestionHealthCadence.test.tsx "plots the REAL cadence, and names it" — mutated by pinning IngestionHealthCard to a literal 24, which turns it red; PR for autoknow-wbe. Second instance: tests/identity.test.ts + PartnersClient''s required `emailDomain` prop (autoknow-cvp / gh-255)'
---

# A shared function whose default reads process.env silently uses the FALLBACK inside a client component

**The lesson.** Making a pure function read config from the environment
(`function f(x, n = resolveFromEnv())`) fixes the server and quietly does nothing on the
client. A `'use client'` component that calls `f(x)` gets the FALLBACK, forever, with no
warning — so the same function returns two different answers on the two sides of the
boundary. Resolve the value in a server component and pass it down as a **required prop**;
do not let the client half call the defaulted overload at all.

**Why it bites.** Only `NEXT_PUBLIC_*` variables are inlined into the browser bundle.
Every other `process.env.X` read evaluates to `undefined` there — a value the `??`
fallback was written to accept, because "absent" is exactly how the config gate says
"infrastructure has not told us yet". Absence in the browser is indistinguishable from
absence in production, so the honest degrade path becomes a permanent lie on the client.
Nothing throws, nothing logs, and TypeScript is satisfied: the default parameter has the
right type. It is worst on surfaces that PLOT a limit the server also ENFORCES, because
those are precisely the surfaces whose whole job is to agree.

**What to do.** Give the client component a required prop for the value and drop the
default at that call site (`budgetGauge(budget, tier, cyclesPerDay)`), then resolve it in
the server component that renders it. Required, not optional-with-a-default: an optional
prop reintroduces the same silent fallback the first time someone forgets it. Where the
value also appears in COPY, carry the honest `null` separately — the math needs a number
it can always divide by, but a sentence must be able to say "we were not told"
([ADR: A fact owned by infrastructure is supplied at runtime or declared unknown](../adr/2026-07-26-infra-owned-facts-are-supplied-or-unknown.md)).

**It is not only about numbers.** `orgEmailDomain()` (`src/lib/auth.ts`) reads
`AUTH_ALLOWED_DOMAIN` to decide what a bare `@handle` expands to. `PartnersClient` calls
`deriveEmail` in the browser to decide which roster members are *you* — so the default
would have matched people at the dev fallback domain on any non-Google tenant, filtering
the "My partners" scope against addresses nobody has. Hence the required `emailDomain`
prop rather than a defaulted call (`autoknow-cvp`). Where the server can resolve the value
and hand it down as DATA it already computes — `untrackedContext`'s `defaultDomain` — that
is the same fix wearing different clothes, and it was already right.

**How we found out.** Deriving `CYCLES_PER_DAY` from the exported
`REFRESH_CRON_SCHEDULE` fixed the cron's per-cycle cap immediately — and would have left
the settings slider on the same page plotting the old hourly ceiling, because
`BudgetSlider` is a client component calling the very same `budgetGauge`. The unit tests
were green throughout: they run in node, where the variable exists.
