'use client';

import React from 'react';
import styles from './SearchField.module.css';

// The app's ONE search-field look, for the live-filter boxes that are not a full
// `UnifiedSearch` — the Programs table filter, the Sources filter. Same height,
// same near-pill radius, same focus ring as `UnifiedSearch`'s input, so a search
// box looks like a search box wherever you meet one.
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
