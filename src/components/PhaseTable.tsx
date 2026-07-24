'use client';

import React from 'react';
import DataTable from './DataTable';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './TemplateEditor.module.css';

// The phases datatable — one scannable view of a phase set, shared by every surface
// that lists phases: the template editor (its read-only built-in view AND, beneath the
// live card-DAG canvas, the editable one) and the program phase editor. It is a thin
// wrapper over the shared DataTable (#112 moved the phase list onto DataTable; this
// centralises the columns + row so every surface renders the identical table): frozen
// pear identity column, one type grammar, sortable headers, never paged.
// Columns: Phase (+ derived End tag), optional Lead, Weeks, upstream Depends-on names.
// A read-only caller omits `onSelect` and gets plain names; the live editor passes it,
// so a row click selects that node in the diagram — the table and the canvas are two
// views of one draft.

export interface PhaseTableRow {
  id: number;
  name: string;
  isEndPhase: boolean;
  weeks: number;
  dependsOnNames: string[]; // upstream names; '' entries (an unresolved id) are dropped
  leadRole?: string | null; // shown only when showLead (template flavour)
}

interface PhaseTableProps {
  rows: PhaseTableRow[];
  showLead?: boolean;
  selectedId?: number | null;
  onSelect?: (id: number) => void;
}

export default function PhaseTable({ rows, showLead = false, selectedId = null, onSelect }: PhaseTableProps) {
  const locale = useLocale();
  if (rows.length === 0) return null;
  return (
    <DataTable
      headers={[
        { key: 'name', label: t(locale, 'phaseLabel') },
        ...(showLead ? [{ key: 'leadRole', label: t(locale, 'leadLabel') }] : []),
        { key: 'weeks', label: t(locale, 'weeksLabel'), sortType: 'number' },
        { key: 'dependsOn', label: t(locale, 'dependsOn'), sortable: false },
      ]}
      data={rows}
      // A phase set is a short fixed list — the program's own phases, capped by the plan,
      // never a page of a larger set (#125).
      paginate={false}
      renderRow={(r: PhaseTableRow) => {
        const label = r.name || t(locale, 'unnamed');
        const selected = onSelect ? r.id === selectedId : undefined;
        return (
          <tr key={r.id} data-testid="phase-table-row" aria-selected={selected}>
            <th scope="row">
              {onSelect ? (
                <button type="button"
                  className={`${styles.phaseNameBtn}${selected ? ` ${styles.phaseNameBtnSelected}` : ''}`}
                  onClick={() => onSelect(r.id)}>{label}</button>
              ) : (
                <span className={styles.phaseName}>{label}</span>
              )}
              {r.isEndPhase && <span className={styles.endTag}>{t(locale, 'endTag')}</span>}
            </th>
            {showLead && <td className={styles.muted}>{r.leadRole ?? '—'}</td>}
            <td className={styles.numeric}>{t(locale, 'weeksUnit', { n: r.weeks })}</td>
            <td className={styles.muted}>{r.dependsOnNames.filter(Boolean).join(', ') || '—'}</td>
          </tr>
        );
      }}
    />
  );
}
