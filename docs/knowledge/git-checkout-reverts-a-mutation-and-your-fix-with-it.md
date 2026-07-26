---
title: Reverting a mutation with `git checkout <file>` restores from the INDEX, silently taking your uncommitted fix with it
status: current
updated: 2026-07-26
applies_to:
  - mutation-testing a new guard or ratchet
  - git checkout -- <file>
symptoms:
  - the "restored" baseline run after a mutation is still red
  - a test you just watched pass now fails and nothing you did explains it
  - a fix you wrote is missing from the file and git status is clean
verified_by: 'PR #170 — the isTruncated fix in src/lib/refresh.ts was reverted this way and caught only by the baseline re-run'
---

# Reverting a mutation with `git checkout <file>` restores from the INDEX, taking your uncommitted fix with it

**The lesson.** Mutation testing is the house discipline here: plant the bug the
guard is supposed to catch, confirm the guard goes red, restore, confirm green. The
restore step is usually written `git checkout <file>` — and that restores the file
from the **index**, not from the state it was in a moment ago. If the fix you are
testing is not yet staged, `git checkout` throws it away along with the mutation,
and reports nothing.

**Why it bites.** The mutation and the fix live in the same file, which is the
normal case: you fix `refresh.ts`, then mutate `refresh.ts` to prove the new test
catches a regression. Both edits are uncommitted, so the index still holds the
*pre-fix* version. `git checkout` cannot distinguish them — it reverts to the last
staged content and both disappear together. Nothing errors; `git status` goes clean,
which reads as success.

The damage is worse than losing an edit, because of what it does to the *evidence*:
the run after the restore is your baseline, and a green baseline is what licenses
you to say "mutation caught, fix intact". Here the baseline goes red for a reason
that has nothing to do with the mutation, and the obvious reading — "my restore
didn't work, let me run it again" — leaves the fix gone.

**What to do.**

- **Snapshot outside git.** Copy the file to the scratchpad before mutating and copy
  it back, so the restore is independent of what git thinks the file should be.
- **Or stage the fix first** (`git add <file>`), so the index *is* the state you want
  to return to. Then `git checkout <file>` does the right thing.
- **Always re-run the baseline after restoring, and read it.** A green baseline is
  the only proof the mutation was undone. If it is red, the restore is the suspect —
  check the file for your fix before re-running anything.
- The same trap applies to `git stash` around a mutation and to `git restore`.

**How we found out.** #56 added `isTruncated` and called it at the three writers of
`ContextUrl.truncated`. Mutation-testing the new guard by re-spelling the comparison
by hand in `refresh.ts` worked — the guard went red as designed — but the
`git checkout` afterwards reverted the whole fix, import included. The baseline run
was still red, which is the only reason it surfaced; every gate before that point
had been green with the fix present, so nothing else would have caught it before the
PR merged.
