/** @jest-environment node */
// A scroll that moves the DOCUMENT must go through `useSteadyPageScroll`, which halts
// page motion on a press. Without it, a scroll stepping between a press and its release
// retargets the click to a common ancestor and the handler never runs — silently
// (autoknow-e1h; docs/knowledge/a-page-scroll-between-press-and-release-loses-the-click.md).
//
// THIS REPLACED AN E2E TEST, deliberately. That test staged the whole gesture in a real
// browser — synthesise a scroll, press, assert the click landed — and cost three CI
// failures across three PRs, every one a defect in the test rather than a product
// regression (autoknow-dxa). Staging an animation race from Playwright is racy by
// construction: the press lands at an arbitrary point in the scroll, so the assertion is
// either tuned to one engine or vacuous. Attempts to reduce it to a "wiring only" check
// failed the same way — chromium froze at ≤11px, webkit at 115, 317 and 551 across runs,
// all of them CORRECT behaviour, differing only in when the press arrived.
//
// The rule is static, so this checks it statically: every call site, instantly, with no
// browser. It also covers strictly more than the e2e test did, which could only ever
// exercise the one scroll on the phase rail. The guard's own behaviour is unit-tested in
// tests/useSteadyPageScroll.test.tsx (AGENTS lesson 2 — enforce it, don't write it down).

import { readFileSync } from 'node:fs';

import { sourceFiles, stripComments } from './helpers/sourceFiles';

/** The hook itself is where the real `window.scrollTo` lives, so it is not a call site. */
const HOOK = 'src/lib/useSteadyPageScroll.ts';
/** Anything that can move the scroll ROOT. `scrollPageTo(...)` is the guarded path. */
const SCROLLS = /\.scrollIntoView\(|window\.scrollTo\(|window\.scrollBy\(/g;
/**
 * An INNER scrollport is exempt: `scroll-behavior: smooth` is set on the scroll root
 * only, so those scrolls are instant and cannot straddle a gesture. `block: 'nearest'`
 * is the tell, and it is the hook's own documented carve-out.
 *
 * The tell reads a RAW `scrollIntoView` only, which is the whole scan — a guarded
 * `scrollPageTo(…)` never matches `SCROLLS` and so never reaches this exemption. That
 * matters because 'nearest' is no longer exclusively an inner-scrollport word: the
 * phase rail asks for it on a DOCUMENT scroll too, to move the page by the minimum
 * that brings an expanded card back on screen (autoknow-ff7). It goes through the
 * guard like every other page scroll, so the two uses stay distinguishable by the call
 * they make rather than by the options they pass.
 */
const INNER = /block:\s*'nearest'/;

describe('document scrolls go through the guard', () => {
  it('has no raw document scroll outside `useSteadyPageScroll`', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles('src')) {
      if (file === HOOK) continue;
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(SCROLLS)) {
        // The options object follows the call; read enough of it to see the carve-out,
        // and stop at the statement end so a LATER call's options cannot vouch for this
        // one (docs/knowledge/source-scan-over-jsx-props-truncates-at-an-arrow.md is the
        // same trap in JSX).
        const tail = src.slice(m.index, src.indexOf(';', m.index) + 1 || m.index + 120);
        if (!INNER.test(tail)) offenders.push(`${file} → ${m[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
