'use client';

import React, { useState } from 'react';
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
  const handleChange = (md: string) => { setMarkdown(md); onChange?.(md); };
  return (
    <div
      className={`${styles.frame}${theme === 'dark' ? ' dark-theme' : ''}`}
      data-testid="note-editor"
      aria-label={ariaLabel}
      ref={setFrame}
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
