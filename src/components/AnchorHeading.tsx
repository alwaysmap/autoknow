import React from 'react';
import styles from './AnchorHeading.module.css';

// A section <h2> that carries its own anchor: the id lands on the heading, so
// `/programs/1#phases` is a real, shareable address and the browser scrolls to
// it natively. The heading used to grow a hover-revealed “#” beside it to hand
// that URL over; the glyph read as clutter on every heading in the app and was
// removed. Deep links are unaffected — only the affordance is gone.
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
