// #26: the list-page frame — the outer gutter, the one-line header + hairline, and the
// §7 gap to the content — lives ONCE, in PageShell. Before this, six page modules each
// defined their own `.container`/`.header`/`.main`, no two alike, with title→first-row
// gaps from 8px to 40px against §7's ~14px. This guard fails if any list page re-invents
// that frame, so the next page can't start from whatever the last one happened to do
// (AGENTS lesson 2: ship the rule in software, not prose). Detail `[id]` pages are a
// different template and keep their own frame, so they are deliberately out of scope.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();

// List pages whose header now comes from PageShell. (people reuses partners' module;
// ecosystem-summary's header lived in its client module and is gone; programs' header was
// inline and is gone; my-projects is a redirect and its module was deleted.)
const LIST_PAGE_MODULES = [
  'src/app/partners/page.module.css',
  'src/app/templates/page.module.css',
  'src/app/admin/page.module.css',
  'src/app/ecosystem/page.module.css',
  'src/app/programs/page.module.css',
];

// The frame selectors PageShell now owns. A block on any of these in a list-page module is
// the divergence #26 removed.
const FRAME_SELECTORS: Array<[string, RegExp]> = [
  ['.container', /\.container\s*[,{]/],
  ['.header', /\.header\s*[,{]/],
  ['.main', /\.main\s*[,{]/],
];

describe('#26 the list-page frame lives only in PageShell', () => {
  for (const rel of LIST_PAGE_MODULES) {
    test(`${rel} defines no page frame`, () => {
      const file = join(ROOT, rel);
      if (!existsSync(file)) return; // deleting the module outright is also compliant
      const css = readFileSync(file, 'utf8');
      for (const [name, re] of FRAME_SELECTORS) {
        expect({ module: rel, selector: name, redefined: re.test(css) }).toEqual({
          module: rel,
          selector: name,
          redefined: false,
        });
      }
    });
  }

  test('PageShell.module.css is the single definer of the header + its hairline', () => {
    const shell = readFileSync(join(ROOT, 'src/components/PageShell.module.css'), 'utf8');
    expect(shell).toMatch(/\.header\s*\{/);
    expect(shell).toMatch(/border-bottom:\s*1px solid var\(--border\)/); // the Standard-style rule
  });
});
