/** @jest-environment node */
// `scripts/ci/lint-compound.sh` is the gate that keeps compound records riding the
// PR that motivated them, and `scripts/hooks/compound-merge-gate.sh` is its local
// echo on `gh pr merge`. Issue #131's acceptance bar was "verified by opening a
// throwaway PR both ways — a CI gate nobody has watched fail is not known to
// work". A throwaway PR proves it once, on one day, for whoever remembered to open
// it; this proves it on every run, which is the same argument the gate itself makes
// about records (AGENTS lesson 2 — enforce in software, not prose).
//
// Each case builds a real disposable git repo with a real base branch, because the
// script's whole job is reading `git diff` and `git log` over a range. Stubbing git
// would test the stub — and would have missed the `log A...B` symmetric-difference
// bug that the `onBaseSinceFork` case below now pins.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

// Paths inside the disposable repo, and the real files copied in to fill them.
const GATE = 'scripts/ci/lint-compound.sh';
const HOOK = 'scripts/hooks/compound-merge-gate.sh';
const COPIED = [GATE, HOOK, 'scripts/ci/lib.sh'].map((p) => [p, resolve(p)] as const);

// The harness must not inherit a contributor's global git config: `commit.gpgsign`
// or a `core.hooksPath` would break every case for reasons unrelated to the gate.
const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };

type Result = { code: number; out: string };
type Harness = { repo: string; run: (script: string, env?: Record<string, string>, stdin?: string) => Result };
type Case = {
  /** Files the branch adds, path → contents. Only src/** and prisma/** are substantive. */
  files?: Record<string, string>;
  /** Commit messages on the branch; the first carries `files`, the rest are empty commits. */
  messages: [string, ...string[]];
  /** Messages committed onto `main` AFTER the branch forked — the diverged-base case. */
  onBaseSinceFork?: string[];
};

const write = (repo: string, path: string, body: string) => {
  mkdirSync(join(repo, dirname(path)), { recursive: true });
  writeFileSync(join(repo, path), body);
};

