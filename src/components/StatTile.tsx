'use client';

import React from 'react';
import Link from 'next/link';
import styles from './StatTile.module.css';

// The shared grammar for the ecosystem strip (design.md §1, §7): a small-caps label,
// ONE headline figure — or a small chart in its place — and one quiet line of
// context. No box, no border, no drop shadow; whitespace separates the tiles.
// Figures that have a matching list are links, because every summary is a door
// (design.md §2).

interface StatTileProps {
  label: string;
  /** The headline figure. Omit and pass `children` for a chart tile instead. */
  value?: React.ReactNode;
  /** Makes the figure a link to the list it summarizes. */
  href?: string;
  title?: string;
  /** Quiet context under the figure; may contain links. */
  sub?: React.ReactNode;
  /** `warn` colors the figure — use only when the number itself is the bad news. */
  tone?: 'default' | 'warn';
  /** A small chart, rendered where the figure would be. */
  children?: React.ReactNode;
  testId?: string;
}

export default function StatTile({
  label,
  value,
  href,
  title,
  sub,
  tone = 'default',
  children,
  testId,
}: StatTileProps) {
  const bigClass = tone === 'warn' ? `${styles.big} ${styles.warn}` : styles.big;
  return (
    <div className={styles.tile} data-testid={testId}>
      <div data-eyebrow>{label}</div>
      {children ? (
        <div className={styles.body}>{children}</div>
      ) : href ? (
        <Link href={href} className={bigClass} title={title}>{value}</Link>
      ) : (
        <span className={bigClass} title={title}>{value}</span>
      )}
      {sub && <div className={styles.sub}>{sub}</div>}
    </div>
  );
}
