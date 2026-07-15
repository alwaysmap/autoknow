'use client';

import dynamic from 'next/dynamic';
import styles from './MarkdownNoteEditor.module.css';

// WYSIWYG markdown note field (MDXEditor): users write rich text, the form receives
// plain markdown via a hidden input — the DB keeps storing markdown strings, and
// react-markdown keeps rendering them. Client-only (contenteditable), so the editor
// itself loads dynamically with a placeholder box to prevent layout shift.

const Impl = dynamic(() => import('./MarkdownNoteEditorImpl'), {
  ssr: false,
  loading: () => <div className={styles.loading} aria-hidden />,
});

export interface MarkdownNoteEditorProps {
  name: string; // form field name carrying the markdown
  placeholder?: string;
  initialMarkdown?: string;
  ariaLabel?: string;
  onChange?: (markdown: string) => void; // for state-driven callers (e.g. the DAG panel)
}

export default function MarkdownNoteEditor(props: MarkdownNoteEditorProps) {
  return <Impl {...props} />;
}
