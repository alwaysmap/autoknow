/** @jest-environment node */
// ADRs were numbered `0001…` until 2026-07-21, and the scheme failed the first time
// two branches wrote one concurrently: both took the next free number, and because
// the slugs differed (`0005-session-…` vs `0005-retiring-…`) git merged them with NO
// conflict — two records sharing an id, two index rows claiming it, and nothing to
// notice until someone read both. A sequential id needs a central allocator; a repo
// with concurrent branches has none.
//
// Dates need no allocator, so that is the convention (docs/adr/README.md). This
// keeps it true, and keeps the index honest, because neither is self-enforcing.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { citingFiles } from './helpers/citations';

const DIR = 'docs/adr';
const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(-[a-z0-9]+)*\.md$/;

const records = (): string[] => readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md');
const frontmatter = (file: string, key: string): string | null => {
  const m = new RegExp(`^${key}: *(.*)$`, 'm').exec(readFileSync(join(DIR, file), 'utf8'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

describe('ADR naming and index', () => {
  it('names every record YYYY-MM-DD-slug.md — never a sequence number', () => {
    expect(records().filter((f) => !NAME.test(f))).toEqual([]);
  });

  it("agrees with each record's own `date:` frontmatter", () => {
    const mismatched = records()
      .map((f) => ({ file: f, prefix: NAME.exec(f)?.[1], declared: frontmatter(f, 'date') }))
      .filter((r) => r.prefix !== r.declared);
    expect(mismatched).toEqual([]);
  });

  it('resolves every ADR path cited anywhere in the repo', () => {
    // A citation is only worth writing if it opens. This caught an ESLint message
    // pointing developers at `0005-identity-accessor-carries-every-displayed-field.md`
    // — a file that never existed, shipped and unnoticed because nothing checked.
    const known = new Set([...records(), 'README.md']);

    const broken: string[] = [];
    for (const f of citingFiles()) {
      for (const m of readFileSync(f, 'utf8').matchAll(/adr\/([A-Za-z0-9._-]+\.md)/g)) {
        // Template placeholders (`YYYY-MM-DD-slug.md` in the compound skill) are
        // spelled with capitals; real slugs never are. Skip them, not the check.
        if (/[A-Z]/.test(m[1]) && !known.has(m[1])) continue;
        if (!known.has(m[1])) broken.push(`${f} → ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('supersession and extension point at a real record, by slug', () => {
    // `extends`/`extended-by` are the same machinery for the case that is NOT a
    // reversal: the old record still holds but no longer describes the whole
    // system, so it must carry a forward pointer or it quietly starts lying
    // (AGENTS lesson 10). Filling a forward field is additive, not a history edit
    // — the same reason `superseded-by` is documented as filled in later.
    const known = new Set(records());
    const bad: string[] = [];
    for (const f of records()) {
      for (const key of ['supersedes', 'superseded-by', 'extends', 'extended-by']) {
        const v = frontmatter(f, key);
        if (!v) continue;
        // A slug, resolved against the directory — never a bare number, which is
        // the identifier this convention exists to abolish.
        if (/^\d+$/.test(v) || ![...known].some((r) => r.slice(11, -3) === v)) bad.push(`${f}: ${key}=${v}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
