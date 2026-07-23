'use client';

import React from 'react';
import styles from './SearchField.module.css';

// The app's ONE filter-box look. Every DataTable's built-in key-column filter renders
// through this; it is never a full `UnifiedSearch`. It shares UnifiedSearch's height,
// padding and focus ring but is SQUARER on purpose (0.375rem vs the near-pill 1.25rem):
// the corner is the tell that this narrows rows already in the page rather than issuing
// a search — box-vs-pill applied to inputs (design.md §6/§8c).
//
// No dial here, deliberately: the Instrument gauge reports a query IN FLIGHT
// (design.md §8c). These filter rows already in the page — there is no request,
// so there is nothing for a dial to report and a permanently-parked needle would
// be decoration.
//
// It is a component rather than a shared class because CSS modules cannot share a
// class across files, and this drifted into three separate definitions the last
// time it was left to per-page styling.

export default function SearchField({
  value,
  onChange,
  placeholder,
  id,
  className,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  id?: string;
  /** Extra class for width/placement only — never for the control's own look. */
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <input
      id={id}
      type="search"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      className={`${styles.field} ${className ?? ''}`}
    />
  );
}
