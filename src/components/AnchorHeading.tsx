import React from 'react';
import styles from './AnchorHeading.module.css';

// A section <h2> that owns its deep link: hovering (or tabbing to) the heading
// reveals a quiet “#” beside it, and clicking that sets the address bar to the
// section's anchor so the URL can be shared. A REAL <a href="#id"> does the
// work — the browser updates the hash and scrolls natively, so this needs no
// JavaScript and keeps working in server components.
//
// The id is always passed explicitly, never slugified from the heading text:
// headings are localized, and a text-derived anchor would give every locale a
// different URL for the same section (and break every link already shared).

interface AnchorHeadingProps {
  id: string;
  children: React.ReactNode;
  /** Extra class for the heading itself (page/component styling). */
  className?: string;
  /** Accessible name for the link, localized by the caller. */
  linkLabel: string;
  /** Content that rides on the heading row, right of the title (menus, ⓘ). */
  actions?: React.ReactNode;
}

export default function AnchorHeading({ id, children, className, linkLabel, actions }: AnchorHeadingProps) {
  return (
    <div className={styles.row}>
      {/* The link is a SIBLING of the heading, not a child: nested inside, its
          "#" joined the heading's accessible name ("Programs at Risk #"), which
          reads as noise and broke exact-name queries. */}
      <h2 id={id} className={`${styles.heading} ${className ?? ''}`}>{children}</h2>
      <a href={`#${id}`} className={styles.anchor} aria-label={linkLabel} title={linkLabel}>
        #
      </a>
      {actions}
    </div>
  );
}