/** Build the repo described by `c`; returns its path and a runner for scripts inside it. */
const build = (c: Case): Harness => {
  const repo = mkdtempSync(join(tmpdir(), 'lint-compound-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: GIT_ENV });

  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Test');
  write(repo, 'README.md', 'base\n');
  git('add', '-A');
  git('commit', '-qm', 'base');

  git('checkout', '-qb', 'work');
  // The harness's copies of the scripts ride in the diff too. They are under
  // scripts/**, so they never trip the src/**|prisma/** filter — the cases stay
  // decided by `files` alone.
  for (const [inRepo, real] of COPIED) {
    mkdirSync(join(repo, dirname(inRepo)), { recursive: true });
    copyFileSync(real, join(repo, inRepo));
  }
  for (const [path, body] of Object.entries(c.files ?? {})) write(repo, path, body);
  git('add', '-A');
  git('commit', '-qm', c.messages[0]);
  for (const extra of c.messages.slice(1)) git('commit', '-q', '--allow-empty', '-m', extra);

  // Commits that landed on the base after this branch forked. `git log base..HEAD`
  // must not see them; `git log base...HEAD` would.
  if (c.onBaseSinceFork?.length) {
    git('checkout', '-q', 'main');
    for (const m of c.onBaseSinceFork) git('commit', '-q', '--allow-empty', '-m', m);
    git('checkout', '-q', 'work');
  }

  const run = (script: string, env: Record<string, string> = {}, stdin?: string): Result => {
    try {
      const out = execFileSync(join(repo, script), [], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...GIT_ENV, BASE_REF: 'main', ...env },
        input: stdin ?? '',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: `${err.stdout}${err.stderr}` };
    }
  };
  return { repo, run };
};

/** Build, hand the harness to `fn`, and always delete the repo afterwards. */
const withRepo = <T,>(c: Case, fn: (h: Harness) => T): T => {
  const h = build(c);
  try {
    return fn(h);
  } finally {
    rmSync(h.repo, { recursive: true, force: true });
  }
};

const gate = (c: Case): Result => withRepo(c, ({ run }) => run(GATE));

const hook = (c: Case, command: string): Result =>
  withRepo(c, ({ repo, run }) => run(HOOK, {}, JSON.stringify({ tool_input: { command }, cwd: repo })));

const SRC = { 'src/lib/thing.ts': 'export const a = 1;\n' };
const ok = (messages: [string, ...string[]], files = SRC) => expect(gate({ files, messages }).code).toBe(0);

describe('lint-compound: the pre-merge compound gate', () => {
  it('passes a PR that touches no app code — a docs-only change has nothing to declare', () => {
    expect(gate({ files: { 'docs/notes.md': 'hi\n' }, messages: ['tidy docs'] }).code).toBe(0);
  });

  it('FAILS a src/** PR whose commits carry no compound: line, and names both accepted forms', () => {
    const { code, out } = gate({ files: SRC, messages: ['feat: a thing'] });
    expect(code).toBe(1);
    expect(out).toMatch(/compound: docs\/adr\/YYYY-MM-DD-slug\.md/);
    expect(out).toMatch(/compound: none — /);
  });

  it('FAILS a prisma/** PR the same way — schema changes are substantive too', () => {
    const files = { 'prisma/schema.prisma': 'model A { id Int @id }\n' };
    expect(gate({ files, messages: ['db: add A'] }).code).toBe(1);
  });

  it('accepts the declaration from any commit in the range, not just the last', () => {
    ok(['compound: none — nothing learned', 'follow-up tidy']);
  });

  describe('`none` must carry a real reason', () => {
    it('passes `none — <reason>`', () => ok(['feat: x\n\ncompound: none — pure refactor, no new knowledge']));

    it.each([
      ['en dash', 'compound: none – nothing to record'],
      ['hyphen', 'compound: none - nothing to record'],
      ['colon', 'compound: none: nothing to record'],
      ['bare space', 'compound: none nothing to record'],
    ])('accepts a %s separator', (_label, line) => ok([`feat: x\n\n${line}`]));

    it('is case-insensitive on the key', () => ok(['feat: x\n\nCompound: NONE — shouted, but a judgement']));

    it.each([
      ['bare', 'compound: none'],
      ['punctuation only', 'compound: none.'],
      ['dash only', 'compound: none —'],
    ])('FAILS a %s declaration — that is a keystroke, not a judgement', (_label, line) => {
      const { code, out } = gate({ files: SRC, messages: [`feat: x\n\n${line}`] });
      expect(code).toBe(1);
      expect(out).toMatch(/must say WHY/);
    });
  });

  describe('a named record must ship in the same diff', () => {
    it('passes a record present in the diff', () => {
      const files = { ...SRC, 'docs/adr/YYYY-MM-DD-present.md': '# a decision\n' };
      ok(['feat: x\n\ncompound: docs/adr/YYYY-MM-DD-present.md'], files);
    });

    it('passes a comma-separated list when every path is present', () => {
      const files = { ...SRC, 'docs/adr/YYYY-MM-DD-present.md': '# d\n', 'AGENTS.md': '# rules\n' };
      ok(['feat: x\n\ncompound: docs/adr/YYYY-MM-DD-present.md, AGENTS.md'], files);
    });

    it('FAILS a record absent from the diff — otherwise the line is a rubber stamp', () => {
      const { code, out } = gate({ files: SRC, messages: ['feat: x\n\ncompound: docs/adr/YYYY-MM-DD-absent.md'] });
      expect(code).toBe(1);
      expect(out).toMatch(/NOT in this PR's diff/);
    });

    it('FAILS a glob — expanding it against the worktree would rubber-stamp by construction', () => {
      expect(gate({ files: SRC, messages: ['feat: x\n\ncompound: src/*'] }).code).toBe(1);
    });
  });

  it('ignores declarations that landed on the base after this branch forked', () => {
    // `git log base...HEAD` (three dots) reads the base side too, so a merged PR's
    // record — absent from THIS diff — would fail this PR. Two dots is the fix, and
    // this is the case that pins it: without `onBaseSinceFork` the bug is invisible.
    expect(
      gate({
        files: SRC,
        messages: ['feat: x\n\ncompound: none — nothing learned'],
        onBaseSinceFork: ['other PR\n\ncompound: docs/adr/YYYY-MM-DD-someone-elses.md'],
      }).code,
    ).toBe(0);
  });

  it('FAILS loudly when BASE_REF does not resolve, rather than passing on an empty diff', () => {
    const { code, out } = withRepo({ files: SRC, messages: ['feat: x'] }, ({ run }) =>
      run(GATE, { BASE_REF: 'origin/' }),
    );
    expect(code).toBe(1);
    expect(out).toMatch(/does not resolve/);
  });
});

describe('compound-merge-gate: the local PreToolUse hook', () => {
  const MERGE = 'gh pr merge 1 --squash';
  const undeclared: Case = { files: SRC, messages: ['feat: x'] };

  it('passes through a command that is not `gh pr merge`', () => {
    expect(hook(undeclared, 'ls -la').code).toBe(0);
  });

  it('DENIES `gh pr merge` with exit 2 when the branch has no declaration', () => {
    const { code, out } = hook(undeclared, MERGE);
    expect(code).toBe(2);
    expect(out).toMatch(/compound: none — /);
  });

  it('allows the merge once the branch declares', () => {
    expect(hook({ files: SRC, messages: ['feat: x\n\ncompound: none — nothing learned'] }, MERGE).code).toBe(0);
  });

  it('FAILS OPEN when the gate script itself is broken, rather than walling off every merge', () => {
    // The realistic break is bash 3.2 (stock macOS /bin/bash), where `mapfile` does
    // not exist and the gate exits 127. Blocking on that would put a wall across
    // `gh pr merge` in every clone — far worse than a missed prompt.
    const { code } = withRepo(undeclared, ({ repo, run }) => {
      writeFileSync(join(repo, GATE), '#!/usr/bin/env bash\nexit 127\n');
      chmodSync(join(repo, GATE), 0o755);
      return run(HOOK, {}, JSON.stringify({ tool_input: { command: MERGE }, cwd: repo }));
    });
    expect(code).toBe(0);
  });
});
