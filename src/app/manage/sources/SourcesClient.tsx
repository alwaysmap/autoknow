'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import DateCell from '../../../components/DateCell';
import { useTableUrlSync } from '../../../lib/useTableUrlSync';
import type { TableSort } from '../../../lib/tableUrlState';
import { refreshSourceAction, toggleSourcePause, toggleSourceMode } from '../../actions/context';
import { inferSource } from '../../../lib/sources';
import { t, type StringKey } from '../../../lib/i18n';
import { useLocale } from '../../../components/LocaleProvider';

// Manage → Sources at operator scale (thousands of rows eventually). Same table
// grammar as every other listing now (#87): kind / tracking state / added-by are
// in-header funnel columns (not bespoke <select> bars), the free-text box is
// DataTable's own key-column filter, and every choice round-trips through the URL.
// The legend spells out exactly what each action does.

export interface SourceRow {
  id: number;
  url: string;
  title: string | null;
  type: string; // legacy 'Doc' | 'Chat' | 'Gerrit'
  mode: string;
  sourceRef: string | null;
  sourceStatus: string | null;
  addedBy: string | null;
  lastCheckedAt: string | null; // ISO
  createdAt: string; // ISO
  frozenReason: string | null;
  entityName: string | null;
  entityHref: string | null;
  revisions: number;
}

const FROZEN_KEY: Record<string, StringKey> = {
  'resolved': 'frzResolved',
  'access-revoked': 'frzAccess',
  'deleted': 'frzDeleted',
  'auth-required': 'frzAuth',
  'user-paused': 'frzPaused',
};

type KindId = 'drive' | 'chat' | 'tracker' | 'web';
const KIND_KEY: Record<KindId, StringKey> = {
  drive: 'kindDrive',
  chat: 'kindChat',
  tracker: 'kindTracker',
  web: 'kindWeb',
};

function kindOf(row: SourceRow): KindId {
  if (row.sourceRef?.startsWith('drive:')) return 'drive';
  if (row.type === 'Chat') return 'chat';
  const inferred = inferSource(row.url).kind;
  if (inferred === 'drive' || inferred === 'chat' || inferred === 'tracker') return inferred;
  if (row.type === 'Gerrit') return 'tracker';
  return 'web';
}

type StateId = 'watched' | 'snapshot' | 'frozen';
const stateOf = (row: SourceRow): StateId =>
  row.frozenReason ? 'frozen' : row.mode === 'watched' ? 'watched' : 'snapshot';

const btn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border, #ddd)',
  borderRadius: '0.375rem',
  padding: '0.1875rem 0.625rem',
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: 'var(--muted, #666)',
  cursor: 'pointer',
};

// Tracking-state → localized funnel label (canonical token stays in the URL).
const STATE_KEY: Record<StateId, StringKey> = {
  watched: 'chipWatched',
  snapshot: 'chipSnapshot',
  frozen: 'stateFrozen',
};

