/** @jest-environment node */
// KebabMenu normalizes its children into uniform rows with DESCENDANT selectors
// (`.menu button`, `.menu div`, …). Those reach into a `<dialog>` nested in the
// panel and restyle it as a menu row: `.menu button` (0,1,1) outranks a caller's
// own `.cancelBtn` (0,1,0), so the button loses its border and fill, and
// `.menu div` flips the footer's `justify-content: flex-end` row into a stretched
// column. That shipped as #132 — a delete-confirmation dialog whose Cancel was
// invisible until hovered, in the one dialog whose entire job is to slow someone
// down before an irreversible delete.
//
// The stylesheet had WARNED about this in a comment ("render the dialog as a
// SIBLING, never a child") and the warning did not hold, because prose gates
// nothing (AGENTS lesson 2). The guard is `:where(:not(dialog *))` on every row
// rule — `:where()` contributes no specificity, so real menu rows still override
// callers' skins exactly as before, while a nested dialog is out of reach.
//
// This test exists because the failure is INVISIBLE to every other check: the
// markup is correct, the classes are present, the CSS module resolves, and
// nothing errors. Only the cascade is wrong, and only on screen.

import { readFileSync } from 'node:fs';

const FILE = 'src/components/KebabMenu.module.css';
const GUARD = ':where(:not(dialog';

/** Every selector in the file, one per entry, comments stripped. */
const selectors = (): string[] => {
  const css = readFileSync(FILE, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{/g)]
    .flatMap((m) => m[1].split(','))
    .map((s) => s.trim())
    .filter(Boolean);
};

describe('KebabMenu row rules cannot reach into a nested <dialog> (#132)', () => {
  it('guards every rule that descends from .menu', () => {
    // `.menu` alone styles the panel itself and needs no guard; anything that
    // reaches THROUGH it (descendant or child) can land inside a dialog.
    const reaching = selectors().filter((s) => /^\.menu[\s>]/.test(s));
    expect(reaching.length).toBeGreaterThan(0); // the rules still exist to guard

    const unguarded = reaching.filter((s) => !s.includes(GUARD));
    expect(unguarded).toEqual([]);
  });

  it('keeps the guard specificity-free, so menu rows still beat callers’ skins', () => {
    // `:is(:not(…))` or a bare `:not(…)` would ADD specificity and silently change
    // which rule wins elsewhere. The point of `:where()` is that it adds none.
    const bare = selectors().filter((s) => /^\.menu[\s>]/.test(s) && /(?<!:where\():not\(dialog/.test(s));
    expect(bare).toEqual([]);
  });
});
