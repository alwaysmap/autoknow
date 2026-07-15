'use client';

import React, { useMemo, useRef, useState, useTransition } from 'react';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import { validateTemplateDag } from '../lib/templateDag';
import { deriveEndPhase } from '../lib/programDag';
import { computeDagLayout } from '../lib/dagLayout';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import chrome from './TemplateEditor.module.css';
import styles from './ProgramPhaseEditor.module.css';

// THE phase-structure editor — one surface for building template phase layouts and
// for updating a live program's layout. Small name-only nodes on a snap grid, flowing
// TOP → BOTTOM by dependency depth, with drawn edges. General DAGs are first-class:
// any node may have many concurrent upstreams (fan-in) and many downstreams
// (fan-out); the ONLY structural constraints are acyclic + a single final node, and
// they're enforced live (banner + disabled Save) and again server-side on save.
// Interactions:
//   · click a node → detail panel (rename, WEEKS, disconnect, remove; templates add
//     lead role / description / Google focus)
//   · rewire by drag/drop (drop a node onto its new upstream; the ghost snaps to the
//     grid), or click a second node and CONNECT in EITHER direction — "X after Y"
//     (X depends on Y) or "X before Y" (Y depends on X) — so a new phase can be
//     wired in upstream of existing work just as easily as downstream

export interface DagEditorNode {
  id: number; // real id; new nodes get negative ids client-side
  name: string;
  weeks: number; // the editor speaks weeks; wrappers convert to their storage unit
  dependsOn: number[];
  progress?: number; // programs: >0 means history exists → confirm removal
  leadRole?: string | null; // template-only fields ↓
  description?: string | null;
  googleFocus?: string | null;
}

interface PhaseDagEditorProps {
  initial: DagEditorNode[];
  onSave: (draft: DagEditorNode[]) => Promise<{ error?: string }>;
  templateFields?: boolean; // show leadRole/description/googleFocus in the panel
  leadRoles?: string[];
  defaultWeeks?: number;
}

const GRID = 24;
// Node + gap sizes are grid multiples (row step = 4×GRID, column step = 7×GRID), so
// the resting layout and the drag ghost snap to the same lattice.
const CARD_W = GRID * 6, CARD_H = GRID * 1.5, GAP_X = GRID, GAP_Y = GRID * 2.5, PAD = GRID;
const snapTo = (v: number) => Math.round(v / GRID) * GRID;

