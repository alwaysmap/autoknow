/** @jest-environment node */
// `scripts/ci/lint-compound.sh` is the gate that keeps compound records riding the
// PR that motivated them. Its acceptance bar (issue #131) was "verified by opening
// a throwaway PR both ways — a CI gate nobody has watched fail is not known to
// work". A throwaway PR proves it once, on one day, for whoever remembered to open
// it; this proves it on every run, which is the same argument the gate itself makes
// about records (AGENTS lesson 2 — enforce in software, not prose).
//
// Each case builds a real disposable git repo with a real base branch, because the
// script's whole job is reading `git diff` and `git log` over a range. Stubbing git
// would test the stub.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve('scripts/ci/lint-compound.sh');

type Result = { code: number; out: string };

/**
 * A repo with `main` as the base, one commit on a branch touching `files`, and
 * `messages` as that branch's commit messages. Returns the gate's verdict.
 */
const gate = (files: Record<string, string>, messages: string[]): Result => {
  const repo = mkdtempSync(join(tmpdir(), 'lint-compound-'));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  try {
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    writeFileSync(join(repo, 'README.md'), 'base\n');
    git('add', '-A');
    git('commit', '-qm', 'base');

    git('checkout', '-qb', 'work');
    mkdirSync(join(repo, 'scripts', 'ci'), { recursive: true });
    copyFileSync(SCRIPT, join(repo, 'scripts', 'ci', 'lint-compound.sh'));
    for (const [path, body] of Object.entries(files)) {
      mkdirSync(join(repo, path.replace(/\/[^/]+$/, '')), { recursive: true });
      writeFileSync(join(repo, path), body);
    }
    git('add', '-A');
    // The harness's copy of the script rides in the diff too. It is under
    // scripts/**, so it never trips the src/**|prisma/** filter — the cases stay
    // decided by `files` alone.
    git('commit', '-qm', messages[0] ?? 'change');
    for (const extra of messages.slice(1)) git('commit', '-q', '--allow-empty', '-m', extra);

    try {
      const out = execFileSync(join(repo, 'scripts', 'ci', 'lint-compound.sh'), [], {
        cwd: repo,
        encoding: 'utf8',
        env: { ...process.env, BASE_REF: 'main' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { code: 0, out };
    } catch (e) {
      const err = e as { status: number; stdout: string; stderr: string };
      return { code: err.status, out: `${err.stdout}${err.stderr}` };
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
};

const SRC = { 'src/lib/thing.ts': 'export const a = 1;\n' };

describe('lint-compound: the pre-merge compound gate', () => {
  it('passes a PR that touches no app code — a docs-only change has nothing to declare', () => {
    expect(gate({ 'docs/notes.md': 'hi\n' }, ['tidy docs']).code).toBe(0);
  });

  it('FAILS a src/** PR whose commits carry no compound: line, and names both accepted forms', () => {
    const { code, out } = gate(SRC, ['feat: a thing']);
    expect(code).toBe(1);
    expect(out).toMatch(/compound: docs\/adr\/YYYY-MM-DD-slug\.md/);
    expect(out).toMatch(/compound: none — /);
  });

  it('FAILS a prisma/** PR the same way — schema changes are substantive too', () => {
    expect(gate({ 'prisma/schema.prisma': 'model A { id Int @id }\n' }, ['db: add A']).code).toBe(1);
  });

  it('FAILS a bare `compound: none` — a declaration with no reason is a keystroke', () => {
    const { code, out } = gate(SRC, ['feat: a thing', 'compound: none']);
    expect(code).toBe(1);
    expect(out).toMatch(/must say WHY/);
  });

  it('passes `compound: none — <reason>`', () => {
    expect(gate(SRC, ['feat: a thing\n\ncompound: none — pure refactor, no new knowledge']).code).toBe(0);
  });

  it('FAILS a named record that is not in the diff — otherwise the line is a rubber stamp', () => {
    const { code, out } = gate(SRC, ['feat: a thing\n\ncompound: docs/adr/YYYY-MM-DD-absent.md']);
    expect(code).toBe(1);
    expect(out).toMatch(/NOT in this PR's diff/);
  });

  it('passes a named record that ships in the same diff', () => {
    const files = { ...SRC, 'docs/adr/YYYY-MM-DD-present.md': '# a decision\n' };
    expect(gate(files, ['feat: a thing\n\ncompound: docs/adr/YYYY-MM-DD-present.md']).code).toBe(0);
  });

  it('accepts the declaration from any commit in the range, not just the last', () => {
    expect(gate(SRC, ['compound: none — nothing learned', 'follow-up tidy']).code).toBe(0);
  });
});
