import { readFileSync } from 'fs';

// The MDXEditor link popover was the white-box-off-screen defect the user
// reported. The fix is CSS-only (re-paint with OUR tokens, cap the width), and
// it is too interaction-flaky to pin with e2e — the popover opens on a
// selection-dependent command that even manual driving misses. So this guards
// the STRUCTURE of the fix: if someone deletes or guts these rules, it fails
// here rather than silently regressing. The visual proof lives in the browser
// check that shipped with the fix.

const css = readFileSync('src/components/MarkdownNoteEditor.module.css', 'utf8');

/** Body of the first rule block whose selector mentions `classFragment`. */
function ruleBody(classFragment: string): string {
  const match = css.match(new RegExp(`_${classFragment}_[^{]*\\{([^}]*)\\}`));
  if (!match) throw new Error(`no rule targets _${classFragment}_`);
  return match[1];
}

describe('markdown link popover stays themed and on-screen', () => {
  it('re-paints the popover with our tokens (not the package palette) and caps its width', () => {
    const body = ruleBody('linkDialogPopoverContent');
    // OUR tokens, so it is correct in both themes regardless of MDXEditor's vars.
    expect(body).toMatch(/background-color:\s*var\(--paper\)/);
    expect(body).toMatch(/var\(--border\)/);
    // A hard width cap is what keeps a 21rem multi-field form from running off
    // the side of a narrow update dialog.
    expect(body).toMatch(/max-width:\s*min\(/);
  });

  it('themes the popover text inputs and shrinks them to fit', () => {
    const body = ruleBody('textInput');
    expect(body).toMatch(/var\(--fg\)/);
    expect(body).toMatch(/width:\s*100%/);
    expect(body).toMatch(/min-width:\s*0/);
  });

  it('gives the popover buttons our button colours', () => {
    expect(css).toMatch(/_primaryButton_[^{]*\{[^}]*var\(--p-600\)/);
    expect(css).toMatch(/_secondaryButton_[^{]*\{[^}]*var\(--surface\)/);
  });
});
