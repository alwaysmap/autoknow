'use client';

import React, { useEffect, useRef, useState } from 'react';
import styles from './KebabMenu.module.css';

// A quiet ⋯ menu for header actions (same grammar as PhaseTrack's title menu):
// the trigger stays out of the reading line; items are the children — buttons and
// forms render as uniform menu rows via the module's descendant styles. The menu
// closes on outside pointerdown, Escape, or any click inside (an action was taken).

export default function KebabMenu({ ariaLabel, children }: { ariaLabel: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className={styles.wrap} ref={ref}>
      <button
        type="button"
        className={styles.trigger}
        aria-label={ariaLabel}
        aria-expanded={open}
        data-testid="kebab-menu"
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 18 18" width={16} height={16} aria-hidden>
          <circle cx={9} cy={3.5} r={1.8} fill="currentColor" />
          <circle cx={9} cy={9} r={1.8} fill="currentColor" />
          <circle cx={9} cy={14.5} r={1.8} fill="currentColor" />
        </svg>
      </button>
      {open && (
        // No auto-close on inner clicks: unmounting form children aborts their
        // in-flight server actions. Outside pointerdown / Escape close it, and
        // dialog-opening items cover it with a modal anyway.
        <span className={styles.menu} role="menu">
          {children}
        </span>
      )}
    </span>
  );
}
