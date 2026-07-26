---
title: A ts-node script can import src/lib — but only with a CommonJS --compilerOptions override
status: current
updated: 2026-07-26
applies_to:
  - scripts/**/*.ts
  - adding an npm script that reuses application logic
symptoms:
  - "ERR_MODULE_NOT_FOUND naming a real file under src/lib, with no extension"
  - "MODULE_TYPELESS_PACKAGE_JSON warning, then 'Reparsing as ES module'"
  - "TS5097: An import path can only end with a '.ts' extension when allowImportingTsExtensions is enabled"
  - about to copy logic into a script because importing it "doesn't work"
verified_by: 'package.json "db:backfill:owner-person"; scripts/db/backfill-owner-person.ts; PR for #127 E6 (scratch-DB run linked 3 / reported 2)'
---

# A ts-node script can import src/lib — but only with a CommonJS `--compilerOptions` override

**The lesson.** `ts-node scripts/foo.ts` cannot resolve `import { x } from '../../src/lib/y'`,
and neither can it resolve `'../../src/lib/y.ts'`. Both fail, in different ways, and the
natural conclusion — "scripts can't import the app, so I'll copy the function" — is wrong.
Add the override to the npm script and the extensionless import resolves:

```json
"db:backfill:owner-person": "ts-node --compilerOptions '{\"module\":\"commonjs\",\"moduleResolution\":\"node\"}' scripts/db/backfill-owner-person.ts"
```

**Why it bites.** `tsconfig.json` is configured for Next — `"module": "esnext"`,
`"moduleResolution": "bundler"` — because a bundler resolves extensionless specifiers for
the app. ts-node honours that config, so it hands node an ES module, and node's ESM
resolver requires a file extension on every relative import; `src/lib` has none. Adding
`.ts` then trips TypeScript instead (`allowImportingTsExtensions` is off, and turning it
on is a whole-repo change to satisfy one script). The override is per-invocation: it
compiles that one entry point as CommonJS, where extensionless resolution is the norm,
and the import chain underneath it (`./db`, `./people`, …) resolves too.

**What to do.** Put the logic in `src/lib/*.ts`, where the jest DB-test pattern can reach
it (`tests/ownerBackfill.test.ts`), and make the script a thin runner that imports it with
the override on the npm script. One implementation, one set of tests. Note the runner must
still be a runner: `src/lib` modules carrying `import 'server-only'` (e.g. `lib/profiles`)
will not load under ts-node at all, so a script needs logic that does not depend on them.

**How we found out.** `scripts/db/audit-embeddings.ts` hit the ESM failure and concluded
the import was impossible, so it reimplemented the check by another route and left a
comment saying an exact recompute "was dropped" because ts-node cannot import
`src/lib/embedding-fallback`. #127 E6 needed the opposite outcome — its backfill has to
resolve a name to a person through the *same* matcher the write paths use, and a second
copy of that matcher is the defect it exists to fix (AGENTS lesson 7) — so the constraint
got tested rather than believed. `require()` instead of `import` gets one level deeper and
then fails on the imported module's own imports, which is the misleading part: it looks
like the app tree is unloadable when only the module format is wrong.
