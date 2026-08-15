import React from 'react';
import Link from 'next/link';
import { resolvePerson, type MatchBasis, type PersonLike } from '../lib/people';
import { personHref } from '../lib/entityHref';
import { t, type Locale, type StringKey } from '../lib/i18n';
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
 * A column funnel's label for a person column stored as TEXT. The funnel's VALUE stays
 * the stored string — a canonical, locale-stable token in the shared URL (AGENTS lesson
 * 3) — while its LABEL reads as a person, like the cell beneath it. It lives here so the
 * funnel and the cell cannot disagree about a name.
 *
 * `directory` is either the client-side people list or a server-resolved Map, because
 * the columns this serves are the person columns still stored as bare text —
 * `Template.createdBy` and `ContextUrl.addedBy` funnel through it today, and
 * `ActionItem.assignedTo` is next in line. A column that HAS an FK uses
 * `personRefFunnel` below instead — see its note.
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

/**
 * The funnel for a person column backed by a FOREIGN KEY (#127 E7) — today the program
 * owner, on /programs and /ecosystem-summary.
 *
 * VALUE is the person's **id**, not the stored text. design.md §6 asks a person funnel
 * for a canonical, locale-stable shareable token, and where a relation exists the id is
 * that token in a stronger sense than the string ever was: an email is MUTABLE, so one
 * human who has changed address produced TWO options in the same funnel, neither of
 * which selected all their programs (#124 Class 4). LABEL is their name, read off the
 * INITIAL row set rather than the filtered one, so a label survives the table being
 * filtered — and no separate people directory has to be fetched and shipped to the
 * client just to name the owner.
 *
 * Returns all three `DataTable` header props together because they are one decision.
 * Spelling only `filterValue` would put raw ids in the funnel's checklist; spelling only
 * those two would leave SORT reading `row[key]`, which is a `PersonRef` here — it
 * stringifies to '[object Object]', so every row compares equal and the header goes on
 * looking clickable while sorting nothing.
 */
export function personRefFunnel<T>(
  rows: T[],
  personOf: (row: T) => PersonRef | null,
): {
  filterValue: (row: unknown) => string;
  filterLabel: (value: string) => string;
  sortValue: (row: unknown) => string;
} {
  const names = new Map<string, string>();
  for (const row of rows) {
    const person = personOf(row);
    if (person) names.set(String(person.id), person.name);
  }
  return {
    filterValue: (row) => {
      const person = personOf(row as T);
      return person ? String(person.id) : '';
    },
    // Through `personFilterLabel`'s Map branch, so both funnel kinds resolve a label the
    // same way and an unknown value falls back identically.
    filterLabel: personFilterLabel(names),
    // By NAME — the column sorts by what the cell shows, not by the id it filters on.
    sortValue: (row) => personOf(row as T)?.name ?? '',
  };
}

/**
 * The hover sentence for an inferred mention, per tier. Owned HERE, beside the mark, so
 * a call site cannot render the dotted underline without the explanation it stands for
 * (#177 — the mark and its meaning are one decision).
 */
const MENTION_TITLE_KEY: Record<MatchBasis, StringKey> = {
  email: 'mentionEmailTitle',
  handle: 'mentionHandleTitle',
  name: 'mentionNameTitle',
};

export default function PersonCell({
  person,
  value,
  people,
  className,
  title,
  fallback = '—',
  children,
  mention,
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
  /**
   * #177: this cell renders an INFERRED mention — a model extracted the string from a
   * document — never a watched fact. Adds the dotted-underline mark (design.md §8) and
   * the hover sentence naming which tier matched (`basis`; null = nothing resolved
   * confidently). `locale` rides along because this component stays pure — server and
   * client callers both already hold one. An unmarked name keeps meaning "the app
   * watched this happen", which is what keeps the mark meaningful.
   */
  mention?: { basis: MatchBasis | null; locale: Locale };
}) {
  const matched = person ?? (people ? resolvePerson(people, value) : null);
  // Computed once, above the link/plain split, so the two renderings of the mark (and
  // of its explanation) cannot diverge.
  const inferredMark = mention ? ` ${styles.inferred}` : '';
  const cellTitle = mention
    ? t(mention.locale, mention.basis ? MENTION_TITLE_KEY[mention.basis] : 'mentionUnresolvedTitle')
    : title;
  if (matched) {
    return (
      <Link href={personHref(matched.id)} className={`${className ?? styles.link}${inferredMark}`} title={cellTitle}>
        {matched.name}
        {children}
      </Link>
    );
  }
  const label = personLabel(value);
  if (!label) return <span className={styles.empty}>{fallback}</span>;
  return (
    <span className={`${styles.plain}${inferredMark}`} title={cellTitle}>
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
export function PersonList(
  props: {
    /** What an empty cell says ("None") — localized by the caller. Named `emptyLabel`,
     *  not `fallback`, to match the app's other list components (FeedList, ActivityFeed);
     *  `fallback` is the single-cell name, shared with DateCell. */
    emptyLabel: React.ReactNode;
  } & (
    /** Already-resolved people (a relation, or a server-side lookup) — the mode a column
     *  with an FK uses (#127 E7). */
    | { persons: PersonRef[]; values?: never; people?: never }
    /** The stored strings, for the columns that still have no Person relation. A UNION
     *  rather than two optional props: both-optional type-checks with NEITHER given, and
     *  renders an empty cell for a row that has people. */
    | { persons?: never; values: string[]; people: PersonLike[] }
  ),
) {
  // ONE body over a mixed list, because the separator, the wrapper and the empty branch
  // are the same in both modes — two bodies meant every future edit to them had to land
  // twice, and nothing would have said so.
  const items: (PersonRef | string)[] = props.persons ?? props.values;
  if (items.length === 0) return <span className={styles.empty}>{props.emptyLabel}</span>;
  return (
    <span className={styles.list}>
      {items.map((item, idx) => (
        <React.Fragment key={typeof item === 'string' ? item : item.id}>
          {idx > 0 && ', '}
          {typeof item === 'string'
            ? <PersonCell value={item} people={props.people} />
            : <PersonCell person={item} />}
        </React.Fragment>
      ))}
    </span>
  );
}
