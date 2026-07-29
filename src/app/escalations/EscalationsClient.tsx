'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import DateCell from '../../components/DateCell';
import ClassBox from '../../components/ClassBox';
import PageShell from '../../components/PageShell';
import PersonCell, { personRefFunnel, type PersonRef } from '../../components/PersonCell';
import { NewEscalationButton } from '../../components/EscalationEditor';
import { useTableUrlSync } from '../../lib/useTableUrlSync';
import type { TableSort } from '../../lib/tableUrlState';
import {
  ORG_LEVEL_KEY,
  SEVERITY_KEY,
  STATUS_DISPLAY_KEY,
  UNTRIAGED,
  isOpen,
  isOverdue,
  orgLevelRank,
  orgLevelToken,
  severityRank,
  severityToken,
  targetRank,
  type EscalationOrgLevel,
  type EscalationSeverity,
  type EscalationStatus,
} from '../../lib/escalation';
import { escalationHref, partnerHref, programHref } from '../../lib/entityHref';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';
import styles from './page.module.css';

// The escalations list (#245 part a). design.md §6 grammar throughout: sortable headers,
// per-column funnels, shareable URL state, the key-column filter box, `<th scope="row">`
// identity column, `DateCell` for dates, `PersonCell` for the three person columns.
//
// Severity and org level are `ClassBox` category boxes, NOT filled badges: they mark a
// CLASS this escalation shares with others, so §6's box-vs-pill rule makes them boxes, and
// the SHAPE-marks-the-kind rule makes them filter their own column on click rather than
// navigate. Status is the same kind of thing and behaves identically.

interface Escalation {
  id: number;
  title: string;
  status: EscalationStatus;
  severity: EscalationSeverity | null;
  orgLevel: EscalationOrgLevel | null;
  createdAt: string;
  targetDate: string | null;
  partner: { id: number; name: string } | null;
  project: { id: number; name: string } | null;
  owner: PersonRef | null;
  decisionMaker: PersonRef | null;
}

interface Option {
  id: number;
  name: string;
}

