// #34: every embedded modal goes through OverlayDialog — the ONE container that owns
// sizing (`max-height`, never `height`), the body-scroll lock that restores the prior
// value, and the box-based backdrop dismiss. A raw `<dialog>` or a `.showModal()` call
// anywhere else is exactly the divergence this consolidated (10 sizing rules, 6 close
// mechanisms, one `height:` that left the history dialog half-empty). This fails if a new
// one sneaks in, so the next modal can't start from scratch (AGENTS lesson 2).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) tsxFiles(p, out);
    else if (p.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const FILES = tsxFiles(join(process.cwd(), 'src'));
const isContainer = (f: string) => f.endsWith('OverlayDialog.tsx');
const rel = (f: string) => f.slice(f.indexOf('/src/') + 1);

describe('#34 OverlayDialog is the only modal container', () => {
  test('no component renders a raw <dialog> (attributes) except OverlayDialog', () => {
    // `<dialog` followed by whitespace = a JSX opening tag with attributes; prose like
    // "a <dialog> over this one" is `<dialog>` and is deliberately not matched.
    const offenders = FILES.filter(
      (f) => !isContainer(f) && /<dialog[ \t\n]/.test(readFileSync(f, 'utf8')),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  test('no component calls .showModal() except through OverlayDialog', () => {
    const offenders = FILES.filter(
      (f) => !isContainer(f) && /\.showModal\(/.test(readFileSync(f, 'utf8')),
    ).map(rel);
    expect(offenders).toEqual([]);
  });

  test('OverlayDialog sizes with max-height, never a fixed height (the history-dialog bug)', () => {
    const css = readFileSync(join(process.cwd(), 'src/components/OverlayDialog.module.css'), 'utf8');
    expect(css).toMatch(/max-height:/);
    // the `.dialog` rule must not set a bare `height:` (that is what left 50% blank)
    const dialogRule = css.slice(css.indexOf('.dialog {'), css.indexOf('}', css.indexOf('.dialog {')));
    expect(dialogRule).not.toMatch(/[^-]height:/);
  });
});
