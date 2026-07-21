'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import PhaseHillGauge from './PhaseHillGauge';
import ConstraintRing from './ConstraintRing';
import Markdown from './Markdown';
import { hillStatus, hillStatusColor, phaseColor } from '../lib/phase';
import { computeCriticalChain } from '../lib/criticalChain';
import { addPhase, deletePhase } from '../app/programs/[id]/actions';
import { addPhasePartner, removePhasePartner } from '../app/actions/phasePartners';
import { addPhaseDependency, removePhaseDependency } from '../app/actions/dependencies';
import styles from './PhaseGraph.module.css';
import { localDate } from '../lib/dates';
import { useLocale } from './LocaleProvider';

// The program's phase surface (spec §2.13): a vertical tube-map of the phase DAG.
// Rectilinear edges (90° jogs, small corner radii — never curves), one node per phase in
// the phase's own color, and the CRITICAL CHAIN — the longest remaining-duration path —
// as the visual spine: heavier edges, ringed nodes, an amber Constraint tag, and a
// summary line above the rail. Rows have three appearances (collapsed / minimal /
// expanded) cycled by tapping the header; Done phases start collapsed. Dependencies are
// visible on the rail and editable in the expanded row (server rejects cycles).

export interface PhaseGraphPartner {
  linkId: number; // PhasePartner row id
  partnerId: number;
  name: string;
  role: string | null;
  type?: string | null; // PartnerType name (OEM / Supplier / …) — drives the involvement pill
  otherActive?: number; // active phases in OTHER programs involving this partner (resource contention)
}

export interface PhaseGraphParent {
  linkId: number; // PhaseDependency row id
  id: number; // the upstream phase id
}

export interface PhaseGraphRow {
  id: number;
  name: string;
  progress: number; // 0..100, latest
  previousProgress: number | null;
  updatedAt: string | null;
  updatedBy: string | null;
  note: string | null;
  forecastedDuration: number; // days
  parents: PhaseGraphParent[];
  partners: PhaseGraphPartner[];
}

interface PhaseGraphProps {
  projectId: number;
  phases: PhaseGraphRow[];
  allPartners: { id: number; name: string }[];
}

type RowState = 'collapsed' | 'minimal' | 'expanded';
const NEXT_STATE: Record<RowState, RowState> = { collapsed: 'minimal', minimal: 'expanded', expanded: 'collapsed' };

// Topological order + lane (longest-path depth) for the tube-map layout.
function layout(rows: PhaseGraphRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lane = new Map<number, number>();
  const depth = (id: number, seen: Set<number>): number => {
    if (lane.has(id)) return lane.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parents = (byId.get(id)?.parents ?? []).filter((p) => byId.has(p.id));
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => depth(p.id, seen))) + 1;
    lane.set(id, d);
    return d;
  };
  rows.forEach((r) => depth(r.id, new Set()));
  const ordered = [...rows].sort((a, b) => (lane.get(a.id)! - lane.get(b.id)!) || a.id - b.id);
  const maxLane = Math.max(0, ...rows.map((r) => lane.get(r.id)!));
  return { ordered, lane, maxLane };
}

// Rectilinear edge: down the parent's lane, one 90° jog with rounded corners just above
// the child's node, then down into it. Tube-map grammar — no beziers.
function railEdge(x1: number, y1: number, x2: number, y2: number): string {
  if (x1 === x2) return `M ${x1} ${y1} L ${x2} ${y2}`;
  const JOG = 16; // how far above the child node the horizontal run sits
  const dir = x2 > x1 ? 1 : -1;
  const r = Math.min(6, Math.abs(x2 - x1) / 2, Math.max(1, (y2 - y1) / 2 - 2));
  const jogY = Math.max(y1 + r, y2 - JOG);
  return [
    `M ${x1} ${y1}`,
    `L ${x1} ${jogY - r}`,
    `Q ${x1} ${jogY} ${x1 + dir * r} ${jogY}`,
    `L ${x2 - dir * r} ${jogY}`,
    `Q ${x2} ${jogY} ${x2} ${jogY + r}`,
    `L ${x2} ${y2}`,
  ].join(' ');
}

// Everything reachable downstream of `id` (descendants) — used to filter the "After"
// select so the client never even offers a cycle (the server still rejects).
function descendantsOf(id: number, rows: PhaseGraphRow[]): Set<number> {
  const children = new Map<number, number[]>();
  rows.forEach((r) => r.parents.forEach((p) => children.set(p.id, [...(children.get(p.id) ?? []), r.id])));
  const seen = new Set<number>();
  const stack = [id];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!seen.has(child)) {
        seen.add(child);
        stack.push(child);
      }
    }
  }
  return seen;
}

