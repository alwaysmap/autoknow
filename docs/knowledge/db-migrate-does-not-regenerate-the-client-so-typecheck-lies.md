---
title: '`npm run db:migrate` does not regenerate the Prisma client, so `typecheck` passes against the OLD schema types'
status: current
updated: 2026-07-27
applies_to:
  - prisma/schema.prisma
  - npm run db:migrate
symptoms:
  - a local `npm run typecheck` is green and the same check fails in CI
  - a removed field still satisfies `WhereUniqueInput`, or a removed model still resolves
  - CI reports TS2322/TS2339 on a Prisma type for code you did not touch
verified_by: '#127 E9 — `tests/projects_flow.spec.ts` kept a `findUniqueOrThrow({ where: { email } })` through a green local gate; probed directly (client mtime unchanged across an applying `db:migrate`)'
---

# `npm run db:migrate` does not regenerate the Prisma client, so `typecheck` passes against the OLD schema types

**The lesson.** After editing `prisma/schema.prisma`, run **`npm run db:generate`** before
believing `npm run typecheck`. `npm run db:migrate` (`prisma migrate dev`) applies the
migration and leaves `node_modules/.prisma/client` exactly as it was — verified by
timestamp across a run that applied a migration, and again across a no-op one. Until you
regenerate, every Prisma type `tsc` checks against describes the schema you just changed
away from.

**Why it bites.** It is silent and it is inverted: the gate goes GREEN. Worse, it is
green *specifically* for the code the change should have broken — remove a `@unique` and
`findUnique({ where: { thatField } })` still compiles, because the stale
`WhereUniqueInput` still lists it. CI does not share the illusion: `npm ci` regenerates
via the bootstrap hook (ADR `npm-ci-bootstraps-a-checkout-but-nothing-depends-on-it`), so
CI compiles against the new schema and fails on a file the author never opened. The whole
local gate is then evidence of nothing.

**What to do.** Any change to `prisma/schema.prisma` gets this order:

```bash
npm run db:migrate -- --name <change> --create-only   # write the SQL
npm run db:migrate                                    # apply it
npm run db:generate                                   # <- the step that is NOT implied
npm run typecheck
```

And when the change REMOVES something — a field, a `@unique`, a model — grep for its
readers rather than trusting the compiler to find them, because a stale client is exactly
a compiler that will not.

**How we found out.** #127 E9 dropped `Person.email @unique`. `npm run typecheck` was green
twice, and a review found `tests/projects_flow.spec.ts:149` still calling
`prisma.person.findUniqueOrThrow({ where: { email: … } })` — which cannot compile against
the new client. One `npm run db:generate` turned the green into the TS2322 it should have
been all along.
