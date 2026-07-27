'use client';

import React, { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import PhaseTable, { PhaseTableRow } from './PhaseTable';
import PhaseInvolvementEditor, {
  INVOLVEMENT_KINDS, type InvolvementKind, type InvolvementLink,
} from './PhaseInvolvementEditor';
import { validateTemplateDag } from '../lib/templateDag';
import { deriveEndPhase } from '../lib/programDag';
import { computeDagLayout } from '../lib/dagLayout';
import { phaseHash, parsePhaseHash } from '../lib/phase';
import { subscribeLocationChange } from '../lib/locationHash';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import chrome from './TemplateEditor.module.css';
import styles from './ProgramPhaseEditor.module.css';

// THE phase editor — one surface for building template phase layouts and for changing
// a live program's phases. Since #crw.1 it owns EVERY field of a phase a human
// changes: structure, name, forecast, Goal & DoD, and who is involved. That
// single-owner rule is the point. Involvement used to live only in the program page's
// About pane and nothing edited both, so "change this phase" meant first knowing which
// of two surfaces held the field you wanted.
//
// Small name-only nodes on a snap grid, flowing TOP → BOTTOM by dependency depth, with
// drawn edges. General DAGs are first-class: any node may have many concurrent
// upstreams (fan-in) and many downstreams (fan-out); the ONLY structural constraints
// are acyclic + a single final node, and they're enforced live (banner + disabled
// Save) and again server-side on save.
// Interactions:
//   · click a node → detail panel (rename, WEEKS, disconnect, remove; programs add
//     Goal & DoD and involvement; templates add lead role / description / Google focus)
//   · rewire by drag/drop (drop a node onto its new upstream; the ghost snaps to the
//     grid), or click a second node and CONNECT in EITHER direction — "X after Y"
//     (X depends on Y) or "X before Y" (Y depends on X) — so a new phase can be
//     wired in upstream of existing work just as easily as downstream
//
// The open panel IS a URL (`#phase-:id`, lib/phase) — the same rule the program page's
// popover follows. Arriving with the fragment opens that phase's panel, so an Edit
// affordance on a phase can land on the phase, not merely on the editor.

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

/**
 * Who is involved in each phase, for the editors that have real phases to involve
 * anyone in. Deliberately NOT part of `initial`: involvement is written straight
 * through its own server actions (the rows already exist), while `initial` is the
 * draft the Save button commits. Folding it in would make every add re-sync the draft
 * and close the panel the user is working in.
 */
export interface PhaseInvolvement {
  projectId: number;
  /** phase id → its current links, keyed the same way the control is */
  byPhase: Map<number, Record<InvolvementKind, InvolvementLink[]>>;
  /** the picker's canonical option set, per kind */
  options: Record<InvolvementKind, { id: number; name: string }[]>;
}

interface PhaseDagEditorProps {
  initial: DagEditorNode[];
  onSave: (draft: DagEditorNode[]) => Promise<{ error?: string }>;
  templateFields?: boolean; // show leadRole/description/googleFocus in the panel
  descriptionField?: boolean; // show ONLY the Goal & DoD markdown (program editors)
  involvement?: PhaseInvolvement; // partners + people (program editors)
  leadRoles?: string[];
  defaultWeeks?: number;
}

const GRID = 24;
// Node + gap sizes are grid multiples (row step = 4×GRID, column step = 7×GRID), so
// the resting layout and the drag ghost snap to the same lattice.
const CARD_W = GRID * 6, CARD_H = GRID * 1.5, GAP_X = GRID, GAP_Y = GRID * 2.5, PAD = GRID;
const snapTo = (v: number) => Math.round(v / GRID) * GRID;

// The open panel IS a URL. replaceState, never push: the panel is a mode of this page,
// and a trail of entries would make Back mean "close the thing I already closed". A
// node that has never been saved has no id to name, so it writes nothing.
const writeHash = (id: number | null) => {
  const current = window.location.hash;
  if (id == null || id < 0) {
    if (parsePhaseHash(current) == null) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }
  const want = `#${phaseHash(id)}`;
  if (current !== want) window.history.replaceState(null, '', want);
};

export default function PhaseDagEditor({ initial, onSave, templateFields, descriptionField, involvement, leadRoles, defaultWeeks = 4 }: PhaseDagEditorProps) {
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

  // Opening a phase's panel: the selection, the cleared CONNECT candidate and the
  // fragment move together, because they are one act. Every USER-driven selection goes
  // through here; bare `setSelectedId` survives in exactly two places where the URL is
  // already right — opening FROM the hash, and the post-save re-sync (a render-phase
  // reset, where a history write would be a side effect in render; the effect below
  // re-opens the phase from the fragment on the next pass).
  const openPanel = (id: number | null) => { setSelectedId(id); setOtherId(null); writeHash(id); };

  // Arriving at /programs/:id/phases#phase-:phaseId opens that phase's panel, so an
  // Edit affordance on a phase lands on the phase. The already-open guard makes the
  // re-runs (one per draft edit) no-ops, and keeps a re-render from yanking a panel
  // someone is working in. Next <Link> navigates via pushState, which does not fire
  // `hashchange` (#40) — subscribe to both.
  useEffect(() => {
    const openFromHash = () => {
      const id = parsePhaseHash(window.location.hash);
      if (id == null || id === selectedId || !draft.some((d) => d.id === id)) return;
      setSelectedId(id);
      setOtherId(null);
    };
    openFromHash();
    return subscribeLocationChange(openFromHash);
  }, [draft, selectedId]);

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
    openPanel(id);
  };
  const removePhase = (id: number) => {
    const p = byId.get(id);
    if (p && p.id > 0 && (p.progress ?? 0) > 0 && !confirm(t(locale, 'removePhaseHistoryConfirm', { name: p.name }))) return;
    setDraft((ds) => ds.filter((d) => d.id !== id).map((d) => ({ ...d, dependsOn: d.dependsOn.filter((x) => x !== id) })));
    openPanel(null);
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
    // elementsFromPoint + skip-self: belt to the CSS pointer-events:none braces —
    // the dragged ghost sits under the cursor and must never be its own drop target.
    const targetId = document
      .elementsFromPoint(e.clientX, e.clientY)
      .map((n) => n.closest('[data-card-id]'))
      .map((n) => (n ? parseInt(n.getAttribute('data-card-id')!, 10) : NaN))
      .find((id) => !isNaN(id) && id !== s.id);
    if (targetId !== undefined) connect(s.id, targetId); // dragged node comes AFTER the drop target
  };
  const onCardClick = (id: number) => () => {
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (selectedId == null || selectedId === id) {
      openPanel(id);
    } else {
      setOtherId((u) => (u === id ? null : id)); // second click arms CONNECT
    }
  };

  const save = () =>
    startSaving(async () => {
      const result = await onSave(draft);
      if (result.error) setServerError(result.error);
    });

  // Edges: tube-map grammar (the same 90°-jogs-no-beziers rule as PhaseTrack and
  // PhaseGraph). Each edge gets its OWN port on the upstream card's bottom edge and
  // the downstream card's top edge — ports sorted by the far endpoint's x so edges
  // never cross — then routes vertical → mid-gap horizontal → vertical. Shared
  // center points were the old branch/rejoin surprise: fan-outs peeled from one
  // point and fan-ins fused into a single pinched arrow above the card.
  const edges = (() => {
    const pairs = draft.flatMap((d) =>
      d.dependsOn.filter((up) => layout.pos.has(up)).map((up) => ({ up, down: d.id })),
    );
    const ports = new Map<string, number>();
    const spreadAt = (id: number, list: { up: number; down: number }[], isOut: boolean) => {
      list.sort((e1, e2) => layout.pos.get(isOut ? e1.down : e1.up)!.x - layout.pos.get(isOut ? e2.down : e2.up)!.x);
      const n = list.length;
      const spread = Math.min(34, n > 1 ? (CARD_W - 28) / (n - 1) : 0);
      list.forEach((e, i) =>
        ports.set(`${e.up}-${e.down}-${isOut ? 'o' : 'i'}`, layout.pos.get(id)!.x + CARD_W / 2 + (i - (n - 1) / 2) * spread),
      );
    };
    const byUp = new Map<number, { up: number; down: number }[]>();
    const byDown = new Map<number, { up: number; down: number }[]>();
    pairs.forEach((e) => {
      byUp.set(e.up, [...(byUp.get(e.up) ?? []), e]);
      byDown.set(e.down, [...(byDown.get(e.down) ?? []), e]);
    });
    byUp.forEach((list, id) => spreadAt(id, list, true));
    byDown.forEach((list, id) => spreadAt(id, list, false));

    return pairs.map(({ up, down }) => {
      const y1 = layout.pos.get(up)!.y + CARD_H, y2 = layout.pos.get(down)!.y;
      const x1 = ports.get(`${up}-${down}-o`)!, x2 = ports.get(`${up}-${down}-i`)!;
      let d: string;
      if (Math.abs(x1 - x2) < 1) {
        d = `M ${x1} ${y1} L ${x2} ${y2}`;
      } else {
        const mid = (y1 + y2) / 2, dir = x2 > x1 ? 1 : -1;
        const r = Math.max(2, Math.min(8, Math.abs(x2 - x1) / 2, (y2 - y1) / 2 - 2));
        d = [
          `M ${x1} ${y1}`,
          `L ${x1} ${mid - r}`,
          `Q ${x1} ${mid} ${x1 + dir * r} ${mid}`,
          `L ${x2 - dir * r} ${mid}`,
          `Q ${x2} ${mid} ${x2} ${mid + r}`,
          `L ${x2} ${y2}`,
        ].join(' ');
      }
      return { key: `${up}-${down}`, d };
    });
  })();

  // Rows for the live datatable below the canvas, ordered by the diagram's top→bottom
  // flow (layout y, then x) so the list reads in the same order as the drawing. What
  // the table IS — a live mirror of the draft, two views of one thing — is on PhaseTable.
  const tableRows: PhaseTableRow[] = [...draft]
    .sort((a, b) => {
      const pa = layout.pos.get(a.id), pb = layout.pos.get(b.id);
      if (!pa || !pb) return 0;
      return pa.y - pb.y || pa.x - pb.x;
    })
    .map((d) => ({
      id: d.id,
      name: d.name,
      isEndPhase: d.id === endId,
      weeks: d.weeks,
      dependsOnNames: d.dependsOn.map((up) => byId.get(up)?.name ?? ''),
      leadRole: d.leadRole,
    }));

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
            onClick={() => openPanel(null)}>
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
              onClick={() => openPanel(null)}>✕</button>

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

            {(templateFields || descriptionField) && (
              /* rich markdown, keyed by node so switching selection reloads content */
              <div className={styles.panelLabel}>{t(locale, 'descriptionLabel')}
                <MarkdownNoteEditor key={`d${selected.id}`} name="description" ariaLabel={t(locale, 'descriptionLabel')}
                  placeholder={t(locale, 'goalDodPlaceholder')}
                  initialMarkdown={selected.description ?? ''}
                  onChange={(md) => patch(selected.id, { description: md || null })} />
              </div>
            )}
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
                <div className={styles.panelLabel}>{t(locale, 'googleFocusLabel')}
                  <MarkdownNoteEditor key={`g${selected.id}`} name="googleFocus" ariaLabel={t(locale, 'googleFocusLabel')}
                    initialMarkdown={selected.googleFocus ?? ''}
                    onChange={(md) => patch(selected.id, { googleFocus: md || null })} />
                </div>
              </>
            )}

            {/* WHO — the other half of "change this phase", and until #crw.1 the half
                this surface could not touch. A phase that has never been saved has no
                row to hang involvement off, so it says so rather than offering a
                picker whose submit could only fail. */}
            {involvement && (
              selected.id > 0 ? (
                (Object.keys(INVOLVEMENT_KINDS) as InvolvementKind[]).map((kind) => (
                  <div key={kind} className={styles.panelSection} data-testid={`panel-${kind}s`}>
                    <span className={styles.panelHead}>
                      {t(locale, INVOLVEMENT_KINDS[kind].sectionLabel)}
                    </span>
                    <PhaseInvolvementEditor kind={kind} phaseId={selected.id}
                      projectId={involvement.projectId}
                      involved={involvement.byPhase.get(selected.id)?.[kind] ?? []}
                      options={involvement.options[kind]} />
                  </div>
                ))
              ) : (
                <div className={styles.panelSection}>
                  <span className={styles.panelHead}>{t(locale, 'involvementLabel')}</span>
                  <span className={styles.panelMuted}>{t(locale, 'involvementAfterSave')}</span>
                </div>
              )
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

      <PhaseTable rows={tableRows} showLead={!!templateFields} selectedId={selectedId} onSelect={openPanel} />
    </div>
  );
}
