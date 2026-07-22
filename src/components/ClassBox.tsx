'use client';

import React from 'react';
import styles from './ClassBox.module.css';

// A BOX says what CLASS a thing belongs to — its type, its region, its kind.
// A PILL says which named thing it IS (see the `.pill` treatment on program
// headers). The rule, stated once so it stops being decided per-table
// (2026-07-20, user call):
//
//   box  = a category the thing shares with others   → Partner Type, Region, result kind
//   pill = a proper noun, one specific entity        → "Bosch", "Stellantis", a person
//
// Squared-off corners for a class, rounded for a name: the shape carries the
// distinction, so it survives greyscale and colour-blindness. The box is a
// hairline in `currentColor`, never a filled badge (design.md §6), and inherits
// its ink so callers colour it by setting `color`.

export default function ClassBox({ children, className }: {
  children: React.ReactNode;
  /** Extra class from the caller (e.g. to set the ink). */
  className?: string;
}) {
  return <span className={`${styles.box} ${className ?? ''}`}>{children}</span>;
}
