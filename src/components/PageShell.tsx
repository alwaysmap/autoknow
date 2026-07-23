import React from 'react';
import styles from './PageShell.module.css';

// THE list-page frame (#26). Every list page — programs, partners, people, templates,
// admin, ecosystem, ecosystem-summary — invented its own header spacing: four title
// sizes, two weights, three with no hairline at all, and a title→first-row gap that
// ranged 8–40px against design.md §7's ~14px. This owns that shape in ONE place, so
// "tighten the app" is one edit and no page starts from whatever the last one did.
//
// The frame is: a one-line header (title + optional affordances, ending in the graticule
// per §8c — border-bottom in Standard, a trailing tick-graticule on the text baseline in
// Instrument) followed by the content, ONE §7 step (~14px) below the rule. Affordances
// ride INSIDE the title row (never as siblings that the graticule would fling right, §8c).
//
// Presentational only (no hooks), so it drops into a server page or a client component
// wherever the header currently lives.

export interface PageShellProps {
  /** The page title (an existing i18n string — this adds no new copy). */
  title: React.ReactNode;
  /** Header affordances beside the title (a KebabMenu, a "New X" control). §8c: these ride
   *  inside the title row; the graticule fills the line after them. */
  actions?: React.ReactNode;
  /** An optional second line under the title (e.g. the dev console's one-line note). */
  subtitle?: React.ReactNode;
  /** Optional content-column max-width (e.g. '62.5rem'); centred. Omit to fill the gutter. */
  maxWidth?: string;
  children: React.ReactNode;
}

export default function PageShell({ title, actions, subtitle, maxWidth, children }: PageShellProps) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <h1 className={styles.title}>{title}</h1>
          {actions}
        </div>
        {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
      </header>
      <main className={styles.content} style={maxWidth ? { maxWidth, marginInline: 'auto' } : undefined}>
        {children}
      </main>
    </div>
  );
}
