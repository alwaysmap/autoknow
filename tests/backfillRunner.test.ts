/** @jest-environment node */
// scripts/db/backfill.sh is the ONLY path by which a backfill reaches the production
// database, and its three refusals ARE the control (ADR
// a-backfill-reaches-prod-through-an-allowlisted-dispatch-runner). They cannot be
// exercised in the place they matter without writing to prod, so they are pinned here —
// a guard nothing tests is a guard that quietly stops guarding.
//
// SAFETY, and please read it before adding a case: every test below supplies inputs the
// script must REJECT, and it rejects all of them before line ~90, where the Cloud SQL
// proxy starts and a Secret Manager password is read. A case with a valid backfill name
// AND a matching confirmation would run for real against `autoknow-prod-1895f1`. There is
// deliberately no happy-path test here, and there must never be one.

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SCRIPT = 'scripts/db/backfill.sh';

// The real production wiring, exactly as .github/workflows/db-backfill.yml passes it —
// so the confirmation these tests get wrong is the one an operator would have to get
// right. `autoknow-pg` (the segment after the last colon) is the expected answer.
const PROD_ENV = {
  INSTANCE_PROJECT: 'autoknow-prod-1895f1',
  INSTANCE_SQL_CONNECTION: 'autoknow-prod-1895f1:us-central1:autoknow-pg',
};

/** Run the script and return its exit code plus combined output. Never throws. */
const run = (env: Record<string, string>): { code: number; output: string } => {
  try {
    const output = execFileSync('bash', [SCRIPT], {
      env: { ...process.env, ...PROD_ENV, ...env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? -1, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
};

// A refusal must happen before anything is opened. These strings only appear in the
// script AFTER the guards, so their absence is the assertion that nothing was contacted.
const expectNothingWasOpened = (output: string): void => {
  expect(output).not.toContain('TARGET');
  expect(output).not.toContain('connected as');
  expect(output).not.toContain('RUNNING npm run');
};

describe('the backfill runner refuses before it connects', () => {
  it('rejects an arm name that is not on the allowlist', () => {
    const { code, output } = run({ BACKFILL: 'drop-everything', CONFIRM: 'autoknow-pg' });
    expect(code).toBe(1);
    expect(output).toContain("'drop-everything' is not an allowed arm");
    expectNothingWasOpened(output);
  });

  it('rejects a name carrying shell syntax rather than expanding it', () => {
    const { code, output } = run({ BACKFILL: 'owner-person; echo PWNED', CONFIRM: 'autoknow-pg' });
    expect(code).toBe(1);
    // QUOTED, not executed: the refusal echoes the name back, so the assertion is that
    // `echo PWNED` never RAN — i.e. no line of output is the word on its own.
    expect(output).toContain("'owner-person; echo PWNED' is not an allowed arm");
    expect(output).not.toMatch(/^PWNED$/m);
    expectNothingWasOpened(output);
  });

  it('rejects an allowed backfill when the confirmation is missing', () => {
    const { code, output } = run({ BACKFILL: 'owner-person', CONFIRM: '' });
    expect(code).toBe(1);
    expect(output).toContain('confirm must be exactly the Cloud SQL instance name');
    expectNothingWasOpened(output);
  });

  it('rejects an allowed backfill when the confirmation is merely close', () => {
    const { code, output } = run({ BACKFILL: 'owner-person', CONFIRM: 'autoknow' });
    expect(code).toBe(1);
    expect(output).toContain('confirm must be exactly the Cloud SQL instance name');
    expectNothingWasOpened(output);
  });
});

describe('the allowlist and the workflow dropdown agree', () => {
  // Two lists, deliberately: the script enforces, the workflow offers. They are useless
  // apart — an option the script rejects wastes a production dispatch, and a name only
  // the script knows is unreachable from the UI. Nothing but this notices them diverging.
  // Entries are `"name=npm-script"` pairs since #127 E9 gave the runner a read-only
  // `db:check:*` arm — so both halves are read, and both are asserted below.
  const readAllowed = (): { name: string; script: string }[] => {
    const sh = readFileSync(SCRIPT, 'utf8');
    const block = sh.match(/ALLOWED=\(([^)]*)\)/)?.[1] ?? '';
    return block
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').trim().replace(/^"|"$/g, ''))
      .filter(Boolean)
      .map((entry) => {
        const [name, ...script] = entry.split('=');
        return { name, script: script.join('=') };
      });
  };

  const readOptions = (): string[] => {
    const yml = readFileSync('.github/workflows/db-backfill.yml', 'utf8');
    const block = yml.match(/options:\n((?:\s+- .*\n)+)/)?.[1] ?? '';
    return block
      .split('\n')
      .map((line) => line.replace(/#.*$/, '').replace(/^\s*-\s*/, '').trim())
      .filter(Boolean);
  };

  it('offers exactly the arms the script will run', () => {
    const allowed = readAllowed();
    expect(allowed.length).toBeGreaterThan(0);
    expect(readOptions().sort()).toEqual(allowed.map((a) => a.name).sort());
  });

  // The script preflights this too, but only AFTER a dispatch has been fired at
  // production and rejected — which is a wasted trip to discover a typo in a shell
  // string. The likelier miss is the one this catches: an arm added here and the npm
  // script it names never added, or renamed later by someone who never opens this file.
  it('names an npm script that exists for every arm', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts as Record<string, string>;
    // The whole entry, not a boolean: a failure then prints which arm and what it asked
    // for, which is the entire diagnostic value of running this here rather than
    // discovering it from a rejected production dispatch.
    expect(readAllowed().filter(({ script }) => !(script in scripts))).toEqual([]);
  });

  // The runner prints a DIFFERENT reading of the exit code per namespace — a backfill's
  // leftovers are a report, a check exits non-zero because it FOUND something, a
  // remediation exits non-zero because it REFUSED and wrote nothing (ADR
  // a-remediation-arm-is-bounded-and-picks-by-rule, clause 3). Both `case` statements
  // switch on the npm script's prefix and fall through to the BACKFILL wording, so an arm
  // in a fourth namespace would be told its refusal was a partial write it can safely
  // resume. Silent, and wrong in the direction that matters.
  it('runs every arm in a namespace the runner has an epilogue for', () => {
    const sh = readFileSync(SCRIPT, 'utf8');
    // `db:backfill:*` is the documented DEFAULT (`*)`), so it needs no label; every other
    // namespace needs one in BOTH `case` statements — the failure epilogue and the
    // success one, which say different things.
    const missing = [...new Set(readAllowed().map(({ script }) => script.replace(/:[^:]*$/, ':*')))]
      .filter((ns) => ns !== 'db:backfill:*')
      .filter((ns) => sh.split(`${ns})`).length - 1 < 2);
    expect(missing).toEqual([]);
  });
});

describe('the workflow cannot be fired by pushing', () => {
  it('declares workflow_dispatch and nothing else', () => {
    const yml = readFileSync('.github/workflows/db-backfill.yml', 'utf8');
    // The trigger block runs from `on:` to the next top-level key.
    const triggers = yml.match(/\non:\n((?:[ \t].*\n|\n)*)/)?.[1] ?? '';
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).not.toMatch(/^\s{2}(push|schedule|pull_request|repository_dispatch):/m);
  });
});
