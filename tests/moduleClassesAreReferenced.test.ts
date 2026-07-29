/** @jest-environment node */
// A CSS-module class nobody references is DEAD WEIGHT THAT LOOKS ALIVE, and nothing in
// the toolchain says so: `styles.notARealClass` renders as no class and raises no error
// (the ui-design skill's "CSS-module misses are silent"), and the reverse — a rule whose
// class no longer appears in any component — is equally quiet. Seventy-six had
// accumulated across eleven module files by the time anyone counted (autoknow-zdw),
// including a whole retired surface's worth in PhaseTrack.module.css.
//
// Deleting them once fixes the instance; this fixes the pattern (AGENTS lessons 2 and 7)
// — a rule enforced in software needs no memory, and the next one cannot accumulate
// quietly.
//
// WHY DELETING IS SAFE, which is also why this ratchet can be strict: a module class
// only ever reaches the DOM through its import binding. There is no `composes:` in this
// repo, no computed `styles[expr]`, and no literal `className="…"` string — so a class
// no component names is applied to no element, and a rule for it can never match.
// globals.css's blanket `[class*="card"]` selectors do not change that: they match
// elements that already carry the class, and nothing carries this one.
//
// THE TRAP THIS SCAN EXISTS TO AVOID. The obvious implementation greps for `styles.foo`
// — and it is WRONG, because the local name is the importing file's choice. This repo
// has `dash.formHint`, `chrome.dagErrors`, `admin.inlineAction` and `styles.row`, all
// module classes. A `styles.`-only scan reports every one of those as dead, and acting
// on it deletes live CSS. So the binding is read per file, from the import itself. The
// second anti-vacuity test below is exactly that case.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { cssFiles } from './helpers/css';
import { sourceFiles, stripComments } from './helpers/sourceFiles';

/** Class names in SELECTOR position. Comments are blanked rather than cut so a sentence
 *  ABOUT a class is never mistaken for one, and `:global(...)` contents are dropped —
 *  those names belong to somebody else's stylesheet, not to this module. */
export function definedClasses(css: string): Set<string> {
  const blanked = css
    .replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '))
    .replace(/:global\(([^)]*)\)/g, (g) => ' '.repeat(g.length));
  const out = new Set<string>();
  for (const rule of blanked.matchAll(/([^{}]*)\{/g)) {
    const selector = rule[1].trim();
    // `@media`, keyframe stops and the like are not selectors.
    if (!selector || selector.startsWith('@') || /^(from|to)$/.test(selector) || /^\d/.test(selector)) continue;
    for (const cls of rule[1].matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) out.add(cls[1]);
  }
  return out;
}

/** What one source file references, per module it imports — keyed by RESOLVED path, so
 *  two `./page.module.css` in different routes stay separate. `opaque` marks a binding
 *  used as a whole object (spread, passed as a prop), where the keys read are unknowable
 *  from here and the module must not be judged. */
export function usedClasses(src: string, fromDir: string): Map<string, { names: Set<string>; opaque: boolean }> {
  const clean = stripComments(src);
  const out = new Map<string, { names: Set<string>; opaque: boolean }>();
  for (const imp of clean.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)) {
    const [, binding, rel] = imp;
    const key = resolve(fromDir, rel);
    const entry = out.get(key) ?? { names: new Set<string>(), opaque: false };
    for (const r of clean.matchAll(new RegExp(`\\b${binding}\\.([A-Za-z][A-Za-z0-9_]*)`, 'g'))) entry.names.add(r[1]);
    for (const r of clean.matchAll(new RegExp(`\\b${binding}\\[['"\`]([^'"\`]+)['"\`]\\]`, 'g'))) entry.names.add(r[1]);
    if (new RegExp(`\\.\\.\\.${binding}\\b`).test(clean)) entry.opaque = true;
    out.set(key, entry);
  }
  return out;
}

describe('every CSS-module class is referenced by a component', () => {
  it('finds no unreferenced class in src/**', () => {
    const used = new Map<string, { names: Set<string>; opaque: boolean }>();
    for (const file of sourceFiles('src')) {
      for (const [key, entry] of usedClasses(readFileSync(file, 'utf8'), dirname(file))) {
        const merged = used.get(key) ?? { names: new Set<string>(), opaque: false };
        entry.names.forEach((n) => merged.names.add(n));
        used.set(key, { names: merged.names, opaque: merged.opaque || entry.opaque });
      }
    }

    const offenders: string[] = [];
    for (const file of cssFiles('src').filter((f) => f.endsWith('.module.css'))) {
      const entry = used.get(resolve(file));
      // A module whose object is passed around whole cannot be judged from here. It is
      // skipped rather than guessed at — and there are none today, so this is a latch,
      // not a loophole in use.
      if (entry?.opaque) continue;
      for (const name of definedClasses(readFileSync(file, 'utf8'))) {
        if (!entry?.names.has(name)) offenders.push(`${file} → .${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // Anti-vacuity 1: the scan can actually see an unreferenced class.
  it('reports a class no component names', () => {
    const css = '.live { color: red; }\n.dead { color: blue; }\n';
    const used = usedClasses("import s from './x.module.css';\n<div className={s.live} />", '/app');
    const names = used.get('/app/x.module.css')!.names;
    expect([...definedClasses(css)].filter((n) => !names.has(n))).toEqual(['dead']);
  });

  // Anti-vacuity 2: THE bug this scan is written around. A `styles.`-only grep calls
  // `.formHint` dead here, and deleting on that answer removes live CSS.
  it('resolves a module imported under a name that is not `styles`', () => {
    const src = "import dash from '../ProjectStatusDashboard.module.css';\n<p className={dash.formHint} />";
    const names = usedClasses(src, '/app/components')!.get('/app/ProjectStatusDashboard.module.css')!.names;
    expect(names.has('formHint')).toBe(true);
  });

  // Anti-vacuity 3: a comment ABOUT a class is not a use of it, and `:global(...)` names
  // are not this module's to defend.
  it('ignores commented-out references and :global names', () => {
    const names = usedClasses("import s from './x.module.css';\n// <div className={s.ghost} />", '/app')
      .get('/app/x.module.css')!.names;
    expect(names.has('ghost')).toBe(false);
    expect([...definedClasses(':global(.mdx-thing) .real { color: red }')]).toEqual(['real']);
  });
});
