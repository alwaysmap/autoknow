/** @jest-environment node */
// A CSS-module class nobody references is DEAD WEIGHT THAT LOOKS ALIVE, and nothing in
// the toolchain says so: `styles.notARealClass` renders as no class and raises no error
// (the ui-design skill's "CSS-module misses are silent"), and the reverse — a rule whose
// class left the component — is just as quiet. Seventy-six had accumulated across eleven
// module files by the time anyone counted (autoknow-zdw), most of them residue of
// surfaces that had already been retired.
//
// Deleting them once fixes the instance; this fixes the pattern (AGENTS lessons 2 and 7)
// — a rule enforced in software needs no memory, and the next one cannot accumulate
// quietly.
//
// WHY DELETING IS SAFE, which is also why this ratchet can be strict: a module class only
// ever reaches the DOM through its import binding. There is no `composes:` in this repo,
// no computed `styles[expr]`, and no MODULE class ever named as a literal string (the one
// literal className in `src` is a GLOBAL class, `dark-theme`). So a class no component
// names is applied to no element, and a rule for it can never match. globals.css's
// blanket `[class*="card"]` selectors do not change that: they style elements that
// already carry the class, and nothing carries these.
//
// THE TRAP THIS SCAN EXISTS TO AVOID. The obvious implementation greps for `styles.foo`
// — and it is WRONG, because the local name is the importing file's choice. This repo has
// `dash.formHint`, `chrome.dagErrors` and `admin.inlineAction` as well as `styles.row`. A
// `styles.`-only scan reports every one of those as dead, and acting on it deletes live
// CSS. So the binding is read per file, from the import itself, and the second
// anti-vacuity test below pins that case so nobody re-derives the naive version.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { blankComments, cssFiles } from './helpers/css';
import { sourceFiles, stripComments } from './helpers/sourceFiles';

const SRC = 'src';

/** What one module's classes are known to be used as. `opaque` marks a binding handed
 *  around whole, where the keys read are unknowable from here. */
type ModuleUse = { names: Set<string>; opaque: boolean };

/** Class names in SELECTOR position. Comments are blanked (rather than cut) through the
 *  shared helper, so a sentence ABOUT a class can never be read as one; `:global(...)`
 *  contents are dropped too, since those names belong to somebody else's stylesheet. */
export function definedClasses(css: string): Set<string> {
  const blanked = blankComments(css).replace(/:global\(([^)]*)\)/g, (g) => ' '.repeat(g.length));
  const out = new Set<string>();
  for (const match of blanked.matchAll(/([^{}]*)\{/g)) {
    const selector = match[1].trim();
    // `@media`, keyframe stops and the like are not selectors.
    if (!selector || selector.startsWith('@') || /^(from|to)$/.test(selector) || /^\d/.test(selector)) continue;
    for (const cls of selector.matchAll(/\.([A-Za-z][A-Za-z0-9_-]*)/g)) out.add(cls[1]);
  }
  return out;
}

/** What one source file references, per module it imports — keyed by RESOLVED path, so
 *  two `./page.module.css` in different routes stay separate. */
export function usedClasses(src: string, fromDir: string): Map<string, ModuleUse> {
  const clean = stripComments(src);
  const out = new Map<string, ModuleUse>();
  for (const imp of clean.matchAll(/import\s+(\w+)\s+from\s+['"]([^'"]+\.module\.css)['"]/g)) {
    const [, binding, rel] = imp;
    const key = resolve(fromDir, rel);
    const entry = out.get(key) ?? { names: new Set<string>(), opaque: false };
    for (const r of clean.matchAll(new RegExp(`\\b${binding}\\.([A-Za-z][A-Za-z0-9_]*)`, 'g'))) entry.names.add(r[1]);
    // Bracket access is a latch, not a loophole in use: `src` has none today, and the
    // header's safety argument depends on that staying true. Reading it here means a
    // future `styles['foo']` keeps its rule alive instead of being reported dead.
    for (const r of clean.matchAll(new RegExp(`\\b${binding}\\[['"\`]([^'"\`]+)['"\`]\\]`, 'g'))) entry.names.add(r[1]);
    // Handed around WHOLE — spread, or passed as a prop. Either way the keys read are
    // invisible from here, so the module is skipped rather than guessed at. Also none
    // today; both forms are latched so neither can silently start reporting live rules.
    if (new RegExp(`\\.\\.\\.${binding}\\b`).test(clean)) entry.opaque = true;
    if (new RegExp(`=\\{${binding}\\}`).test(clean)) entry.opaque = true;
    out.set(key, entry);
  }
  return out;
}

/** Every module in the tree, with everything any component references from it. */
export function usedByModule(root: string): Map<string, ModuleUse> {
  const used = new Map<string, ModuleUse>();
  for (const file of sourceFiles(root)) {
    for (const [key, entry] of usedClasses(readFileSync(file, 'utf8'), dirname(file))) {
      const merged = used.get(key) ?? { names: new Set<string>(), opaque: false };
      entry.names.forEach((n) => merged.names.add(n));
      used.set(key, { names: merged.names, opaque: merged.opaque || entry.opaque });
    }
  }
  return used;
}

describe('every CSS-module class is referenced by a component', () => {
  it('finds no unreferenced class in src/**', () => {
    const used = usedByModule(SRC);
    const offenders: string[] = [];
    for (const file of cssFiles(SRC).filter((f) => f.endsWith('.module.css'))) {
      const entry = used.get(resolve(file));
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
    const names = usedClasses("import s from './x.module.css';\n<div className={s.live} />", '/app')
      .get('/app/x.module.css')!.names;
    expect([...definedClasses(css)].filter((n) => !names.has(n))).toEqual(['dead']);
  });

  // Anti-vacuity 2: THE bug this scan is written around. A `styles.`-only grep calls
  // `.formHint` dead here, and deleting on that answer removes live CSS.
  it('resolves a module imported under a name that is not `styles`', () => {
    const src = "import dash from '../ProjectStatusDashboard.module.css';\n<p className={dash.formHint} />";
    const names = usedClasses(src, '/app/components').get('/app/ProjectStatusDashboard.module.css')!.names;
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

  // Anti-vacuity 4: a module handed around whole is SKIPPED, not judged. Without this the
  // latch could rot into a no-op and nobody would see it fail.
  it('latches a module passed as a prop rather than reporting its classes dead', () => {
    const spread = usedClasses("import s from './x.module.css';\nconst o = {...s};", '/app').get('/app/x.module.css')!;
    const prop = usedClasses("import s from './x.module.css';\n<Foo styles={s} />", '/app').get('/app/x.module.css')!;
    expect([spread.opaque, prop.opaque]).toEqual([true, true]);
  });
});
