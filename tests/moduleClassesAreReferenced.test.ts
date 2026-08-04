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
// WHY DELETING IS SAFE, which is also why this ratchet can be strict: a module class
// reaches the DOM through its import binding, or through another class in the same module
// that `composes:` it. Both are counted below. There is no computed `styles[expr]`, no
// MODULE class ever named as a literal string (the one literal className in `src` is a
// GLOBAL class, `dark-theme`), and no cross-module `composes: x from './other.css'` — that
// last one is latched at `composedClasses` rather than counted, so if one ever appears it
// costs a name a false death report, never a silent survival. So a class no component
// names and nothing composes is applied to no element, and a rule for it can never match.
// globals.css's blanket
// `[class*="card"]` selectors do not change that: they style elements that already carry
// the class, and nothing carries these.
//
// `composes:` was read as nothing for a while and got away with it, because the two rules
// using it were ALSO named directly by their components — so the blind spot only opened
// when a class existed purely to be composed (`SopOutlookCell`'s `.reading`, which holds
// the type every verdict class shares). A composed-only class is REFERENCED, from CSS
// rather than from TS, and reporting it dead would have deleted a live rule.
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

/** Class names a module composes from ITSELF — `composes: reading;`, the CSS-side
 *  reference. The `composes: x from './other.css'` form is deliberately excluded: those
 *  names belong to the other module, and counting them here would keep a local class of
 *  the same name alive by coincidence. */
export function composedClasses(css: string): Set<string> {
  const out = new Set<string>();
  // Terminated by `;` OR by the block's closing brace — a last declaration needs no
  // semicolon, and requiring one would report the class it keeps alive as dead, which is
  // the exact failure this whole file exists to prevent.
  for (const decl of blankComments(css).matchAll(/composes\s*:\s*([^;{}]+)[;}]/g)) {
    if (/\bfrom\b/.test(decl[1])) continue;
    for (const name of decl[1].trim().split(/\s+/)) out.add(name);
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
      const css = readFileSync(file, 'utf8');
      const composed = composedClasses(css);
      for (const name of definedClasses(css)) {
        if (!entry?.names.has(name) && !composed.has(name)) offenders.push(`${file} → .${name}`);
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

  // Anti-vacuity 5: `composes:` is a reference, and only the LOCAL form is one. Four ways
  // this rots, one case each — without the first a composed-only base class reads as dead;
  // without the second a name imported from another module keeps an unrelated local class
  // of that name alive; without the third a last declaration written without its optional
  // semicolon stops counting; and the fourth is anti-vacuity 3's rule, which every reader
  // of this file has to obey too — a comment ABOUT composing is not composing.
  it('counts a locally composed class as referenced, and an imported one as not', () => {
    expect([...composedClasses('.a { composes: base tight; }')]).toEqual(['base', 'tight']);
    expect([...composedClasses(".a { composes: base from './other.module.css'; }")]).toEqual([]);
    expect([...composedClasses('.a { composes: base }')]).toEqual(['base']);
    expect([...composedClasses('/* composes: ghost; */ .a { color: red }')]).toEqual([]);
  });
});