const LANE_W = 16, RAIL_PAD = 14, NODE_R = 5.5;

export default function PhaseGraph({ projectId, phases, allPartners }: PhaseGraphProps) {
  const locale = useLocale();
  const { ordered, lane, maxLane } = layout(phases);
  const gutterW = RAIL_PAD * 2 + maxLane * LANE_W;
  const byId = new Map(phases.map((p) => [p.id, p]));

  const chain = computeCriticalChain(
    phases.map((p) => ({
      id: p.id,
      name: p.name,
      forecastedDuration: p.forecastedDuration,
      progress: p.progress,
      parentIds: p.parents.map((x) => x.id),
    })),
  );
  const onChain = new Set(chain.path);

  // Downstream ("Enables") per phase, with the edge's linkId so it can be removed here.
  const enables = new Map<number, { linkId: number; id: number }[]>();
  phases.forEach((r) =>
    r.parents.forEach((p) => enables.set(p.id, [...(enables.get(p.id) ?? []), { linkId: p.linkId, id: r.id }])),
  );

  // Row appearance: Done phases start collapsed, everything else minimal. User taps win.
  const [rowState, setRowState] = useState<Record<number, RowState>>({});
  const stateOf = (p: PhaseGraphRow): RowState => rowState[p.id] ?? (p.progress >= 100 ? 'collapsed' : 'minimal');
  const cycle = (p: PhaseGraphRow) => setRowState((s) => ({ ...s, [p.id]: NEXT_STATE[stateOf(p)] }));

  // Dependency-action errors (cycle rejections) shown inline per row.
  const [depError, setDepError] = useState<Record<number, string>>({});
  const [, startTransition] = useTransition();
  const runDep = (rowId: number, action: (fd: FormData) => Promise<{ error?: string }>, fd: FormData) =>
    startTransition(async () => {
      const result = await action(fd);
      setDepError((e) => ({ ...e, [rowId]: result.error ?? '' }));
    });

  // Jump-and-flash for dependency chips.
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpTo = (id: number) => {
    const target = byId.get(id);
    if (target && stateOf(target) === 'collapsed') setRowState((s) => ({ ...s, [id]: 'minimal' }));
    headRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1400);
  };
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Node y-centers are measured from the DOM so edges follow real row heights.
  const containerRef = useRef<HTMLDivElement>(null);
  const headRefs = useRef(new Map<number, HTMLDivElement>());
  const [geom, setGeom] = useState<{ ys: Record<number, number>; h: number }>({ ys: {}, h: 0 });

  const measure = () => {
    const c = containerRef.current;
    if (!c) return;
    const cTop = c.getBoundingClientRect().top;
    const ys: Record<number, number> = {};
    headRefs.current.forEach((el, id) => {
      const r = el.getBoundingClientRect();
      ys[id] = r.top - cTop + r.height / 2;
    });
    setGeom({ ys, h: c.scrollHeight });
  };

  useLayoutEffect(measure, [phases, rowState]);
  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const laneX = (id: number) => RAIL_PAD + (lane.get(id) ?? 0) * LANE_W;

  // Header taps cycle the row — unless the tap landed on a link, button, or form control.
  const onHeaderClick = (p: PhaseGraphRow) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea, form')) return;
    cycle(p);
  };

  return (
    <div className={styles.wrapper}>
      {chain.path.length > 1 && (
        <p className={styles.chainSummary}>
          <span className={styles.chainLabel}>Critical chain</span>
          {chain.path.map((id, i) => (
            <span key={id}>
              {i > 0 && <span className={styles.chainArrow}> → </span>}
              <button type="button" className={styles.chainLink} onClick={() => jumpTo(id)}>
                {byId.get(id)?.name}
              </button>
            </span>
          ))}
          <span className={styles.chainDays}> · ≈{chain.remainingDays} days remaining</span>
        </p>
      )}

      <div ref={containerRef} className={styles.graph} style={{ paddingLeft: gutterW }}>
        {/* rail overlay: rectilinear edges + nodes, positioned by measured row centers */}
        <svg className={styles.rail} width={gutterW} height={Math.max(geom.h, 1)} aria-hidden>
          {ordered.map((p) =>
            p.parents
              .filter((par) => geom.ys[par.id] != null && geom.ys[p.id] != null)
              .map((par) => {
                const heavy = chain.edgeKeys.has(`${par.id}-${p.id}`);
                return (
                  <path
                    key={`${par.id}-${p.id}`}
                    d={railEdge(laneX(par.id), geom.ys[par.id], laneX(p.id), geom.ys[p.id])}
                    fill="none"
                    stroke={heavy ? 'var(--muted)' : 'var(--border)'}
                    strokeWidth={heavy ? 3 : 1.6}
                  />
                );
              }),
          )}
          {ordered.map((p) => {
            if (geom.ys[p.id] == null) return null;
            const isConstraint = chain.constraintId === p.id;
            return (
              <g key={p.id}>
                {/* On-chain members get a quiet ring; the CONSTRAINT gets the one
                    shared marker, identical to the rail's and the schedule's. */}
                {isConstraint ? (
                  <ConstraintRing cx={laneX(p.id)} cy={geom.ys[p.id]} r={NODE_R} />
                ) : onChain.has(p.id) && (
                  <circle
                    cx={laneX(p.id)}
                    cy={geom.ys[p.id]}
                    r={NODE_R + 3.5}
                    fill="none"
                    stroke="var(--muted)"
                    strokeWidth={1.25}
                  />
                )}
                <circle cx={laneX(p.id)} cy={geom.ys[p.id]} r={NODE_R} fill={phaseColor(p.id)} stroke="var(--paper)" strokeWidth={1.6}>
                  <title>{`${p.name} — ${hillStatus(p.progress)}${isConstraint ? ' · constraint' : ''}`}</title>
                </circle>
              </g>
            );
          })}
        </svg>

        {ordered.map((p) => {
          const status = hillStatus(p.progress);
          const state = stateOf(p);
          const isConstraint = chain.constraintId === p.id;
          const upstream = p.parents.filter((par) => byId.has(par.id));
          const downstream = enables.get(p.id) ?? [];
          const descendants = descendantsOf(p.id, phases);
          const addableParents = phases.filter(
            (c) => c.id !== p.id && !descendants.has(c.id) && !upstream.some((u) => u.id === c.id),
          );
          const glyph = state === 'collapsed' ? '+' : state === 'minimal' ? '=' : '−';

          return (
            <div key={p.id} className={`${styles.row} ${flashId === p.id ? styles.flash : ''}`} data-testid="phase-row">
              <div
                ref={(el) => { if (el) headRefs.current.set(p.id, el); else headRefs.current.delete(p.id); }}
                className={styles.head}
                onClick={onHeaderClick(p)}
              >
                <Link href={`/history/phase/${p.id}`} className={styles.name} style={state === 'collapsed' && p.progress >= 100 ? { color: 'var(--muted)' } : undefined}>
                  {p.name}
                </Link>
                <span className={styles.status} style={{ color: hillStatusColor(p.progress) }}>{status}</span>
                {isConstraint && <span className={styles.constraintTag}>Constraint</span>}
                {p.updatedAt && (
                  <span className={styles.when}>
                    {localDate(p.updatedAt, locale, { month: 'short', day: 'numeric' })}
                    {p.updatedBy ? ` · ${p.updatedBy}` : ''}
                  </span>
                )}
                <button type="button" className={styles.chevron} onClick={() => cycle(p)} aria-label={`Row detail: ${state}`}>
                  {glyph}
                </button>
              </div>

              {state !== 'collapsed' && (
                <div className={styles.body}>
                  <div className={styles.hillCol}>
                    <PhaseHillGauge
                      phaseId={p.id}
                      projectId={projectId}
                      phaseName={p.name}
                      progress={p.progress}
                      previousProgress={p.previousProgress}
                      updatedAt={null}
                      showStatus={false}
                    />
                  </div>

                  <div className={styles.detailCol}>
                    {p.note ? (
                      state === 'expanded' ? (
                        <div className={styles.note}><Markdown>{p.note}</Markdown></div>
                      ) : (
                        <div className={`${styles.note} ${styles.noteClamp}`}>{p.note}</div>
                      )
                    ) : (
                      <div className={styles.noteEmpty}>No update note yet.</div>
                    )}

                    {state === 'minimal' && p.partners.length > 0 && (
                      <div className={styles.partnersInline}>
                        {p.partners.map((pp, i) => (
                          <span key={pp.linkId}>
                            {i > 0 && ', '}
                            <Link href={`/partners/${pp.partnerId}`} className={styles.partnerLink}>{pp.name}</Link>
                          </span>
                        ))}
                      </div>
                    )}

                    {state === 'expanded' && (
                      <>
                        <div className={styles.partners}>
                          {p.partners.map((pp) => (
                            <span key={pp.linkId} className={styles.partnerChip}>
                              <Link href={`/partners/${pp.partnerId}`} className={styles.partnerLink}>{pp.name}</Link>
                              {pp.role && <span className={styles.partnerRole}>{pp.role}</span>}
                              <form action={removePhasePartner} className={styles.inlineForm}>
                                <input type="hidden" name="id" value={pp.linkId} />
                                <input type="hidden" name="projectId" value={projectId} />
                                <button type="submit" className={styles.chipRemove} title={`Remove ${pp.name} from this phase`} aria-label={`Remove ${pp.name}`}>✕</button>
                              </form>
                            </span>
                          ))}
                          {(() => {
                            const available = allPartners.filter((a) => !p.partners.some((pp) => pp.partnerId === a.id));
                            if (available.length === 0) return null;
                            return (
                              <form action={addPhasePartner} className={styles.addInlineForm}>
                                <input type="hidden" name="phaseId" value={p.id} />
                                <input type="hidden" name="projectId" value={projectId} />
                                <select name="partnerId" className={styles.quietSelect} defaultValue="" required aria-label="Partner to involve">
                                  <option value="" disabled>+ partner…</option>
                                  {available.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                                </select>
                                <input name="role" className={styles.roleInput} placeholder="role" aria-label="Role (optional)" />
                                <button type="submit" className={styles.miniBtn}>Add</button>
                              </form>
                            );
                          })()}
                        </div>

                        {/* dependencies: upstream editable, downstream removable, chips jump */}
                        <div className={styles.depsRow}>
                          <span className={styles.depsLabel}>After</span>
                          {upstream.map((par) => (
                            <span key={par.linkId} className={styles.depChip}>
                              <button type="button" className={styles.depJump} onClick={() => jumpTo(par.id)}>
                                <span className={styles.depDot} style={{ background: phaseColor(par.id) }} />
                                {byId.get(par.id)?.name}
                              </button>
                              <button
                                type="button"
                                className={styles.chipRemove}
                                title="Remove dependency"
                                aria-label={`No longer after ${byId.get(par.id)?.name}`}
                                onClick={() => {
                                  const fd = new FormData();
                                  fd.set('id', String(par.linkId));
                                  fd.set('projectId', String(projectId));
                                  runDep(p.id, removePhaseDependency, fd);
                                }}
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                          {upstream.length === 0 && <span className={styles.depNone}>nothing — a starting phase</span>}
                          {addableParents.length > 0 && (
                            <select
                              className={styles.quietSelect}
                              value=""
                              aria-label="Add a dependency"
                              onChange={(e) => {
                                const fd = new FormData();
                                fd.set('phaseId', String(p.id));
                                fd.set('dependsOnPhaseId', e.target.value);
                                fd.set('projectId', String(projectId));
                                runDep(p.id, addPhaseDependency, fd);
                              }}
                            >
                              <option value="" disabled>+ after…</option>
                              {addableParents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                        </div>
                        {downstream.length > 0 && (
                          <div className={styles.depsRow}>
                            <span className={styles.depsLabel}>Enables</span>
                            {downstream.map((d) => (
                              <span key={d.linkId} className={styles.depChip}>
                                <button type="button" className={styles.depJump} onClick={() => jumpTo(d.id)}>
                                  <span className={styles.depDot} style={{ background: phaseColor(d.id) }} />
                                  {byId.get(d.id)?.name}
                                </button>
                                <button
                                  type="button"
                                  className={styles.chipRemove}
                                  title="Remove dependency"
                                  aria-label={`No longer enables ${byId.get(d.id)?.name}`}
                                  onClick={() => {
                                    const fd = new FormData();
                                    fd.set('id', String(d.linkId));
                                    fd.set('projectId', String(projectId));
                                    runDep(p.id, removePhaseDependency, fd);
                                  }}
                                >
                                  ✕
                                </button>
                              </span>
                            ))}
                          </div>
                        )}
                        {depError[p.id] && <div className={styles.depError}>{depError[p.id]}</div>}

                        <form
                          action={deletePhase}
                          className={styles.removePhase}
                          onSubmit={(e) => { if (!confirm(`Remove the "${p.name}" phase and its entire history?`)) e.preventDefault(); }}
                        >
                          <input type="hidden" name="projectId" value={projectId} />
                          <input type="hidden" name="phaseId" value={p.id} />
                          <button type="submit" className={styles.removeBtn}>Remove phase</button>
                        </form>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* inline add-phase at the rail's end, with an optional "after X" dependency */}
        <form action={addPhase} className={styles.addRow}>
          <input type="hidden" name="projectId" value={projectId} />
          <input name="name" className={styles.addInput} placeholder="New phase name…" required aria-label="New phase name" />
          {phases.length > 0 && (
            <select name="dependsOn" className={styles.quietSelect} defaultValue="" aria-label="After phase (optional)">
              <option value="">after… (optional)</option>
              {ordered.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button type="submit" className={styles.miniBtn}>Add phase</button>
        </form>
      </div>
    </div>
  );
}
