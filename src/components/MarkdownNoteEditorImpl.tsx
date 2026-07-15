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
import type { MarkdownNoteEditorProps } from './MarkdownNoteEditor';
import styles from './MarkdownNoteEditor.module.css';

// The client-only half of MarkdownNoteEditor. A deliberately small toolbar — bold,
// italic, lists, link — matching what a status note actually needs; markdown
// shortcuts (`- `, `**`, `#`) work while typing. The hidden input is the ONLY thing
// the surrounding <form> sees.

export default function MarkdownNoteEditorImpl({ name, placeholder, initialMarkdown, ariaLabel, onChange }: MarkdownNoteEditorProps) {
  const [markdown, setMarkdown] = useState(initialMarkdown ?? '');
  const handleChange = (md: string) => { setMarkdown(md); onChange?.(md); };
  return (
    <div className={styles.frame} data-testid="note-editor" aria-label={ariaLabel}>
      <MDXEditor
        markdown={markdown}
        onChange={handleChange}
        placeholder={placeholder}
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
