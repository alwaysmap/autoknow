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

export interface EscalationRow {
  id: number;
  title: string;
  status: EscalationStatus;
  severity: EscalationSeverity | null;
  orgLevel: EscalationOrgLevel | null;
  createdAt: string;
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
      {escalations.map((e) => (
        // Open escalations read at full contrast; closed ones recede — the difference
        // between "somebody still owes an answer" and "this is history" is the only
        // thing a reader scanning this list is looking for.
        <li key={e.id} className={isOpen(e.status) ? styles.row : styles.rowClosed}>
          <Link href={escalationHref(e.id)} className={styles.title}>{e.title}</Link>
          <span className={styles.facts}>
            {e.entityLabel && (
              <>
                <span className={styles.fact}>{e.entityLabel}</span>
                <span className={styles.sep}>·</span>
              </>
            )}
            <span className={styles.fact}>{t(locale, STATUS_DISPLAY_KEY[e.status])}</span>
            {e.severity && (
              <>
                <span className={styles.sep}>·</span>
                <span className={styles.fact}>{t(locale, SEVERITY_KEY[e.severity])}</span>
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
      ))}
    </ul>
  );
}