export default function EscalationsClient({
  escalations, partners, projects, people, initialFilters, initialSort, initialQ = '',
}: {
  escalations: Escalation[];
  partners: Option[];
  projects: Option[];
  people: Option[];
  initialFilters?: Record<string, string[]>;
  initialSort?: TableSort | null;
  initialQ?: string;
}) {
  const locale = useLocale();
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const [text, setText] = useState(initialQ);
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);
  useTableUrlSync(filters, sort, { q: text || null });

  // Sort keys are RANKS, not the enum strings: sorting `severity` alphabetically puts s1
  // beside s2 by luck and would put a fourth value anywhere. The rank is also what places
  // untriaged rows LAST rather than first (lib/escalation explains why that is the honest
  // reading rather than a tidy default).
  const rows = useMemo(
    () =>
      escalations.map((e) => ({
        ...e,
        severityRank: severityRank(e.severity),
        orgLevelRank: orgLevelRank(e.orgLevel),
        // One column, so one predicate: open-ness is what the default sort leads on.
        openRank: isOpen(e.status) ? 0 : 1,
      })),
    [escalations],
  );

  /** A class cell: the box IS the signal, and clicking it REPLACES this column's filter
   *  (design.md §6 — the header funnel is the multi-value OR tool). */
  const classCell = (column: string, columnLabel: string, token: string, label: string) => (
    <button
      type="button"
      onClick={() => setFilters((f) => ({ ...f, [column]: [token] }))}
      className={styles.classFilterBtn}
      title={t(locale, 'filterColumn', { c: columnLabel })}
    >
      <ClassBox className={styles.classInk}>{label}</ClassBox>
    </button>
  );

  const severityLabel = (v: EscalationSeverity | null) =>
    v == null ? t(locale, 'escUntriaged') : t(locale, SEVERITY_KEY[v]);
  const orgLevelLabel = (v: EscalationOrgLevel | null) =>
    v == null ? t(locale, 'escUntriaged') : t(locale, ORG_LEVEL_KEY[v]);

  return (
    <PageShell
      title={t(locale, 'escalationsLabel')}
      // No maxWidth, like /programs: nine columns, one of them a SENTENCE. Capping the
      // content column made auto table layout squeeze the statement to three lines while
      // its token neighbours sat half empty — the cap was buying nothing and costing the
      // one column anybody reads the row for.
      actions={<NewEscalationButton partners={partners} projects={projects} people={people} />}
    >
      <section className={styles.tableSection}>
        <DataTable
          headers={[
            // The widest column by a distance, because it is the only one holding a
            // SENTENCE — the rest are tokens, names and a date. Left narrow it wrapped to
            // three lines while its neighbours sat half empty.
            { key: 'title', label: t(locale, 'escStatement'), width: '26rem' },
            {
              key: 'status', label: t(locale, 'statusLabel'), filterable: true,
              // The stored enum value is the shareable token; the label is display-only,
              // so `?status=resolved` names the same class in every locale (lesson 3).
              filterValue: (row) => (row as Escalation).status,
              filterLabel: (v) => t(locale, STATUS_DISPLAY_KEY[v as EscalationStatus]),
              sortValue: (row) => (row as { openRank: number }).openRank,
            },
            {
              key: 'severity', label: t(locale, 'escSeverityLabel'), filterable: true,
              filterValue: (row) => severityToken((row as Escalation).severity),
              filterLabel: (v) =>
                v === UNTRIAGED ? t(locale, 'escUntriaged') : t(locale, SEVERITY_KEY[v as EscalationSeverity]),
              sortValue: (row) => (row as { severityRank: number }).severityRank,
            },
            {
              key: 'orgLevel', label: t(locale, 'escOrgLevelLabel'), filterable: true,
              filterValue: (row) => orgLevelToken((row as Escalation).orgLevel),
              filterLabel: (v) =>
                v === UNTRIAGED ? t(locale, 'escUntriaged') : t(locale, ORG_LEVEL_KEY[v as EscalationOrgLevel]),
              sortValue: (row) => (row as { orgLevelRank: number }).orgLevelRank,
            },
            {
              key: 'partner', label: t(locale, 'partnerLabel'), filterable: true,
              filterValue: (row) => (row as Escalation).partner?.name ?? '—',
              sortValue: (row) => (row as Escalation).partner?.name ?? '',
            },
            {
              key: 'project', label: t(locale, 'programLabel'), filterable: true,
              filterValue: (row) => (row as Escalation).project?.name ?? '—',
              sortValue: (row) => (row as Escalation).project?.name ?? '',
            },
            {
              // Keyed on the person's id via the FK, never on a name or an address
              // (#127 E7 / the person-funnel ADR).
              key: 'owner', label: t(locale, 'escOwner'), filterable: true,
              ...personRefFunnel(escalations, (e) => e.owner),
            },
            {
              key: 'decisionMaker', label: t(locale, 'escDecisionMaker'), filterable: true,
              ...personRefFunnel(escalations, (e) => e.decisionMaker),
            },
            { key: 'createdAt', label: t(locale, 'escRaisedOn') },
            {
              // NULLs sort LAST via targetRank — a missing target is "nobody said", not
              // "infinitely soon". RESOLVED is deliberately not a column: it is empty for
              // every open row, which is most of them, so it lives on the detail page.
              key: 'targetDate', label: t(locale, 'escTargetDate'),
              sortValue: (row) => targetRank((row as Escalation).targetDate),
            },
          ]}
          data={rows}
          renderRow={(e: (typeof rows)[number]) => (
            <tr key={e.id}>
              <th scope="row">
                <Link href={escalationHref(e.id)} className={styles.tableLink}>{e.title}</Link>
              </th>
              <td>
                {classCell('status', t(locale, 'statusLabel'), e.status, t(locale, STATUS_DISPLAY_KEY[e.status]))}
              </td>
              <td>
                {classCell('severity', t(locale, 'escSeverityLabel'), severityToken(e.severity), severityLabel(e.severity))}
              </td>
              <td>
                {classCell('orgLevel', t(locale, 'escOrgLevelLabel'), orgLevelToken(e.orgLevel), orgLevelLabel(e.orgLevel))}
              </td>
              {/* A partner and a program are NOUNS: they navigate to their own route and
                  never filter (§6, issue #30). */}
              <td>
                {e.partner
                  ? <Link href={partnerHref(e.partner.id)} className={styles.tableLink}>{e.partner.name}</Link>
                  : <span className={styles.empty}>—</span>}
              </td>
              <td>
                {e.project
                  ? <Link href={programHref(e.project.id)} className={styles.tableLink}>{e.project.name}</Link>
                  : <span className={styles.empty}>—</span>}
              </td>
              <td><PersonCell person={e.owner} fallback={t(locale, 'escUnassigned')} /></td>
              <td><PersonCell person={e.decisionMaker} fallback={t(locale, 'escUnassigned')} /></td>
              <td><DateCell value={e.createdAt} /></td>
              <td>
                {e.targetDate ? (
                  <span
                    className={isOverdue(e.targetDate, e.status) ? styles.overdue : undefined}
                    title={isOverdue(e.targetDate, e.status) ? t(locale, 'escOverdueTitle') : undefined}
                  >
                    <DateCell value={e.targetDate} />
                  </span>
                ) : (
                  <span className={styles.empty}>—</span>
                )}
              </td>
            </tr>
          )}
          // Severity leads the default sort among open escalations (#245): `openRank`
          // cannot be the default key AND severity too, so the rows arrive from the server
          // already ordered open-first, and this sorts the severity within that.
          defaultSortKey={initialSort?.key ?? 'severity'}
          defaultSortOrder={initialSort?.dir ?? 'asc'}
          onSortChange={(key, dir) => setSort({ key, dir })}
          filters={filters}
          onFiltersChange={setFilters}
          textFilter={text}
          onTextFilterChange={setText}
          textFilterPlaceholder={t(locale, 'filterEscalationsPlaceholder')}
          emptyStateMessage={
            escalations.length === 0 ? t(locale, 'noEscalations') : t(locale, 'noEscalationsMatchFilters')
          }
        />
      </section>
    </PageShell>
  );
}
