/** @jest-environment node */
// gh-255's ratchet (AGENTS lesson 2). The tenant domain is `AUTH_ALLOWED_DOMAIN`, read
// through `orgEmailDomain()`. Two ways to lose that, and prose stops neither:
//
//  1. Write the domain down again. A second constant beside the variable it should read
//     is how gh-255 happened, and it stayed invisible because the tests had the same
//     literal in them (they now build their fixtures from `orgEmailDomain()`).
//  2. Call `deriveEmail(x)` with ONE argument inside a `'use client'` file. Only
//     `NEXT_PUBLIC_*` is inlined into the browser bundle, so the default silently
//     resolves to the dev fallback there — forever, with nothing thrown or logged
//     (docs/knowledge/an-env-derived-default-is-the-fallback-inside-a-client-component.md).
//     The domain must arrive as a required prop instead, as PartnersClient's does.
//
// The domain to hunt for is IMPORTED, never spelled here: a scan carrying its own copy of
// the value it guards keeps passing after that value changes, which is the same
// both-sides-agree failure the whole bead is about.
//
// (2) is a text scan and inherits a text scan's limits: it reads the argument list to the
// matching paren, so it catches the shape that regresses — a bare call — and would miss
// `deriveEmail(...args)`. That is the trade every ratchet in tests/ makes.
import { readFileSync } from 'node:fs';
import { sourceFiles, stripComments } from './helpers/sourceFiles';
import { DEFAULT_EMAIL_DOMAIN } from '../src/lib/auth';

const ROOTS = ['src/app', 'src/components', 'src/lib'];
/** The one legitimate spelling: the named fallback constant in lib/auth itself. */
const DECLARATION = 'src/lib/auth.ts';
const QUOTED_DOMAIN = new RegExp(`['"\`]${DEFAULT_EMAIL_DOMAIN.replace(/\./g, '\\.')}['"\`]`);

const files = () => ROOTS.flatMap(sourceFiles);
const read = (f: string) => stripComments(readFileSync(f, 'utf8'));
const isClient = (f: string) => /^\s*(['"])use client\1/.test(readFileSync(f, 'utf8'));

/** The argument list of the call starting at `open` (the index of its `(`), without the
 *  enclosing parens. */
function argumentsAt(src: string, open: number): string {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '(') depth += 1;
    if (src[i] === ')') {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return src.slice(open + 1);
}

/** Whether an argument list holds more than one argument — a comma at its OWN nesting
 *  level, so `deriveEmail(pick(a, b))` still reads as one. */
function hasSecondArgument(args: string): boolean {
  let depth = 0;
  for (const c of args) {
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ',' && depth === 0) return true;
  }
  return false;
}

describe('the tenant domain is configuration, not a literal', () => {
  it('is written down in exactly one place — the named dev fallback', () => {
    const offenders = files().filter((f) => f !== DECLARATION && QUOTED_DOMAIN.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it("no client component takes deriveEmail's server-resolved default", () => {
    const offenders = files()
      .filter(isClient)
      .flatMap((f) => {
        const src = read(f);
        return [...src.matchAll(/\bderiveEmail\(/g)]
          .map((m) => argumentsAt(src, m.index! + m[0].length - 1))
          .filter((args) => !hasSecondArgument(args))
          .map((args) => `${f}: deriveEmail(${args.slice(0, 40)})`);
      });
    expect(offenders).toEqual([]);
  });
});
