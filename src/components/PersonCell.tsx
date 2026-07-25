import React from 'react';
import Link from 'next/link';
import { resolvePerson, type PersonLike } from '../lib/people';
import { personHref } from '../lib/entityHref';
import styles from './PersonCell.module.css';

// The one way anything renders A PERSON (#153). Two rules — why, in design.md §2:
//   • A person reads by NAME; an email is a storage format. The one exception is
//     /people's Email column, which is an email column with a mailto:.
//   • A name WITH a route is clickable; a name with NO route is plain text — never a
//     link to nowhere, never a blank cell.
//
// Pure: no hooks, no 'use client'. Server and client components both use it.

/** A person already resolved by the caller (a relation, or a server-side lookup). */
export interface PersonRef {
  id: number;
  name: string;
}

/**
 * The label for a person string nothing resolved. An email's local part, never the
 * whole address: acceptance #1 of #153 is that no table cell renders a person as an
 * email, and that has to hold for the unresolved branch too. A bare handle or a plain
 * name passes through unchanged, so 'drive-share' stays 'drive-share'.
 */
export function personLabel(value: string | null | undefined): string {
  const raw = (value ?? '').trim().replace(/^@/, '');
  if (!raw) return '';
  const at = raw.lastIndexOf('@');
  return at > 0 ? raw.slice(0, at) : raw;
}

/**
 * A column funnel's label for a person column. The funnel's VALUE stays the stored
 * string — a canonical, locale-stable token in the shared URL (AGENTS lesson 3) — while
 * its LABEL reads as a person, like the cell beneath it. Four columns need this; it
 * lives here so the funnel and the cell cannot disagree about a name.
 *
 * `directory` is either the client-side people list or a server-resolved Map, because
 * two of the four columns store a bare string with no Person relation.
 */
export function personFilterLabel(
  directory: PersonLike[] | Map<string, string>,
): (value: string) => string {
  return (value) => {
    const name = directory instanceof Map
      ? directory.get(value)
      : resolvePerson(directory, value)?.name;
    // No `?? value` tail: personLabel never returns null, and pretending otherwise
    // reads as a handled empty case that cannot fire.
    return name ?? personLabel(value);
  };
}

export default function PersonCell({
  person,
  value,
  people,
  className,
  title,
  fallback = '—',
  children,
}: {
  /** Already-resolved person. Wins over `value`/`people` when present. */
  person?: PersonRef | null;
  /** The stored string — an email, a handle, or a name. */
  value?: string | null;
  /** Directory to resolve `value` against (lib/people's resolvePerson). */
  people?: PersonLike[];
  /** Host decoration for the link (a pill on the phase rail). Defaults to the quiet link. */
  className?: string;
  title?: string;
  /** Rendered when there is no person string at all. */
  fallback?: React.ReactNode;
  /** Extra ink inside the link (the phase rail's "+n active elsewhere" badge). */
  children?: React.ReactNode;
}) {
  const matched = person ?? (people ? resolvePerson(people, value) : null);
  if (matched) {
    return (
      <Link href={personHref(matched.id)} className={className ?? styles.link} title={title}>
        {matched.name}
        {children}
      </Link>
    );
  }
  const label = personLabel(value);
  if (!label) return <span className={styles.empty}>{fallback}</span>;
  return (
    <span className={styles.plain} title={title}>
      {label}
      {children}
    </span>
  );
}

/**
 * Several people in one cell, comma-separated (the /partners TEL and Team columns).
 *
 * Quiet links rather than a pill each — signed off from a screenshot in both themes
 * (#153): the TEL column carries 2–3 people, and three pills in one cell read as three
 * objects competing with the partner name that the row is actually about. design.md §6
 * already says names in table cells stay quiet links.
 */
export function PersonList({
  values,
  people,
  emptyLabel,
}: {
  values: string[];
  people: PersonLike[];
  /** What an empty cell says ("None") — localized by the caller. Named `emptyLabel`,
   *  not `fallback`, to match the app's other list components (FeedList, ActivityFeed);
   *  `fallback` is the single-cell name, shared with DateCell. */
  emptyLabel: React.ReactNode;
}) {
  if (values.length === 0) return <span className={styles.empty}>{emptyLabel}</span>;
  return (
    <span className={styles.list}>
      {values.map((v, idx) => (
        <React.Fragment key={v}>
          {idx > 0 && ', '}
          <PersonCell value={v} people={people} />
        </React.Fragment>
      ))}
    </span>
  );
}
