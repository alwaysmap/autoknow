'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import DateCell from '../../../components/DateCell';
import { refreshSourceAction, toggleSourcePause, toggleSourceMode } from '../../actions/context';
import { inferSource } from '../../../lib/sources';
import { t, type StringKey } from '../../../lib/i18n';
import { useLocale } from '../../../components/LocaleProvider';

// Manage → Sources at operator scale (thousands of rows eventually): sortable
// columns via DataTable, client-side filters for kind / tracking state / who added
// it, plus free-text. The legend spells out exactly what each action does.

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
  borderRadius: 6,
  padding: '3px 10px',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted, #666)',
  cursor: 'pointer',
};

const select: React.CSSProperties = {
  fontSize: 12,
  padding: '4px 8px',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 6,
  background: 'var(--white, #fff)',
  color: 'var(--fg, #222)',
};

export default function SourcesClient({ sources }: { sources: SourceRow[] }) {
  const locale = useLocale();
  const [text, setText] = useState('');
  const [kind, setKind] = useState<'all' | KindId>('all');
  const [state, setState] = useState<'all' | StateId>('all');
  const [person, setPerson] = useState('all');

  const people = useMemo(
    () => [...new Set(sources.map((s) => s.addedBy).filter(Boolean))].sort() as string[],
    [sources],
  );

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase();
    return sources
      .filter((s) => {
        if (kind !== 'all' && kindOf(s) !== kind) return false;
        if (state !== 'all' && stateOf(s) !== state) return false;
        if (person !== 'all' && s.addedBy !== person) return false;
        if (q && ![s.title, s.url, s.entityName, s.addedBy].some((v) => v?.toLowerCase().includes(q))) return false;
        return true;
      })
      .map((s) => ({
        ...s,
        // Sortable, display-ready derivations.
        kindLabel: t(locale, KIND_KEY[kindOf(s)]),
        stateLabel: s.frozenReason
          ? t(locale, 'frozenLabel', { r: t(locale, FROZEN_KEY[s.frozenReason] ?? 'stateFrozen') })
          : t(locale, s.mode === 'watched' ? 'chipWatched' : 'chipSnapshot'),
        titleSort: (s.title || s.url).toLowerCase(),
      }));
  }, [sources, text, kind, state, person, locale]);

  return (
    <>
      {/* filters: free text + the three facets that matter at scale */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '0 0 14px' }}>
        <input
          type="search"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t(locale, 'searchSourcesPlaceholder')}
          style={{ ...select, flex: '1 1 260px', minWidth: 200, padding: '6px 10px' }}
        />
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} style={select} aria-label={t(locale, 'colKind')}>
          <option value="all">{t(locale, 'filterAllKinds')}</option>
          {(Object.keys(KIND_KEY) as KindId[]).map((k) => (
            <option key={k} value={k}>{t(locale, KIND_KEY[k])}</option>
          ))}
        </select>
        <select value={state} onChange={(e) => setState(e.target.value as typeof state)} style={select} aria-label={t(locale, 'colTracking')}>
          <option value="all">{t(locale, 'filterAllStates')}</option>
          <option value="watched">{t(locale, 'chipWatched')}</option>
          <option value="snapshot">{t(locale, 'chipSnapshot')}</option>
          <option value="frozen">{t(locale, 'stateFrozen')}</option>
        </select>
        <select value={person} onChange={(e) => setPerson(e.target.value)} style={select} aria-label={t(locale, 'colAddedBy')}>
          <option value="all">{t(locale, 'filterEveryone')}</option>
          {people.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      <DataTable
        headers={[
          { key: 'titleSort', label: t(locale, 'colSource') },
          { key: 'kindLabel', label: t(locale, 'colKind') },
          { key: 'stateLabel', label: t(locale, 'colTracking') },
          { key: 'addedBy', label: t(locale, 'colAddedBy') },
          { key: 'lastCheckedAt', label: t(locale, 'colLastChecked') },
          { key: 'revisions', label: t(locale, 'colRevisions') },
          { key: 'actions', label: '', sortable: false },
        ]}
        data={rows}
        defaultSortKey="createdAt"
        defaultSortOrder="desc"
        pageSize={25}
        renderRow={(s) => (
          <tr key={s.id} data-testid={`source-${s.id}`}>
            <td style={{ padding: '10px 12px 10px 0', maxWidth: 360 }}>
              <a href={s.url} target="_blank" rel="noopener noreferrer"
                style={{ fontWeight: 600, color: 'var(--fg, #222)', textDecoration: 'none' }}>
                {s.title || s.url}
              </a>
              {s.entityName && (
                <div style={{ fontSize: 11.5, marginTop: 2 }}>
                  {s.entityHref
                    ? <Link href={s.entityHref} style={{ color: 'var(--muted, #888)' }}>{s.entityName}</Link>
                    : <span style={{ color: 'var(--muted, #888)' }}>{s.entityName}</span>}
                </div>
              )}
            </td>
            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted, #666)' }}>
              {s.kindLabel}
            </td>
            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
              <span style={{
                fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
                border: '1px solid',
                borderColor: !s.frozenReason && s.mode === 'watched' ? 'var(--chain-soft, #c9b9e6)' : 'var(--border, #ddd)',
                color: !s.frozenReason && s.mode === 'watched' ? 'var(--chain-ink, #5a4488)' : 'var(--muted, #888)',
              }}>
                {s.stateLabel}
              </span>
            </td>
            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted, #666)' }}>
              {s.addedBy || '—'}
            </td>
            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted, #666)' }}>
              {!s.frozenReason && s.mode === 'watched'
                ? <DateCell value={s.lastCheckedAt} fallback={t(locale, 'neverChecked')} />
                : '—'}
            </td>
            <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted, #666)', fontVariantNumeric: 'tabular-nums' }}>
              {s.revisions}
            </td>
            <td style={{ padding: '10px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
              <div style={{ display: 'inline-flex', gap: 6 }}>
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
    </>
  );
}