export default function SourcesClient({ sources, initialFilters, initialSort, initialQ = '' }: {
  sources: SourceRow[];
  initialFilters?: Record<string, string[]>;
  initialSort?: TableSort | null;
  /** Deep-linked key-column (title/url) filter text (?q=). */
  initialQ?: string;
}) {
  const locale = useLocale();
  // Column funnels (kind / tracking state / added-by) and the key-column filter text,
  // controlled here so every choice round-trips through the URL like the other listings.
  const [filters, setFilters] = useState<Record<string, string[]>>(initialFilters ?? {});
  const [sort, setSort] = useState<TableSort | null>(initialSort ?? null);
  const [text, setText] = useState(initialQ);
  useTableUrlSync(filters, sort, { q: text || null });

  // Rows carry canonical kind/state tokens for the funnels (locale-stable URL values,
  // lesson 3) alongside display-ready labels and the title sort key. DataTable does the
  // filtering now — funnels + key-column text — so there is no host-side predicate.
  const rows = useMemo(
    () =>
      sources.map((s) => {
        const kind = kindOf(s);
        return {
          ...s,
          kind,
          state: stateOf(s),
          kindLabel: t(locale, KIND_KEY[kind]),
          stateLabel: s.frozenReason
            ? t(locale, 'frozenLabel', { r: t(locale, FROZEN_KEY[s.frozenReason] ?? 'stateFrozen') })
            : t(locale, s.mode === 'watched' ? 'chipWatched' : 'chipSnapshot'),
          titleSort: (s.title || s.url).toLowerCase(),
        };
      }),
    [sources, locale],
  );

  return (
    <DataTable
      headers={[
        { key: 'titleSort', label: t(locale, 'colSource') },
        { key: 'kind', label: t(locale, 'colKind'), filterable: true, filterLabel: (v) => t(locale, KIND_KEY[v as KindId]) },
        { key: 'state', label: t(locale, 'colTracking'), filterable: true, filterLabel: (v) => t(locale, STATE_KEY[v as StateId]) },
        { key: 'addedBy', label: t(locale, 'colAddedBy'), filterable: true, filterValue: (row) => (row as SourceRow).addedBy || '—' },
        { key: 'lastCheckedAt', label: t(locale, 'colLastChecked') },
        { key: 'revisions', label: t(locale, 'colRevisions') },
        { key: 'actions', label: '', sortable: false },
      ]}
      data={rows}
      filters={filters}
      onFiltersChange={setFilters}
      textFilter={text}
      onTextFilterChange={setText}
      textFilterPlaceholder={t(locale, 'filterSourcesPlaceholder')}
      defaultSortKey={initialSort?.key ?? 'createdAt'}
      defaultSortOrder={initialSort?.dir ?? 'desc'}
      onSortChange={(key, dir) => setSort({ key, dir })}
      pageSize={25}
      renderRow={(s) => (
        <tr key={s.id} data-testid={`source-${s.id}`}>
          <td style={{ padding: '0.625rem 0.75rem 0.625rem 0', maxWidth: '22.5rem' }}>
            <a href={s.url} target="_blank" rel="noopener noreferrer"
              style={{ fontWeight: 600, color: 'var(--fg, #222)', textDecoration: 'none' }}>
              {s.title || s.url}
            </a>
            {s.entityName && (
              <div style={{ fontSize: '0.75rem', marginTop: '0.125rem' }}>
                {s.entityHref
                  ? <Link href={s.entityHref} style={{ color: 'var(--muted, #888)' }}>{s.entityName}</Link>
                  : <span style={{ color: 'var(--muted, #888)' }}>{s.entityName}</span>}
              </div>
            )}
          </td>
          <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--muted, #666)' }}>
            {s.kindLabel}
          </td>
          <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap' }}>
            <span style={{
              fontSize: '0.6875rem', fontWeight: 700, padding: '0.125rem 0.5625rem', borderRadius: '62.4375rem',
              border: '1px solid',
              borderColor: !s.frozenReason && s.mode === 'watched' ? 'var(--chain-soft, #c9b9e6)' : 'var(--border, #ddd)',
              color: !s.frozenReason && s.mode === 'watched' ? 'var(--chain-ink, #5a4488)' : 'var(--muted, #888)',
            }}>
              {s.stateLabel}
            </span>
          </td>
          <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--muted, #666)' }}>
            {s.addedBy || '—'}
          </td>
          <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--muted, #666)' }}>
            {!s.frozenReason && s.mode === 'watched'
              ? <DateCell value={s.lastCheckedAt} fallback={t(locale, 'neverChecked')} />
              : '—'}
          </td>
          <td style={{ padding: '0.625rem 0.75rem', whiteSpace: 'nowrap', fontSize: '0.75rem', color: 'var(--muted, #666)', fontVariantNumeric: 'tabular-nums' }}>
            {s.revisions}
          </td>
          <td style={{ padding: '0.625rem 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
            <div style={{ display: 'inline-flex', gap: '0.375rem' }}>
              {s.mode === 'watched' && (
                <>
                  <form action={refreshSourceAction} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" style={btn} title={t(locale, 'sourcesLegend')}>{t(locale, 'refreshNow')}</button>
                  </form>
                  <form action={toggleSourcePause} style={{ display: 'inline' }}>
                    <input type="hidden" name="id" value={s.id} />
                    <button type="submit" style={btn} title={t(locale, 'sourcesLegend')}>
                      {s.frozenReason === 'user-paused' ? t(locale, 'resumeLabel') : t(locale, 'pauseLabel')}
                    </button>
                  </form>
                </>
              )}
              <form action={toggleSourceMode} style={{ display: 'inline' }}>
                <input type="hidden" name="id" value={s.id} />
                <button type="submit" style={btn} title={t(locale, 'sourcesLegend')}>
                  {t(locale, s.mode === 'watched' ? 'chipSnapshot' : 'chipWatched')}
                </button>
              </form>
            </div>
          </td>
        </tr>
      )}
    />
  );
}
