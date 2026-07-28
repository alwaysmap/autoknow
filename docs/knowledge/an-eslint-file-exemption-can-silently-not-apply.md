---
title: A file-scoped eslint exemption can silently not apply — a Next `[id]` path is a glob, and a later block REPLACES the rule
status: current
updated: 2026-07-27
applies_to:
  - eslint.config.mjs
symptoms:
  - a file listed in an eslint `files` exemption still reports the rule it was exempted from
  - a rule family you took away in one block is back on for a file listed in two blocks
  - a `no-restricted-syntax` selector stops firing in a file nobody exempted
verified_by: 'eslint.config.mjs MAY_NAME_THE_OWNER_TEXT / MAY_NAME_CACHE_AND_OWNER_TEXT (#127 E7); the `[id]` miss reproduced as a lint error on src/app/programs/[id]/actions.ts'
---

# A file-scoped eslint exemption can silently not apply

**The lesson.** This config exempts files from `no-restricted-syntax` families by
listing paths in a `files` array. Two things make such an entry do something other
than what it reads as, and neither announces itself:

1. **`files` entries are GLOBS, so a Next dynamic segment is a character class.**
   `"src/app/programs/[id]/actions.ts"` matches a path with a single `i` or `d`
   where `[id]` is written — i.e. nothing this repo contains. Escape it:
   `"src/app/programs/\\[id\\]/actions.ts"`.
2. **A later block REPLACES `no-restricted-syntax`; it does not merge.** So if a
   file appears in two exemption lists, the last block wins *entirely*, and every
   family the earlier block took away comes back on.

**Why it bites.** Both failures are directional. The `[id]` miss usually fails
loudly — the file still trips the rule — but the same pattern in a `globalIgnores`
or a rule-*widening* block fails silently, because "matched nothing" and "matched
and allowed" look identical from the outside. The overlap trap always fails
silently: the file lints clean, so nothing tells you a family stopped being
enforced there. The config's per-block comments name which families each block
drops precisely because that is the only place the answer is written down.

**What to do.** Escape brackets in any `files`/`ignores` entry naming a Next
dynamic route. When a file needs exemption from two different families, do not
merge the lists — keep one block per exemption set and spell the overlap out, as
`MAY_NAME_THE_CACHE` / `MAY_NAME_THE_OWNER_TEXT` /
`MAY_NAME_CACHE_AND_OWNER_TEXT` do. Then prove the guard still fires: drop a
throwaway file containing one violation per selector into a NON-exempt directory,
run `npx eslint` on it, and check the count matches the number of selectors — a
guard nobody has seen fail is a guard that may not work.

**How we found out.** Adding the `ownerName` family in #127 E7. The `[id]`
exemption was written the obvious way and lint stayed red on the one file it was
supposed to release; the overlap was caught while writing the block, because
`schemas.ts` and `seed.ts` were already in `MAY_NAME_THE_CACHE` and a single
combined list placed after it would have handed them back the cache family.
