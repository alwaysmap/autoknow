import React from 'react';
import styles from './AnchorHeading.module.css';

// A section <h2> that carries its own anchor: the id lands on the heading, so
// `/programs/1#phases` is a real, shareable address the browser scrolls to
// natively. The row also hosts the section's affordances (⋯ menus, ⓘ) via
// `actions`, and in the instrument style ends in a graticule (see the module CSS).
// The heading shows no “#” — the ADR a-section-heading-carries-its-id says why.
//
// The id is always passed explicitly, never slugified from the heading text:
// headings are localized, and a text-derived anchor would give every locale a
// different URL for the same section (and break every link already shared).

interface AnchorHeadingProps {
  id: string;
  children: React.ReactNode;
  /** Extra class for the heading itself (page/component styling). */
  className?: string;
  /** Content that rides on the heading row, right of the title (menus, ⓘ). */
  actions?: React.ReactNode;
}

export default function AnchorHeading({ id, children, className, actions }: AnchorHeadingProps) {
  return (
    <div className={styles.row}>
      <h2 id={id} className={`${styles.heading} ${className ?? ''}`}>{children}</h2>
      {actions}
    </div>
  );
}