export default function PhaseDagEditor({ initial, onSave, templateFields, leadRoles, defaultWeeks = 4 }: PhaseDagEditorProps) {
  const locale = useLocale();
  const [draft, setDraft] = useState<DagEditorNode[]>(initial);
  const [nextNewId, setNextNewId] = useState(-1);
  const [selectedId, setSelectedId] = useState<number | null>(null); // panel owner (the DOWNSTREAM side)
  const [otherId, setOtherId] = useState<number | null>(null); // CONNECT candidate
  const [serverError, setServerError] = useState('');
  const [saving, startSaving] = useTransition();

  // After a save the parent refreshes and hands down the persisted graph (temp
  // negative ids became real). Re-sync the draft when the CONTENT changes — identity
  // changes on every parent render, so compare by value.
  const [syncedTo, setSyncedTo] = useState(() => JSON.stringify(initial));
  const incoming = JSON.stringify(initial);
  if (incoming !== syncedTo) {
    setSyncedTo(incoming);
    setDraft(initial);
    setSelectedId(null);
    setOtherId(null);
  }

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initial), [draft, initial]);
  const byId = new Map(draft.map((d) => [d.id, d]));
  const selected = selectedId != null ? byId.get(selectedId) : null;

  // ---- validation: acyclic + single final node (the end is the derived sink) ----
  const withEnd = useMemo(
    () => deriveEndPhase(draft.map((d, i) => ({ id: d.id, name: d.name, sortOrder: i, dependsOn: d.dependsOn }))),
    [draft],
  );
  const validation = useMemo(
    () =>
      validateTemplateDag(
        withEnd.map((n) => ({ id: n.id, isEndPhase: n.isEndPhase, name: n.name })),
        draft.flatMap((d) => d.dependsOn.map((up) => ({ nodeId: d.id, dependsOnId: up }))),
      ),
    [withEnd, draft],
  );
  // With a cycle there are no sinks, so "mark an end phase" is noise — the cycle is the news.
  const errors = validation.errors.filter(
    (e) => !(e.code === 'no-end-phase' && validation.errors.some((x) => x.code === 'cycle')),
  );
  const endId = withEnd.find((n) => n.isEndPhase)?.id;

  // ---- layout: shared layered layout (fan-in/fan-out aware, grid-snapped) ----
  const layout = useMemo(
    () => computeDagLayout(draft.map((d) => ({ id: d.id, dependsOn: d.dependsOn })), {
      cardW: CARD_W, cardH: CARD_H, gapX: GAP_X, gapY: GAP_Y, pad: PAD, grid: GRID,
    }),
    [draft],
  );

  // ---- draft mutations ----
  const patch = (id: number, part: Partial<DagEditorNode>) =>
    setDraft((ds) => ds.map((d) => (d.id === id ? { ...d, ...part } : d)));
  const connect = (downstream: number, upstream: number) => {
    if (downstream === upstream) return;
    setDraft((ds) =>
      ds.map((d) =>
        d.id === downstream && !d.dependsOn.includes(upstream)
          ? { ...d, dependsOn: [...d.dependsOn, upstream] }
          : d,
      ),
    );
    setOtherId(null);
  };
  const disconnect = (downstream: number, upstream: number) =>
    setDraft((ds) => ds.map((d) => (d.id === downstream ? { ...d, dependsOn: d.dependsOn.filter((x) => x !== upstream) } : d)));
  const addPhase = () => {
    const id = nextNewId;
    setDraft((ds) => [...ds, { id, name: '', weeks: defaultWeeks, dependsOn: [] }]);
    setNextNewId((n) => n - 1);
    setSelectedId(id);
    setOtherId(null);
  };
  const removePhase = (id: number) => {
    const p = byId.get(id);
    if (p && p.id > 0 && (p.progress ?? 0) > 0 && !confirm(t(locale, 'removePhaseHistoryConfirm', { name: p.name }))) return;
    setDraft((ds) => ds.filter((d) => d.id !== id).map((d) => ({ ...d, dependsOn: d.dependsOn.filter((x) => x !== id) })));
    setSelectedId(null);
    setOtherId(null);
  };

  // ---- click / drag plumbing ----
  // Click semantics: no panel → open the node's panel; panel open → the second node
  // becomes the CONNECT candidate, joinable in EITHER direction (after/before). A real
  // drag (moved past the threshold) suppresses the click and drops onto the new upstream.
  const dragState = useRef<{ id: number; x0: number; y0: number; moved: boolean } | null>(null);
  const [dragPos, setDragPos] = useState<{ id: number; dx: number; dy: number } | null>(null);
  const suppressClick = useRef(false);

  const onCardPointerDown = (id: number) => (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('input, button, a')) return;
    dragState.current = { id, x0: e.clientX, y0: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onCardPointerMove = (e: React.PointerEvent) => {
    const s = dragState.current;
    if (!s) return;
    const dx = e.clientX - s.x0, dy = e.clientY - s.y0;
    if (!s.moved && Math.hypot(dx, dy) < 6) return;
    s.moved = true;
    setDragPos({ id: s.id, dx, dy });
  };
  const onCardPointerUp = (e: React.PointerEvent) => {
    const s = dragState.current;
    dragState.current = null;
    setDragPos(null);
    if (!s?.moved) return;
    suppressClick.current = true; // the browser fires click after pointerup — ignore it
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-card-id]');
    const targetId = el ? parseInt(el.getAttribute('data-card-id')!, 10) : NaN;
    if (!isNaN(targetId) && targetId !== s.id) connect(s.id, targetId); // dragged node comes AFTER the drop target
  };
  const onCardClick = (id: number) => () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (selectedId == null || selectedId === id) {
      setSelectedId(id);
      setOtherId(null);
    } else {
      setOtherId((u) => (u === id ? null : id)); // second click arms CONNECT
    }
  };

  const save = () =>
    startSaving(async () => {
      const result = await onSave(draft);
      if (result.error) setServerError(result.error);
    });

  // Edges from positions: bottom-center of upstream → top-center of downstream.
  const edges = draft.flatMap((d) =>
    d.dependsOn.filter((up) => layout.pos.has(up)).map((up) => {
      const a = layout.pos.get(up)!, b = layout.pos.get(d.id)!;
      const x1 = a.x + CARD_W / 2, y1 = a.y + CARD_H, x2 = b.x + CARD_W / 2, y2 = b.y;
      return { key: `${up}-${d.id}`, d: `M ${x1} ${y1} C ${x1} ${y1 + GAP_Y * 0.6}, ${x2} ${y2 - GAP_Y * 0.6}, ${x2} ${y2}` };
    }),
  );

  return (
    <div>
      <div className={chrome.tableHead}>
        <button type="button" className={chrome.primaryBtn} onClick={addPhase}>{t(locale, 'addPhase')}</button>
        <button
          type="button"
          data-testid="dag-save"
          className={chrome.primaryBtn}
          disabled={!validation.ok || !dirty || saving}
          onClick={save}
          title={!validation.ok ? t(locale, 'fixGraphErrors') : undefined}
        >
          {saving ? t(locale, 'saving') : t(locale, 'saveBtn')}
        </button>
      </div>

      <p className={styles.hint}>
        {t(locale, 'dagHintIntro')}
        <strong> {t(locale, 'dagAfterQ')}</strong> {t(locale, 'dagOr')} <strong>{t(locale, 'dagBeforeQ')}</strong>{' '}
        {t(locale, 'dagHintRest')}
      </p>

      {/* live DAG validation — the same rules the save re-checks server-side */}
      {errors.length > 0 && (
        <div className={chrome.dagErrors} data-testid="dag-errors">
          {errors.map((e, i) => <div key={i}>{e.message}</div>)}
        </div>
      )}
      {serverError && <div className={chrome.dagErrors} data-testid="save-error">{serverError}</div>}

      <div className={styles.wrap}>
        <div className={styles.canvasWrap}>
          <div className={styles.canvas} style={{ width: layout.w, height: layout.h }}
            onClick={() => { setSelectedId(null); setOtherId(null); }}>
            <svg className={styles.edges} width={layout.w} height={layout.h} aria-hidden>
              <defs>
                <marker id="dagArrow" viewBox="0 0 8 8" refX={7} refY={4} markerWidth={7} markerHeight={7} orient="auto">
                  <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--muted)" />
                </marker>
              </defs>
              {edges.map((e) => (
                <path key={e.key} d={e.d} fill="none" stroke="var(--muted)" strokeWidth={1.6} markerEnd="url(#dagArrow)" />
              ))}
            </svg>

            {draft.map((d) => {
              const p = layout.pos.get(d.id)!;
              const drag = dragPos?.id === d.id ? dragPos : null;
              const cls = [
                styles.node,
                d.id === endId ? styles.nodeEnd : '',
                d.id === selectedId ? styles.nodeSelected : '',
                d.id === otherId ? styles.nodeUpstream : '',
                drag ? styles.nodeDragging : '',
              ].join(' ');
              return (
                <div
                  key={d.id}
                  data-testid="phase-card"
                  data-card-id={d.id}
                  data-name={d.name}
                  className={cls}
                  title={`${d.name || t(locale, 'unnamed')} · ${t(locale, 'weeksUnit', { n: d.weeks })}${d.id === endId ? ` · ${t(locale, 'endPhaseTag')}` : ''}`}
                  style={{
                    left: p.x, top: p.y, width: CARD_W, height: CARD_H,
                    transform: drag ? `translate(${snapTo(drag.dx)}px, ${snapTo(drag.dy)}px)` : undefined,
                  }}
                  onPointerDown={onCardPointerDown(d.id)}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={onCardPointerUp}
                  onClick={(e) => { e.stopPropagation(); onCardClick(d.id)(); }}
                >
                  <span className={styles.nodeName}>{d.name || t(locale, 'unnamed')}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* detail panel: the clicked node is the DOWNSTREAM side of any new edge */}
        {selected && (
          <div className={styles.panel} data-testid="phase-panel">
            <button type="button" className={styles.panelClose} aria-label={t(locale, 'closeEdit')}
              onClick={() => { setSelectedId(null); setOtherId(null); }}>✕</button>

            <label className={styles.panelLabel}>{t(locale, 'phaseNameLabel')}
              <input
                className={chrome.textInput}
                value={selected.name}
                placeholder={t(locale, 'phaseNamePlaceholder')}
                aria-label={t(locale, 'phaseNameLabel')}
                onChange={(e) => patch(selected.id, { name: e.target.value })}
              />
            </label>

            <label className={styles.panelLabel}>{t(locale, 'forecastWeeks')}
              <input
                className={chrome.numInput}
                type="number"
                min={0.5}
                step={0.5}
                value={selected.weeks}
                aria-label={t(locale, 'forecastWeeks')}
                onChange={(e) => patch(selected.id, { weeks: Math.max(0.5, parseFloat(e.target.value) || 0.5) })}
              />
            </label>

            {templateFields && (
              <>
                <label className={styles.panelLabel}>{t(locale, 'leadRoleLabel')}
                  <select
                    className={chrome.selectInput}
                    value={selected.leadRole ?? ''}
                    aria-label={t(locale, 'leadRoleLabel')}
                    onChange={(e) => patch(selected.id, { leadRole: e.target.value || null })}
                  >
                    <option value="">—</option>
                    {(leadRoles ?? []).map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </label>
                {/* rich markdown, keyed by node so switching selection reloads content */}
                <div className={styles.panelLabel}>{t(locale, 'descriptionLabel')}
                  <MarkdownNoteEditor key={`d${selected.id}`} name="description" ariaLabel={t(locale, 'descriptionLabel')}
                    initialMarkdown={selected.description ?? ''}
                    onChange={(md) => patch(selected.id, { description: md || null })} />
                </div>
                <div className={styles.panelLabel}>{t(locale, 'googleFocusLabel')}
                  <MarkdownNoteEditor key={`g${selected.id}`} name="googleFocus" ariaLabel={t(locale, 'googleFocusLabel')}
                    initialMarkdown={selected.googleFocus ?? ''}
                    onChange={(md) => patch(selected.id, { googleFocus: md || null })} />
                </div>
              </>
            )}

            <div className={styles.panelSection}>
              <span className={styles.panelHead}>{t(locale, 'after')}</span>
              {selected.dependsOn.length === 0 && <span className={styles.panelMuted}>{t(locale, 'startingPhase')}</span>}
              {selected.dependsOn.map((up) => (
                <span key={up} className={styles.depChip}>
                  {byId.get(up)?.name ?? '?'}
                  <button type="button" className={styles.chipRemove}
                    aria-label={t(locale, 'disconnectName', { name: byId.get(up)?.name ?? '' })}
                    onClick={() => disconnect(selected.id, up)}>✕</button>
                </span>
              ))}
            </div>

            {/* downstream mirror of After: what this node enables, disconnectable */}
            {draft.some((d) => d.dependsOn.includes(selected.id)) && (
              <div className={styles.panelSection}>
                <span className={styles.panelHead}>{t(locale, 'enables')}</span>
                {draft.filter((d) => d.dependsOn.includes(selected.id)).map((down) => (
                  <span key={down.id} className={styles.depChip}>
                    {down.name || t(locale, 'unnamed')}
                    <button type="button" className={styles.chipRemove}
                      aria-label={t(locale, 'disconnectName', { name: down.name })}
                      onClick={() => disconnect(down.id, selected.id)}>✕</button>
                  </span>
                ))}
              </div>
            )}

            {/* connect works BOTH ways: the second click picks the other node, then
                choose whether this one comes after it (downstream) or before it
                (upstream) — a new phase slots in ahead of existing work either way */}
            <div className={styles.panelSection}>
              <span className={styles.panelHead}>{t(locale, 'connectLabel')}</span>
              {otherId == null ? (
                <span className={styles.panelMuted}>{t(locale, 'connectHint')}</span>
              ) : (
                <>
                  <button
                    type="button"
                    data-testid="connect-after"
                    className={chrome.primaryBtn}
                    disabled={selected.dependsOn.includes(otherId)}
                    onClick={() => connect(selected.id, otherId)}
                  >
                    {t(locale, 'connectAfterBtn', { a: selected.name || t(locale, 'unnamed'), b: byId.get(otherId)?.name || t(locale, 'unnamed') })}
                  </button>
                  <button
                    type="button"
                    data-testid="connect-before"
                    className={chrome.primaryBtn}
                    disabled={byId.get(otherId)?.dependsOn.includes(selected.id) ?? true}
                    onClick={() => connect(otherId, selected.id)}
                  >
                    {t(locale, 'connectBeforeBtn', { a: selected.name || t(locale, 'unnamed'), b: byId.get(otherId)?.name || t(locale, 'unnamed') })}
                  </button>
                </>
              )}
            </div>

            <button type="button" className={chrome.dangerBtn} onClick={() => removePhase(selected.id)}>
              {t(locale, 'removePhase')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
