/** @jest-environment node */
// Knowledge notes (docs/knowledge/) are the home for findings — facts about how
// this system behaves that cost someone real time. Their whole value proposition
// is that they stay OUT of context until a trigger matches, which only works if
// the front matter is complete enough to route on without opening the note, and
// if the index stays honest. Neither is self-enforcing, so it is enforced here —
// the same reason tests/adrNaming.test.ts exists for ADRs (AGENTS lesson 2).
//
// The length cap is the load-bearing one: the failure mode for a "knowledge" doc
// is rotting into narrative, and a narrative that is recorded rots
// (ADR decision-records-over-detail-documents).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { citingFiles } from './helpers/citations';

const DIR = 'docs/knowledge';
/** Kebab slug, deliberately NOT dated: a note is current understanding, not a historical act. */
const NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const DATED = /^\d{4}-\d{2}-\d{2}-/;
const REQUIRED = ['title', 'status', 'updated', 'applies_to', 'symptoms', 'verified_by'];
const STATUSES = ['current', 'superseded', 'retired'];
/** A screen and a bit. Past this it is a document, and documents rot. */
const MAX_LINES = 60;

const notes = (): string[] =>
  existsSync(DIR) ? readdirSync(DIR).filter((f) => f.endsWith('.md') && f !== 'README.md') : [];

const read = (file: string): string => readFileSync(join(DIR, file), 'utf8');

/** The front-matter block only — never the body, which may legitimately contain `status:` in prose. */
const head = (file: string): string => {
  const m = /^---\n([\s\S]*?)\n---/.exec(read(file));
  return m ? m[1] : '';
};

const scalar = (file: string, key: string): string | null => {
  const m = new RegExp(`^${key}: *(.*)$`, 'm').exec(head(file));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};

/** True when the key is present AND carries a value — a scalar, or at least one list item. */
const filled = (file: string, key: string): boolean => {
  const h = head(file);
  const m = new RegExp(`^${key}: *(.*)((?:\\n[ \\t]+-.*)*)`, 'm').exec(h);
  if (!m) return false;
  return m[1].trim().length > 0 || /\n[ \t]+-\s*\S/.test(m[2]);
};

describe('knowledge notes', () => {
  it('names every note as an undated kebab slug — the date prefix belongs to ADRs', () => {
    // The filename is how a reader tells "immutable decision" from "living
    // finding" at a glance; blurring it makes the two directories one directory.
    expect(notes().filter((f) => !NAME.test(f) || DATED.test(f))).toEqual([]);
  });

  it('carries every front-matter key needed to route on WITHOUT opening the note', () => {
    const missing = notes().flatMap((f) => REQUIRED.filter((k) => !filled(f, k)).map((k) => `${f}: ${k}`));
    expect(missing).toEqual([]);
  });

  it('declares a known status and a real `updated` date', () => {
    const bad = notes().filter(
      (f) => !STATUSES.includes(scalar(f, 'status') ?? '') || !/^\d{4}-\d{2}-\d{2}$/.test(scalar(f, 'updated') ?? ''),
    );
    expect(bad).toEqual([]);
  });

  it('stays under the length cap — past a screen it is a document, and documents rot', () => {
    const long = notes()
      .map((f) => ({ file: f, lines: read(f).trimEnd().split('\n').length }))
      .filter((n) => n.lines > MAX_LINES);
    expect(long).toEqual([]);
  });

  it('resolves every knowledge path cited anywhere in the repo', () => {
    // Same rule as ADR citations: a pointer is only worth writing if it opens.
    const known = new Set([...notes(), 'README.md']);

    const broken: string[] = [];
    for (const f of citingFiles()) {
      // Template placeholders in the compound skill are written `<slug>.md`, and
      // `<` is outside the character class, so they never match in the first
      // place. That is deliberate: the exemption is in the placeholder's spelling
      // rather than in this check, so the check has no hole to walk through.
      for (const m of readFileSync(f, 'utf8').matchAll(/knowledge\/([A-Za-z0-9._-]+\.md)/g)) {
        if (!known.has(m[1])) broken.push(`${f} → ${m[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
