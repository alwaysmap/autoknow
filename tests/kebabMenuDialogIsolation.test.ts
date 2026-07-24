/** @jest-environment node */
// Ratchet: KebabMenu's row rules must not be able to reach into a `<dialog>`
// nested in the panel. They did, and the delete-confirmation dialog shipped with
// a Cancel button invisible until hovered (#132).
//
// A ratchet rather than a comment because the comment is what failed: this file
// used to carry the rule as prose and a caller broke it anyway (AGENTS lesson 2).
// The incident, the mechanism, and how to recognise the next one:
// docs/knowledge/menu-row-normalizer-restyles-nested-dialogs.md.

import { readFileSync } from 'node:fs';
import { stripComments } from './helpers/css';

const FILE = 'src/components/KebabMenu.module.css';
// The guard's shape must follow the combinator, and the wrong one guards NOTHING:
// a `<dialog>` that is a direct child of .menu is not a DESCENDANT of a dialog, so
// `.menu > *:where(:not(dialog *))` still matches it. Checking for a common prefix
// would accept that, which is why each shape is spelled out.
const DESCENDANT_GUARD = ':where(:not(dialog *))';
const CHILD_GUARD = ':where(:not(dialog))';
// Any selector that reaches THROUGH .menu, wherever `.menu` sits in it — a rule
// written `:global(...) .menu button` reaches just as far as `.menu button`, and
// this file already uses that `:global(...)` wrapper form elsewhere.
const REACHES_THROUGH_MENU = /\.menu[\s>]/;
/** True when `.menu` is joined to what follows by a child combinator. */
const isChildRule = (selector: string) => /\.menu\s*>/.test(selector);

const selectors = (): string[] =>
  [...stripComments(readFileSync(FILE, 'utf8')).matchAll(/([^{}]+)\{/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .filter(Boolean);

describe('KebabMenu row rules cannot reach into a nested <dialog> (#132)', () => {
  it('guards every rule that reaches through .menu, with the shape its combinator needs', () => {
    // `.menu` on its own styles the panel and needs no guard; anything that
    // reaches through it can land inside a dialog.
    const reaching = selectors().filter((s) => REACHES_THROUGH_MENU.test(s));
    expect(reaching.length).toBeGreaterThan(0); // the rules still exist to guard

    const unguarded = reaching.filter(
      (s) => !s.includes(isChildRule(s) ? CHILD_GUARD : DESCENDANT_GUARD),
    );
    expect(unguarded).toEqual([]);
  });

  it('keeps the guard specificity-free, so menu rows still beat callers’ skins', () => {
    // A bare `:not(…)` or an `:is(:not(…))` wrapper ADDS specificity, silently
    // changing which rule wins elsewhere. Only `:where()` adds none.
    const bare = selectors().filter(
      (s) => REACHES_THROUGH_MENU.test(s) && /(?<!:where\():not\(dialog/.test(s),
    );
    expect(bare).toEqual([]);
  });
});
