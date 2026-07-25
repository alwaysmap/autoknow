/** @jest-environment node */
// ADR `containers-own-spacing-charts-own-height` (2026-07-22): a component's ROOT
// element never sets an outer margin — the PARENT owns sibling spacing via `gap`.
// This ratchet enforces it (AGENTS lesson 2), so the rule needs no memory.
//
// "The component's root class" cannot be read out of a CSS module reliably: a naive
// regex either misses real violations or flags legitimate INNER margins (issue #36).
// So the check anchors on the dominant convention — the root element carries
// `styles.wrapper` — plus an explicit list of the few pre-existing non-`.wrapper`
// roots, each verified by reading the component's outermost returned element. New
// components should keep the `.wrapper` convention.
//
// ALLOWLIST holds the roots that still set an outer margin. Each is a real,
// screenshot-verified layout change to fix (move the space to the parent's `gap`).
// It may ONLY SHRINK: a new root margin fails the first test; a fixed one that is
// not removed fails the second.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = 'src/components';

// Verified non-`.wrapper` component roots (the outermost returned element's class).
const NON_WRAPPER_ROOTS: Record<string, string> = {
  AnchorHeading: 'row', //       <div className={styles.row}>
  SummaryToolbar: 'bar', //      <div className={styles.bar}>
};

// Legacy root margins awaiting migration to the parent's `gap`. ONLY SHRINK.
const ALLOWLIST: readonly string[] = [
  'AnchorHeading.row', //         margin-bottom: 0.5rem   (shared heading)
  'BusiestResources.wrapper', //  margin: 1.25rem 0 0
  'ChainLedger.wrapper', //       margin: 0 0 1rem
  'SummaryToolbar.bar', //        margin-bottom: 0.375rem
];

/** The body of the first `.cls { ... }` rule in a CSS module, or null. */
function ruleBlock(css: string, cls: string): string | null {
  const m = new RegExp(`^\\.${cls}\\s*\\{`, 'm').exec(css);
  if (!m) return null;
  const rest = css.slice(m.index + m[0].length);
  const end = rest.indexOf('}');
  return end >= 0 ? rest.slice(0, end) : rest;
}

/** True if a rule body sets a non-zero, non-`auto` VERTICAL outer margin (the
 *  sibling-spacing axis). `margin: 0 auto` (centring) and `margin: 0` (reset) do not
 *  count; horizontal-only margins are out of scope. */
function setsOuterMargin(block: string): boolean {
  // Strip whole block comments first: these rules are heavily commented and the house style
  // QUOTES declarations in prose (`.tableWrapper { margin-top: 1rem }`), which a per-line
  // split at `/*` would read as live code on any continuation line.
  const uncommented = block.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const line of uncommented.split('\n')) {
    const code = line.split('/*')[0];
    const m = /\bmargin(-top|-bottom)?\s*:\s*([^;]+);/.exec(code);
    if (!m) continue;
    const val = m[2].trim();
    if (val === '0' || val.includes('auto')) continue;
    if (m[1]) return true; // explicit margin-top / margin-bottom, non-zero
    const parts = val.split(/\s+/); // shorthand: top [right bottom left]
    const top = parts[0];
    const bottom = parts.length >= 3 ? parts[2] : parts[0];
    if (top !== '0' || bottom !== '0') return true;
  }
  return false;
}

function foundRootMargins(): string[] {
  const out: string[] = [];
  for (const f of readdirSync(DIR).filter((n) => n.endsWith('.module.css'))) {
    const base = f.replace('.module.css', '');
    const css = readFileSync(join(DIR, f), 'utf8');
    const roots = new Set<string>(['wrapper']);
    if (NON_WRAPPER_ROOTS[base]) roots.add(NON_WRAPPER_ROOTS[base]);
    for (const cls of roots) {
      const block = ruleBlock(css, cls);
      if (block && setsOuterMargin(block)) out.push(`${base}.${cls}`);
    }
  }
  return out.sort();
}

describe('component roots own no outer margin (ADR box-model ownership)', () => {
  it('flags every root outer margin against the allowlist — a NEW one fails CI', () => {
    const unexpected = foundRootMargins().filter((v) => !ALLOWLIST.includes(v));
    expect(unexpected).toEqual([]);
  });

  it('keeps the allowlist honest — a fixed violator must be REMOVED, not left stale', () => {
    const found = new Set(foundRootMargins());
    expect(ALLOWLIST.filter((v) => !found.has(v))).toEqual([]);
  });
});
