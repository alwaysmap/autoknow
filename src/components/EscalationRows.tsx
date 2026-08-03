import React from 'react';
import Link from 'next/link';
import PersonCell, { type PersonRef } from './PersonCell';
import DateCell from './DateCell';
import { escalationHref } from '../lib/entityHref';
import {
  ORG_LEVEL_KEY,
  SEVERITY_KEY,
  STATUS_DISPLAY_KEY,
  isOpen,
  isOverdue,
  type EscalationOrgLevel,
  type EscalationSeverity,
  type EscalationStatus,
} from '../lib/escalation';
import { t, type Locale } from '../lib/i18n';
import styles from './EscalationRows.module.css';

// An entity's escalations, condensed to one line each — the section /partners/:id and
// /programs/:id carry. Presentational and pure, so both server pages render it directly.
//
// NOT a `DataTable`: this is a fixed short panel about ONE entity, and design.md §6's
// grammar (funnels, shareable per-column URL state, a filter box) is the grammar of a
// BROWSABLE LISTING. The full listing exists — `/escalations` — and the heading links
// there, which is where filtering belongs.
//
// Status, severity and org level render as quiet muted TEXT here, deliberately not as
// `ClassBox`es. A class box filters its own column on click, and there is no column here
// to filter: an inert `ClassBox` that does nothing when clicked is a bug by §6's own
// wording, so the box does not appear outside a filterable column.
//
// URGENT rows carry a mark; the rest do not (2026-08-03, user call). The mark is scoped
// to `urgencyOf` — S1, or open past its target — deliberately rather than given to every
// row: a marker on every item marks nothing, and §8c keeps icons scarce. It is an inline
// SVG in `--bad`, not an emoji: an emoji is a colour the theme cannot restyle (it stays
// bright in dark mode), it renders differently per OS, and it announces on every row.
// The glyph carries `role="img"` + a localized `aria-label`, and the FACT that made the
// row urgent is re-inked to match — two coordinated signals from one predicate, so the
// urgency is never colour alone.

export interface EscalationRow {
  id: number;
  title: string;
  status: EscalationStatus;
  severity: EscalationSeverity | null;
  orgLevel: EscalationOrgLevel | null;
  createdAt: string;
  /** The day somebody committed to. Read here only to derive `isOverdue` — the panel
   *  does not print it (that is the detail page's Opened/Target/Resolved trio, #245 e). */
  targetDate: string | null;
  owner: PersonRef | null;
  /** What this escalation is ABOUT, when the panel spans more than one entity (the
   *  ecosystem and person pre-canned views, #245 section C) — the partner or program
   *  name. Absent on the partner/program pages themselves: a partner's own escalation
   *  section does not need to be told it is about that partner, the same rule the
   *  activity feed's `meta()` follows for the same reason. Plain text, not a link — the
   *  ROW's own link (the title) is where this panel points; a second link per row would
   *  be two doors for one decision. */
  entityLabel?: string | null;
}

/**
 * The two ways an open escalation is asking for attention TODAY: it was triaged as the
 * top severity, or the day someone committed to has passed. Read off the row — no new
 * field, no cron (see `isOverdue`).
 *
 * Returned as a pair rather than a boolean because the row needs BOTH answers: `urgent`
 * decides the mark, and each reason inks the word that earned it. Deriving them here once
 * is the point — an inlined `severity === 's1'` at the render site would be a second
 * spelling of half this rule, free to drift from the mark it is supposed to agree with
 * (AGENTS lesson 7).
 */
function urgencyOf(e: EscalationRow): { urgent: boolean; overdue: boolean; criticalOpen: boolean } {
  const overdue = isOverdue(e.targetDate, e.status);
  const criticalOpen = isOpen(e.status) && e.severity === 's1';
  return { urgent: overdue || criticalOpen, overdue, criticalOpen };
}

/** The urgency mark: a warning triangle whose counters are HOLES, not paint. One path
 *  with `fill-rule="evenodd"` rather than two `--paper` rectangles over it, because
 *  painting the background colour makes the glyph care what it sits on — and on
 *  `/ecosystem` it now sits on a tinted panel, so the painted version would carry a patch
 *  of the wrong ground with it. Geometry in `viewBox` units; the rendered size is `rem`
 *  (§9), pinned to the same type scale as the `.mark` offset that centres it. */
const UrgentMark = ({ label }: { label: string }) => (
  <svg className={styles.mark} viewBox="0 0 12 12" role="img" aria-label={label}>
    <path
      fillRule="evenodd"
      fill="currentColor"
      d="M6 1.2 11.2 10.6H0.8L6 1.2Z M5.4 4.6h1.2v3H5.4z M5.4 8.3h1.2v1.2H5.4z"
    />
  </svg>
);

/** One row. A component rather than an inlined block so the per-row derivations have a
 *  home ABOVE the JSX instead of inside the map. */
function EscalationItem({ e, locale }: { e: EscalationRow; locale: Locale }) {
  const { urgent, overdue, criticalOpen } = urgencyOf(e);
  return (
    // Open escalations read at full contrast; closed ones recede — the difference between
    // "somebody still owes an answer" and "this is history" is the only thing a reader
    // scanning this list is looking for.
    <li className={isOpen(e.status) ? styles.row : styles.rowClosed}>
      {urgent && <UrgentMark label={t(locale, 'escUrgentMark')} />}
      <Link href={escalationHref(e.id)} className={styles.title}>{e.title}</Link>
      <span className={styles.facts}>
        {e.entityLabel && (
          <>
            <span className={styles.fact}>{e.entityLabel}</span>
            <span className={styles.sep}>·</span>
          </>
        )}
        <span className={styles.fact}>{t(locale, STATUS_DISPLAY_KEY[e.status])}</span>
        {/* The facts that MADE the row urgent, re-inked to match the mark, so the urgency
            is carried by a word as well as by a colour. */}
        {overdue && (
          <>
            <span className={styles.sep}>·</span>
            <span className={styles.urgentFact}>{t(locale, 'escOverdue')}</span>
          </>
        )}
        {e.severity && (
          <>
            <span className={styles.sep}>·</span>
            <span className={criticalOpen ? styles.urgentFact : styles.fact}>
              {t(locale, SEVERITY_KEY[e.severity])}
            </span>
          </>
        )}
        {e.orgLevel && (
          <>
            <span className={styles.sep}>·</span>
            <span className={styles.fact}>{t(locale, ORG_LEVEL_KEY[e.orgLevel])}</span>
          </>
        )}
        <span className={styles.sep}>·</span>
        <span className={styles.fact}>
          <PersonCell person={e.owner} fallback={t(locale, 'escUnassigned')} />
        </span>
        <span className={styles.sep}>·</span>
        <span className={styles.fact}><DateCell value={e.createdAt} /></span>
      </span>
    </li>
  );
}

export default function EscalationRows({
  escalations,
  locale,
  emptyLabel,
}: {
  escalations: EscalationRow[];
  locale: Locale;
  /** Override the generic "No escalations." — the ecosystem panel shows only OPEN rows,
   *  so an empty result there reads better as "No open escalations." (#245 section C
   *  decision 13: empty is a real state and says so). */
  emptyLabel?: string;
}) {
  if (escalations.length === 0) {
    return <p className={styles.empty}>{emptyLabel ?? t(locale, 'escNoneForEntity')}</p>;
  }

  return (
    <ul className={styles.list}>
      {escalations.map((e) => <EscalationItem key={e.id} e={e} locale={locale} />)}
    </ul>
  );
}
