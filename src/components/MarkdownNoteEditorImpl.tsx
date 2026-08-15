'use client';

import React, { useRef, useState } from 'react';
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  linkPlugin,
  linkDialogPlugin,
  quotePlugin,
  markdownShortcutPlugin,
  toolbarPlugin,
  BoldItalicUnderlineToggles,
  ListsToggle,
  CreateLink,
} from '@mdxeditor/editor';
import '@mdxeditor/editor/style.css';
import { useResolvedTheme } from '../lib/useResolvedTheme';
import type { MarkdownNoteEditorProps } from './MarkdownNoteEditor';
import styles from './MarkdownNoteEditor.module.css';

// The client-only half of MarkdownNoteEditor. A deliberately small toolbar — bold,
// italic, lists, link — matching what a status note actually needs; markdown
// shortcuts (`- `, `**`, `#`) work while typing. The hidden input is the ONLY thing
// the surrounding <form> sees.

export default function MarkdownNoteEditorImpl({ name, placeholder, initialMarkdown, ariaLabel, onChange }: MarkdownNoteEditorProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown ?? '');
  // Overlays (the link dialog) must portal INSIDE this subtree: the editor often
  // lives in a showModal() <dialog>, and anything portaled to document.body
  // renders BEHIND the browser's top layer no matter its z-index.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  // MDXEditor carries its OWN palette (Radix scales), switched by a `dark-theme`
  // class — not by our tokens. Without it the package renders near-black ink and
  // near-black selection on our dark paper: unreadable, and it stayed that way
  // because CSS alone cannot add a class. Hence the one theme read in the app.
  const theme = useResolvedTheme();
  // AN EMISSION BEFORE THE USER HAS TOUCHED THE EDITOR IS NOT AN EDIT.
  //
  // MDXEditor parses the markdown it is given and re-serialises it, then announces the
  // result through `onChange` while React is still mounting this component — reporting an
  // edit nobody made, rewriting stored markdown on the next Save, and setting the dirty
  // flag the unsaved-work guards read. The full account, and why the gate is an
  // INTERACTION rather than a mount ref (ordering that holds until a dependency bump) or
  // a string comparison (the re-serialisation legitimately differs), is
  // docs/knowledge/a-rich-editor-reports-its-own-load-as-an-edit.md — autoknow-6v9.
  //
  // Focus covers toolbar commands, which need a selection in the editor first;
  // `beforeinput` covers typing and paste. Neither fires while a value is merely loading.
  const userEngaged = useRef(false);
  const handleChange = (md: string) => {
    if (!userEngaged.current) return; // the editor's own load-time re-serialisation
    // Plain dedupe, AFTER the gate above and not a substitute for it: the editor re-emits
    // identical text on some commands, and a change that changes nothing is not an edit.
    if (md === markdown) return;
    setMarkdown(md);
    onChange?.(md);
  };

  return (
    <div
      className={`${styles.frame}${theme === 'dark' ? ' dark-theme' : ''}`}
      data-testid="note-editor"
      aria-label={ariaLabel}
      ref={setFrame}
      onFocusCapture={() => { userEngaged.current = true; }}
      onBeforeInputCapture={() => { userEngaged.current = true; }}
    >
      <MDXEditor
        markdown={markdown}
        onChange={handleChange}
        placeholder={placeholder}
        overlayContainer={frame}
        contentEditableClassName={styles.content}
        plugins={[
          headingsPlugin(),
          listsPlugin(),
          linkPlugin(),
          linkDialogPlugin(),
          quotePlugin(),
          markdownShortcutPlugin(),
          toolbarPlugin({
            toolbarClassName: styles.toolbar,
            toolbarContents: () => (
              <>
                <BoldItalicUnderlineToggles options={['Bold', 'Italic']} />
                <ListsToggle options={['bullet', 'number']} />
                <CreateLink />
              </>
            ),
          }),
        ]}
      />
      <input type="hidden" name={name} value={markdown} />
    </div>
  );
}
