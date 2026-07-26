'use client';

import React from 'react';
import AnchoredPopover from './AnchoredPopover';
import styles from './KebabMenu.module.css';

// A quiet ⋯ menu for header actions. The children are the items — buttons and forms
// render as uniform menu rows via this module's descendant styles. Placement (flip +
// clamp), light-dismiss and focus all live in AnchoredPopover (#24) now; this is just the
// ⋯ trigger and the row grammar. The hard-won rule "do NOT close on inner clicks"
// (unmounting a menu item's <form> would abort its in-flight server action) still holds for
// buttons and forms: `popover="auto"` light-dismiss fires on OUTSIDE clicks and Escape only.
// AnchoredPopover adds exactly one dismissal on top of that — an activated link that
// replaces the page — so a `<Link>` child needs no `onClick={close}` (autoknow-6mn).

export default function KebabMenu({ ariaLabel, children }: { ariaLabel: string; children: React.ReactNode }) {
  return (
    <AnchoredPopover
      variant="menu"
      panelLabel={ariaLabel}
      panelClassName={styles.menu}
      renderTrigger={(triggerProps) => (
        <button {...triggerProps} type="button" className={styles.trigger} aria-label={ariaLabel} data-testid="kebab-menu">
          <svg viewBox="0 0 18 18" width={16} height={16} aria-hidden>
            <circle cx={9} cy={3.5} r={1.8} fill="currentColor" />
            <circle cx={9} cy={9} r={1.8} fill="currentColor" />
            <circle cx={9} cy={14.5} r={1.8} fill="currentColor" />
          </svg>
        </button>
      )}
    >
      {children}
    </AnchoredPopover>
  );
}
