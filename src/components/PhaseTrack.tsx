'use client';

import React, { useEffect, useLayoutEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import Markdown from './Markdown';
import { computeCriticalChain } from '../lib/criticalChain';
import { HILL_PATH, hillCoordinates } from '../lib/geometry';
import { t, statusKey, Locale, LOCALES } from '../lib/i18n';
import { addPhase, deletePhase } from '../app/projects/[id]/actions';
import { updatePhaseHill } from '../app/actions/hill';
import { addPhasePartner, removePhasePartner } from '../app/actions/phasePartners';
import { addPhasePerson, removePhasePerson } from '../app/actions/phasePeople';
import { addPhaseDependency, removePhaseDependency } from '../app/actions/dependencies';
import type { PhaseGraphRow } from './PhaseGraph';
import styles from './PhaseTrack.module.css';

// The phase surface as a single train line. The CRITICAL CHAIN is the main line —
// its stations come first, in chain order, so the chain renders as one contiguous
// solid track. Branch phases follow; their real dependencies arrive as express bypass
// loops in an outer lane. Where two adjacent stations share no dependency there is NO
// connector at all — a line would imply a relationship that doesn't exist. Each
// dependency segment fills monochrome (ink on gray) along its length as the ARRIVING
// phase progresses — the train's position between stations.
//
// Critical chain: the longest remaining-duration dependency path, unbuffered, PLUS the
// resource dimension — the same Googler driving active phases in other programs is
// surfaced as a RESOURCE line (CCPM's resource constraint, approximated: flagged, not
// yet leveled into the chain math).
//
// Standard cards are compact and read-only: name, status, planned-vs-actual weeks, the
// mini hill (small dots = every historical position, big dot = now), latest note,
// pending activities, Googler focus, and who's involved (partners + people, with
// roles). The ONLY affordances are the fold chevron and DETAILS, which swaps the whole
// surface for a focused single-phase experience: status update (drag + note), full
// history, partner/people involvement editing, dependencies, and phase removal.
// All strings via lib/i18n (en / de / ja / ko).

export interface PhaseActivity {
  id: number;
  description: string;
  nextStep: string; // "Undecided" | "Resolved" | "Partner" | "Googler"
  assignedTo: string | null;
  linkUrl: string | null;
}

export interface PhaseHistoryEntry {
  at: string;
  progress: number;
  note: string | null;
  by: string | null;
}

export interface PhasePersonLink {
  linkId: number;
  personId: number;
  name: string;
  role: string | null;
}

export interface PhaseTrackRow extends PhaseGraphRow {
  startedAt: string | null; // first state with progress > 0
  completedAt: string | null; // first state with progress >= 100
  activities: PhaseActivity[]; // pending action items
  history: PhaseHistoryEntry[]; // hill updates, newest first (latest == note above)
  people: PhasePersonLink[]; // involved individuals
}

export interface OtherActivePhase {
  projectId: number;
  projectName: string;
  phaseName: string;
}

interface PhaseTrackProps {
  projectId: number;
  phases: PhaseTrackRow[];
  allPartners: { id: number; name: string }[];
  allPeople: { id: number; name: string }[];
  locale: Locale;
  owner: string | null; // the program's Googler owner
  otherActive: OtherActivePhase[]; // the owner's active phases in OTHER programs
}

const RAIL_PAD = 10, LANE_W = 14, INK = 'hsl(0, 0%, 25%)';
const DAY_MS = 86_400_000;

// Station sequence: the critical chain first, in chain order — the main line stays
// one contiguous solid track. Remaining phases follow in topological order (longest-
// path depth, then id) and connect via bypass loops from their real parents.
function stationOrder(rows: PhaseTrackRow[], chainPath: number[]): PhaseTrackRow[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const chainSet = new Set(chainPath);
  const chainRows = chainPath.map((id) => byId.get(id)).filter((r): r is PhaseTrackRow => !!r);
  const rest = rows.filter((r) => !chainSet.has(r.id));
  const depthMemo = new Map<number, number>();
  const depth = (id: number, seen: Set<number>): number => {
    if (depthMemo.has(id)) return depthMemo.get(id)!;
    if (seen.has(id)) return 0; // cycle guard
    seen.add(id);
    const parents = (byId.get(id)?.parents ?? []).filter((p) => byId.has(p.id));
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => depth(p.id, seen))) + 1;
    depthMemo.set(id, d);
    return d;
  };
  rows.forEach((r) => depth(r.id, new Set()));
  const restSorted = [...rest].sort((a, b) => (depthMemo.get(a.id)! - depthMemo.get(b.id)!) || a.id - b.id);
  return [...chainRows, ...restSorted];
}

// Everything reachable downstream of `id` — filters the "After" select against cycles.
function descendantsOf(id: number, rows: PhaseTrackRow[]): Set<number> {
  const children = new Map<number, number[]>();
  rows.forEach((r) => r.parents.forEach((p) => children.set(p.id, [...(children.get(p.id) ?? []), r.id])));
  const seen = new Set<number>();
  const stack = [id];
  while (stack.length) {
    for (const child of children.get(stack.pop()!) ?? []) {
      if (!seen.has(child)) { seen.add(child); stack.push(child); }
    }
  }
  return seen;
}

interface Edge {
  from: number;
  to: number;
  fromIdx: number;
  toIdx: number;
  onChain: boolean;
  fill: number; // 0..100 — the arriving phase's progress
  lane: number; // 0 = mainline; bypasses get 1.. (outer lanes)
}

// Split dependency edges into mainline segments (adjacent stations) and bypass loops
// (skipping stations), assigning each bypass an outer lane greedily so overlapping
// loops never share one (interval coloring).
function classifyEdges(ordered: PhaseTrackRow[], chainKeys: Set<string>): { edges: Edge[]; laneCount: number } {
  const idx = new Map(ordered.map((r, i) => [r.id, i]));
  const raw: Omit<Edge, 'lane'>[] = [];
  for (const r of ordered) {
    for (const p of r.parents) {
      if (!idx.has(p.id)) continue;
      const fromIdx = idx.get(p.id)!, toIdx = idx.get(r.id)!;
      raw.push({
        from: p.id, to: r.id,
        fromIdx: Math.min(fromIdx, toIdx), toIdx: Math.max(fromIdx, toIdx),
        onChain: chainKeys.has(`${p.id}-${r.id}`),
        fill: Math.max(0, Math.min(100, r.progress)),
      });
    }
  }
  const mainline = raw.filter((e) => e.toIdx - e.fromIdx === 1).map((e) => ({ ...e, lane: 0 }));
  const bypasses = raw.filter((e) => e.toIdx - e.fromIdx > 1).sort((a, b) => a.fromIdx - b.fromIdx);
  const laneEnds: number[] = [];
  const placed = bypasses.map((e) => {
    let lane = laneEnds.findIndex((end) => end <= e.fromIdx);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.toIdx); } else { laneEnds[lane] = e.toIdx; }
    return { ...e, lane: lane + 1 };
  });
  return { edges: [...mainline, ...placed], laneCount: laneEnds.length };
}

// Monochrome station symbol: filled = done, right-half = in progress, open = not
// started. Heavier ink for critical-chain stations; a single amber ring marks the
// constraint. Hover for the name+status; click jumps to the row.
function Station({ x, y, progress, onChain, isConstraint, title, onClick }: {
  x: number; y: number; progress: number; onChain: boolean; isConstraint: boolean;
  title: string; onClick?: () => void;
}) {
  const r = onChain ? 6 : 5;
  const stroke = onChain ? INK : 'var(--muted)';
  return (
    <g onClick={onClick} className={styles.station}>
      {isConstraint && <circle cx={x} cy={y} r={r + 4} fill="none" stroke="#c98a1a" strokeWidth={2} />}
      <circle cx={x} cy={y} r={r} fill={progress >= 100 ? stroke : '#fff'} stroke={stroke} strokeWidth={onChain ? 2 : 1.5} />
      {progress > 0 && progress < 100 && (
        <path d={`M ${x} ${y - (r - 0.75)} A ${r - 0.75} ${r - 0.75} 0 0 1 ${x} ${y + (r - 0.75)} Z`} fill={stroke} stroke="none" />
      )}
      <title>{title}</title>
    </g>
  );
}

// Thumbnail hill for history entries: where the ball sat at that update.
function HistoryGlyph({ progress }: { progress: number }) {
  const c = hillCoordinates(progress);
  return (
    <svg viewBox="0 0 200 90" className={styles.historyGlyph} aria-hidden>
      <path d={HILL_PATH} fill="none" stroke="var(--border)" strokeWidth={7} strokeLinecap="round" />
      <circle cx={c.x} cy={c.y} r={13} fill="var(--muted)" />
    </svg>
  );
}

// Textless mini hill for standard cards: the trail of every historical position as
// small dots, the current position as the one big ball.
function MiniHill({ progress, pastPositions }: { progress: number; pastPositions: number[] }) {
  const c = hillCoordinates(progress);
  return (
    <svg viewBox="0 0 200 90" className={styles.miniHill} aria-hidden>
      <path d={HILL_PATH} fill="none" stroke="var(--border)" strokeWidth={3} strokeLinecap="round" />
      <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border)" strokeDasharray="3 3" />
      {pastPositions.map((p, i) => {
        const d = hillCoordinates(p);
        return <circle key={i} cx={d.x} cy={d.y} r={3.5} fill="var(--muted)" opacity={0.45} />;
      })}
      <circle cx={c.x} cy={c.y} r={7} fill="var(--muted)" stroke="#fff" strokeWidth={1.5} />
    </svg>
  );
}

export default function PhaseTrack({ projectId, phases, allPartners, allPeople, locale, owner, otherActive }: PhaseTrackProps) {
  const byId = new Map(phases.map((p) => [p.id, p]));

  const chain = computeCriticalChain(
    phases.map((p) => ({
      id: p.id, name: p.name, forecastedDuration: p.forecastedDuration,
      progress: p.progress, parentIds: p.parents.map((x) => x.id),
    })),
  );
  const onChainSet = new Set(chain.path);
  const ordered = stationOrder(phases, chain.path);
  const { edges, laneCount } = classifyEdges(ordered, chain.edgeKeys);
  const mainX = RAIL_PAD + laneCount * LANE_W + 6;
  const gutterW = mainX + 16;
  const laneX = (lane: number) => mainX - lane * LANE_W;

  const status = (p: number) => t(locale, statusKey(p));
  const skippedNames = (e: Edge) => ordered.slice(e.fromIdx + 1, e.toIdx).map((s) => s.name).join(', ');
  const edgeTitle = (e: Edge) =>
    `${byId.get(e.from)?.name} → ${byId.get(e.to)?.name}` +
    (e.lane > 0 ? ` · ${t(locale, 'skips', { names: skippedNames(e) })}` : '');

  // Anticipated (weeks) vs actual: planned from the forecast; elapsed from the first
  // started state (to now, or to the done state). "Now" is frozen per mount — week
  // granularity makes drift irrelevant, and render stays pure.
  const [now] = useState(() => Date.now());
  const fmtW = (days: number) => {
    const w = days / 7;
    const n = w < 1 ? '<1' : String(Math.round(w * 10) / 10).replace(/\.0$/, '');
    return t(locale, 'weeksUnit', { n });
  };
  const planWords = (p: PhaseTrackRow): string => {
    const planned = fmtW(p.forecastedDuration);
    if (p.progress >= 100 && p.startedAt && p.completedAt) {
      return t(locale, 'plannedTook', { p: planned, e: fmtW((+new Date(p.completedAt) - +new Date(p.startedAt)) / DAY_MS) });
    }
    if (p.progress > 0 && p.startedAt) {
      return t(locale, 'plannedElapsed', { p: planned, e: fmtW((now - +new Date(p.startedAt)) / DAY_MS) });
    }
    return t(locale, 'plannedOnly', { p: planned });
  };

  // Locale stickiness: the last-viewed language survives navigations that drop ?lang=.
  // Also expire the retired offline-worker cookie/caches from earlier sessions.
  useEffect(() => {
    document.cookie = 'phaseTrack=; path=/; max-age=0';
    document.cookie = `lang=${locale}; path=/; max-age=31536000`;
  }, [locale]);

  // Downstream ("Enables") per phase, with the edge's linkId so it can be removed here.
  const enables = new Map<number, { linkId: number; id: number }[]>();
  phases.forEach((r) =>
    r.parents.forEach((p) => enables.set(p.id, [...(enables.get(p.id) ?? []), { linkId: p.linkId, id: r.id }])),
  );

  // Cards: Done phases start collapsed. One phase may own the focused DETAILS surface.
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const isCollapsed = (p: PhaseTrackRow) => collapsed[p.id] ?? p.progress >= 100;
  const toggle = (p: PhaseTrackRow) => setCollapsed((s) => ({ ...s, [p.id]: !isCollapsed(p) }));
  const [detailsId, setDetailsId] = useState<number | null>(null);

  const [depError, setDepError] = useState<Record<number, string>>({});
  const [, startTransition] = useTransition();
  const runDep = (rowId: number, action: (fd: FormData) => Promise<{ error?: string }>, fd: FormData) =>
    startTransition(async () => {
      const result = await action(fd);
      setDepError((e) => ({ ...e, [rowId]: result.error ?? '' }));
    });

  // Jump-and-flash (station clicks, chain links, dependency chips).
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpTo = (id: number) => {
    setDetailsId(null);
    setCollapsed((s) => ({ ...s, [id]: false }));
    headRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1400);
  };
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Station y-centers are measured from the DOM so the track follows real row heights.
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

  useLayoutEffect(measure, [phases, collapsed, detailsId]);
  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  // Vertical bypass loop: out of the station, down an outer lane, back in. Tube-map
  // grammar — 90° jogs with small radii, no curves.
  const bypassPath = (e: Edge, y1: number, y2: number) => {
    const bx = laneX(e.lane);
    const r = Math.min(7, (y2 - y1) / 2 - 2);
    return [
      `M ${mainX} ${y1}`,
      `L ${bx + r} ${y1}`,
      `Q ${bx} ${y1} ${bx} ${y1 + r}`,
      `L ${bx} ${y2 - r}`,
      `Q ${bx} ${y2} ${bx + r} ${y2}`,
      `L ${mainX} ${y2}`,
    ].join(' ');
  };

  const onHeaderClick = (p: PhaseTrackRow) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('a, button, input, select, textarea, form')) return;
    toggle(p);
  };

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  // The owner's cross-program load, grouped by program (the resource constraint).
  const byProgram = new Map<number, { name: string; phaseNames: string[] }>();
  otherActive.forEach((o) => {
    const g = byProgram.get(o.projectId) ?? { name: o.projectName, phaseNames: [] };
    g.phaseNames.push(o.phaseName);
    byProgram.set(o.projectId, g);
  });

  // ---- Focused DETAILS surface: replaces the whole track, no dialog, no page ----
  const details = detailsId != null ? byId.get(detailsId) : null;
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const updateSvgRef = useRef<SVGSVGElement>(null);
  const openDetails = (p: PhaseTrackRow) => { setDrag(p.progress); setDetailsId(p.id); };
  const fromX = (clientX: number) => {
    if (!updateSvgRef.current) return;
    const r = updateSvgRef.current.getBoundingClientRect();
    const xv = ((clientX - r.left) / r.width) * 200;
    setDrag(Math.round(Math.max(0, Math.min(100, ((xv - 10) / 180) * 100))));
  };

  if (details) {
    const p = details;
    const dot = hillCoordinates(drag);
    const isConstraint = chain.constraintId === p.id;
    const availablePartners = allPartners.filter((a) => !p.partners.some((pp) => pp.partnerId === a.id));
    const availablePeople = allPeople.filter((a) => !p.people.some((pp) => pp.personId === a.id));
    const upstream = p.parents.filter((par) => byId.has(par.id));
    const downstream = enables.get(p.id) ?? [];
    const descendants = descendantsOf(p.id, phases);
    const addableParents = phases.filter(
      (c) => c.id !== p.id && !descendants.has(c.id) && !upstream.some((u) => u.id === c.id),
    );

    return (
      <div className={styles.wrapper}>
        <div className={styles.details} data-testid="phase-details">
          <button type="button" className={styles.backLink} onClick={() => setDetailsId(null)}>
            {t(locale, 'backToPhases')}
          </button>

          <div className={styles.detailsHead}>
            <h3 className={styles.detailsTitle}>{p.name}</h3>
            <span className={styles.status}
              style={{ color: p.progress > 0 && p.progress < 100 ? 'var(--fg)' : 'var(--muted)' }}>
              {status(p.progress)}
            </span>
            {isConstraint && <span className={styles.constraintTag}>{t(locale, 'constraint')}</span>}
            <span className={styles.plan}>{planWords(p)}</span>
          </div>

          {/* status update: drag the hill, leave a note */}
          <form
            action={async (fd) => {
              setSubmitting(true);
              try { await updatePhaseHill(fd); setDetailsId(null); }
              catch (err) { console.error(err); }
              finally { setSubmitting(false); }
            }}
            className={styles.detailsForm}
          >
            <input type="hidden" name="phaseId" value={p.id} />
            <input type="hidden" name="projectId" value={projectId} />

            <div className={styles.immersiveHill} style={{ userSelect: 'none' }}>
              <span className={styles.dragHint}>{t(locale, 'dragHint')}</span>
              <svg
                ref={updateSvgRef}
                viewBox="0 0 200 104"
                className={styles.updateSvg}
                style={{ cursor: 'ew-resize', touchAction: 'none' }}
                onPointerDown={(e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); fromX(e.clientX); }}
                onPointerMove={(e) => { if (dragging) fromX(e.clientX); }}
                onPointerUp={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
              >
                <path d={HILL_PATH} fill="none" stroke="var(--border)" strokeWidth={2.5} strokeLinecap="round" />
                <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border)" strokeDasharray="3 3" />
                {p.history.slice(1).map((h, i) => {
                  const d = hillCoordinates(h.progress);
                  return <circle key={i} cx={d.x} cy={d.y} r={2.5} fill="var(--muted)" opacity={0.45} />;
                })}
                <circle cx={dot.x} cy={dot.y} r={6} fill={INK} stroke="#fff" strokeWidth={1.6}
                  style={{ transition: dragging ? 'none' : 'cx 0.15s, cy 0.15s' }} />
                <text x={50} y={99} textAnchor="middle" fontSize={8} fill="var(--muted)">{t(locale, 'figuringItOut')}</text>
                <text x={150} y={99} textAnchor="middle" fontSize={8} fill="var(--muted)">{t(locale, 'makingItHappen')}</text>
              </svg>
              {/* off-screen range input keeps E2E drivable without visual noise (design.md §3) */}
              <input
                id={`phaseHillProgress-${p.id}`}
                aria-label={t(locale, 'dialogTitle')}
                type="range"
                min="0"
                max="100"
                name="hillChartProgress"
                value={drag}
                onChange={(e) => setDrag(parseInt(e.target.value))}
                style={{ position: 'absolute', left: '-9999px', width: 10, height: 10, opacity: 0.01 }}
              />
            </div>

            <label htmlFor={`phaseNotes-${p.id}`} className={styles.fieldLabel}>
              {t(locale, 'noteFieldLabel')}
            </label>
            <textarea id={`phaseNotes-${p.id}`} name="notes" rows={3}
              placeholder={t(locale, 'notePlaceholder')} className={styles.noteArea} />

            <div className={styles.immersiveActions}>
              <button type="button" className={styles.miniBtn} disabled={submitting} onClick={() => setDetailsId(null)}>
                {t(locale, 'cancel')}
              </button>
              <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                {submitting ? t(locale, 'saving') : t(locale, 'save')}
              </button>
            </div>
          </form>

          {/* who's involved: partners and people, editable */}
          <div className={styles.detailsSection}>
            <span className={styles.depsLabel}>{t(locale, 'partnersLabel')}</span>
            {p.partners.map((pp) => (
              <span key={pp.linkId} className={styles.partnerChip}>
                <Link href={`/partners/${pp.partnerId}`} className={styles.partnerLink}>{pp.name}</Link>
                {pp.role && <span className={styles.partnerRole}>{pp.role}</span>}
                <form action={removePhasePartner} className={styles.inlineForm}>
                  <input type="hidden" name="id" value={pp.linkId} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <button type="submit" className={styles.chipRemove}
                    title={t(locale, 'removeName', { name: pp.name })}
                    aria-label={t(locale, 'removeName', { name: pp.name })}>✕</button>
                </form>
              </span>
            ))}
            {availablePartners.length > 0 && (
              <form action={addPhasePartner} className={styles.addInlineForm}>
                <input type="hidden" name="phaseId" value={p.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <select name="partnerId" className={styles.quietSelect} defaultValue="" required
                  aria-label={t(locale, 'partnerToInvolve')}>
                  <option value="" disabled>{t(locale, 'addPartner')}</option>
                  {availablePartners.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input name="role" className={styles.roleInput} placeholder={t(locale, 'role')}
                  aria-label={t(locale, 'roleOptional')} />
                <button type="submit" className={styles.miniBtn}>{t(locale, 'add')}</button>
              </form>
            )}
          </div>

          <div className={styles.detailsSection}>
            <span className={styles.depsLabel}>{t(locale, 'peopleLabel')}</span>
            {p.people.map((pp) => (
              <span key={pp.linkId} className={styles.partnerChip}>
                <Link href={`/people/${pp.personId}`} className={styles.partnerLink}>{pp.name}</Link>
                {pp.role && <span className={styles.partnerRole}>{pp.role}</span>}
                <form action={removePhasePerson} className={styles.inlineForm}>
                  <input type="hidden" name="id" value={pp.linkId} />
                  <input type="hidden" name="projectId" value={projectId} />
                  <button type="submit" className={styles.chipRemove}
                    title={t(locale, 'removeName', { name: pp.name })}
                    aria-label={t(locale, 'removeName', { name: pp.name })}>✕</button>
                </form>
              </span>
            ))}
            {availablePeople.length > 0 && (
              <form action={addPhasePerson} className={styles.addInlineForm}>
                <input type="hidden" name="phaseId" value={p.id} />
                <input type="hidden" name="projectId" value={projectId} />
                <select name="personId" className={styles.quietSelect} defaultValue="" required
                  aria-label={t(locale, 'personToInvolve')}>
                  <option value="" disabled>{t(locale, 'addPerson')}</option>
                  {availablePeople.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <input name="role" className={styles.roleInput} placeholder={t(locale, 'role')}
                  aria-label={t(locale, 'roleOptional')} />
                <button type="submit" className={styles.miniBtn}>{t(locale, 'add')}</button>
              </form>
            )}
          </div>

          {/* dependencies: upstream editable, downstream removable, chips jump */}
          <div className={styles.depsRow}>
            <span className={styles.depsLabel}>{t(locale, 'after')}</span>
            {upstream.map((par) => (
              <span key={par.linkId} className={styles.depChip}>
                <button type="button" className={styles.depJump} onClick={() => jumpTo(par.id)}>
                  {byId.get(par.id)?.name}
                </button>
                <button
                  type="button"
                  className={styles.chipRemove}
                  title={t(locale, 'removeDependency')}
                  aria-label={t(locale, 'removeDependency')}
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
            {upstream.length === 0 && <span className={styles.depNone}>{t(locale, 'startingPhase')}</span>}
            {addableParents.length > 0 && (
              <select
                className={styles.quietSelect}
                value=""
                aria-label={t(locale, 'addDependency')}
                onChange={(e) => {
                  const fd = new FormData();
                  fd.set('phaseId', String(p.id));
                  fd.set('dependsOnPhaseId', e.target.value);
                  fd.set('projectId', String(projectId));
                  runDep(p.id, addPhaseDependency, fd);
                }}
              >
                <option value="" disabled>{t(locale, 'addAfter')}</option>
                {addableParents.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            )}
          </div>
          {downstream.length > 0 && (
            <div className={styles.depsRow}>
              <span className={styles.depsLabel}>{t(locale, 'enables')}</span>
              {downstream.map((d) => (
                <span key={d.linkId} className={styles.depChip}>
                  <button type="button" className={styles.depJump} onClick={() => jumpTo(d.id)}>
                    {byId.get(d.id)?.name}
                  </button>
                  <button
                    type="button"
                    className={styles.chipRemove}
                    title={t(locale, 'removeDependency')}
                    aria-label={t(locale, 'removeDependency')}
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

          {/* full hill history: every update with its position and note */}
          <div className={styles.historyList}>
            <span className={styles.metaLabel}>{t(locale, 'history')}</span>
            {p.history.map((h) => (
              <div key={h.at} className={styles.historyItem}>
                <HistoryGlyph progress={h.progress} />
                <span className={styles.historyWhen}>{fmtDate(h.at)}</span>
                <span className={styles.historyNote}>
                  {h.note ?? <span className={styles.metaMuted}>{status(h.progress)}</span>}
                  {h.by && <span className={styles.historyBy}> · {h.by}</span>}
                </span>
              </div>
            ))}
            <Link href={`/history/phase/${p.id}`} className={styles.fullHistory}>
              {t(locale, 'fullHistory')}
            </Link>
          </div>

          <form
            action={deletePhase}
            className={styles.removePhase}
            onSubmit={(e) => { if (!confirm(t(locale, 'removePhaseConfirm', { name: p.name }))) e.preventDefault(); }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="phaseId" value={p.id} />
            <button type="submit" className={styles.removeBtn}>{t(locale, 'removePhase')}</button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.wrapper}>
      {/* locale switcher */}
      <p className={styles.protoBar}>
        {LOCALES.map((l) => (
          <Link key={l.code} href={`?lang=${l.code}`}
            className={l.code === locale ? styles.protoOn : styles.protoOff}>
            {l.label}
          </Link>
        ))}
      </p>

      {chain.path.length > 1 && (
        <p className={styles.chainSummary}>
          <span className={styles.chainLabel}>{t(locale, 'criticalChain')}</span>
          {chain.path.map((id, i) => (
            <span key={id}>
              {i > 0 && <span className={styles.chainArrow}> → </span>}
              <button type="button" className={styles.chainLink} onClick={() => jumpTo(id)}>
                {byId.get(id)?.name}
              </button>
            </span>
          ))}
          <span className={styles.chainDays}> · {t(locale, 'daysRemaining', { n: chain.remainingDays })}</span>
        </p>
      )}

      {/* CCPM resource constraint: the same Googler on active phases elsewhere */}
      {owner && byProgram.size > 0 && (
        <p className={styles.resourceLine}>
          <span className={styles.resourceLabel}>{t(locale, 'resource')}</span>
          <span className={styles.resourceOwner}>{owner}</span>
          {' — '}
          {t(locale, otherActive.length === 1 ? 'alsoActiveOne' : 'alsoActive', { n: otherActive.length })}
          {': '}
          {[...byProgram.entries()].map(([pid, g], i) => (
            <span key={pid}>
              {i > 0 && '; '}
              <Link href={`/projects/${pid}`} className={styles.resourceProgram}>{g.name}</Link>
              {' ('}{g.phaseNames.join(', ')}{')'}
            </span>
          ))}
        </p>
      )}

      <div ref={containerRef} className={styles.graph} style={{ paddingLeft: gutterW }}>
        {/* the track: dependency segments only — where adjacent stations share no
            dependency there is NO connector (a line would claim a false relation);
            bypass loops in outer lanes, stations on top */}
        <svg className={styles.rail} width={gutterW} height={Math.max(geom.h, 1)} aria-hidden>
          {edges.filter((e) => e.lane === 0).map((e) => {
            const y1 = geom.ys[e.from], y2 = geom.ys[e.to];
            if (y1 == null || y2 == null) return null;
            return (
              <g key={`m${e.from}-${e.to}`}>
                <line x1={mainX} y1={y1} x2={mainX} y2={y2}
                  stroke="var(--border)" strokeWidth={e.onChain ? 3.5 : 2} strokeLinecap="round" />
                {e.fill > 0 && (
                  <line x1={mainX} y1={y1} x2={mainX} y2={y1 + (e.fill / 100) * (y2 - y1)}
                    stroke={INK} strokeWidth={e.onChain ? 3.5 : 2} strokeLinecap="round" />
                )}
                <title>{edgeTitle(e)}</title>
              </g>
            );
          })}
          {edges.filter((e) => e.lane > 0).map((e) => {
            const y1 = geom.ys[e.from], y2 = geom.ys[e.to];
            if (y1 == null || y2 == null) return null;
            const d = bypassPath(e, y1, y2);
            return (
              <g key={`b${e.from}-${e.to}`}>
                <path d={d} fill="none" stroke="var(--border)" strokeWidth={e.onChain ? 3.5 : 1.8}
                  strokeLinecap="round" pathLength={100} className={styles.hoverable} />
                {e.fill > 0 && (
                  <path d={d} fill="none" stroke={INK} strokeWidth={e.onChain ? 3.5 : 1.8}
                    strokeLinecap="round" pathLength={100} strokeDasharray={`${e.fill} ${100 - e.fill}`} />
                )}
                <title>{edgeTitle(e)}</title>
              </g>
            );
          })}
          {ordered.map((p) =>
            geom.ys[p.id] == null ? null : (
              <Station key={p.id} x={mainX} y={geom.ys[p.id]} progress={p.progress}
                onChain={onChainSet.has(p.id)} isConstraint={chain.constraintId === p.id}
                title={`${p.name} — ${status(p.progress)}`} onClick={() => jumpTo(p.id)} />
            ),
          )}
        </svg>

        {ordered.map((p) => {
          const isConstraint = chain.constraintId === p.id;
          const open = !isCollapsed(p);
          const googlerItems = p.activities.filter((a) => a.nextStep === 'Googler');
          const involved = [
            ...p.partners.map((pp) => ({ key: `pa${pp.linkId}`, href: `/partners/${pp.partnerId}`, name: pp.name, role: pp.role })),
            ...p.people.map((pp) => ({ key: `pe${pp.linkId}`, href: `/people/${pp.personId}`, name: pp.name, role: pp.role })),
          ];

          return (
            <div key={p.id} id={`phase-${p.id}`}
              className={`${styles.row} ${flashId === p.id ? styles.flash : ''}`} data-testid="phase-row">
              <div
                ref={(el) => { if (el) headRefs.current.set(p.id, el); else headRefs.current.delete(p.id); }}
                className={styles.head}
                onClick={onHeaderClick(p)}
              >
                {/* deep link, not navigation: the card + DETAILS are the phase's home */}
                <a href={`#phase-${p.id}`} className={styles.name}
                  onClick={() => jumpTo(p.id)}
                  style={!open && p.progress >= 100 ? { color: 'var(--muted)' } : undefined}>
                  {p.name}
                </a>
                <span className={styles.status}
                  style={{ color: p.progress > 0 && p.progress < 100 ? 'var(--fg)' : 'var(--muted)' }}>
                  {status(p.progress)}
                </span>
                {isConstraint && <span className={styles.constraintTag}>{t(locale, 'constraint')}</span>}
                <span className={styles.headRight}>
                  <span className={styles.plan}>{planWords(p)}</span>
                  {p.updatedAt && (
                    <span className={styles.when}>
                      {fmtDate(p.updatedAt)}
                      {p.updatedBy ? ` · ${p.updatedBy}` : ''}
                    </span>
                  )}
                  <button type="button" className={styles.chevron} onClick={() => toggle(p)}
                    aria-label={`${t(locale, 'toggleDetail')}: ${open ? 'open' : 'collapsed'}`}>
                    {open ? '−' : '+'}
                  </button>
                </span>
              </div>

              {open && (
                <div className={styles.body}>
                  <div className={styles.hillCol}>
                    <MiniHill progress={p.progress} pastPositions={p.history.slice(1).map((h) => h.progress)} />
                  </div>
                  <div className={styles.detailCol}>
                    {p.note
                      ? <div className={`${styles.note} ${styles.noteClamp}`}>{p.note}</div>
                      : <div className={styles.noteEmpty}>{t(locale, 'noNote')}</div>}

                    {/* activities: the phase's pending action items */}
                    <div className={styles.metaLine}>
                      <span className={styles.metaLabel}>{t(locale, 'activities')}</span>
                      {p.activities.length === 0 ? (
                        <span className={styles.metaMuted}>{t(locale, 'noActivities')}</span>
                      ) : (
                        <span>
                          <span className={styles.metaCount}>{t(locale, 'pendingCount', { n: p.activities.length })}</span>
                          {' — '}
                          {p.activities.slice(0, 2).map((a, i) => (
                            <span key={a.id}>
                              {i > 0 && '; '}
                              {a.linkUrl
                                ? <a href={a.linkUrl} className={styles.activityLink} target="_blank" rel="noreferrer">{a.description}</a>
                                : a.description}
                            </span>
                          ))}
                          {p.activities.length > 2 && ` +${p.activities.length - 2}`}
                        </span>
                      )}
                    </div>

                    {/* Googler focus: pending items waiting on the Googler side */}
                    {googlerItems.length > 0 && (
                      <div className={styles.metaLine}>
                        <span className={styles.metaLabel}>{t(locale, 'googlerFocus')}</span>
                        <span>
                          {googlerItems[0].assignedTo ?? owner ?? ''}
                          {googlerItems[0].assignedTo || owner ? ' — ' : ''}
                          {googlerItems[0].description}
                          {googlerItems.length > 1 && ` +${googlerItems.length - 1}`}
                        </span>
                      </div>
                    )}

                    {/* who's involved: partners + people, with roles — read-only here */}
                    {involved.length > 0 && (
                      <div className={styles.metaLine}>
                        <span className={styles.metaLabel}>{t(locale, 'involved')}</span>
                        {involved.map((it, i) => (
                          <span key={it.key}>
                            {i > 0 && ', '}
                            <Link href={it.href} className={styles.partnerLink}>{it.name}</Link>
                            {it.role && <span className={styles.partnerRole}> · {it.role}</span>}
                          </span>
                        ))}
                      </div>
                    )}

                    <div className={styles.cardBtns}>
                      <button type="button" className={styles.primaryQuietBtn} onClick={() => openDetails(p)}>
                        {t(locale, 'details')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* inline add-phase at the track's end, with an optional "after X" dependency */}
        <form action={addPhase} className={styles.addRow}>
          <input type="hidden" name="projectId" value={projectId} />
          <input name="name" className={styles.addInput} placeholder={t(locale, 'newPhasePlaceholder')} required
            aria-label={t(locale, 'newPhaseName')} />
          {phases.length > 0 && (
            <select name="dependsOn" className={styles.quietSelect} defaultValue=""
              aria-label={t(locale, 'afterPhaseOptional')}>
              <option value="">{t(locale, 'afterOptional')}</option>
              {ordered.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          <button type="submit" className={styles.miniBtn}>{t(locale, 'addPhase')}</button>
        </form>
      </div>

      {/* legend: the station/track vocabulary, one quiet line */}
      <p className={styles.legend}>
        <svg viewBox="0 0 14 14" className={styles.legendGlyph}><circle cx={7} cy={7} r={5} fill={INK} /></svg>
        {status(100)}
        <svg viewBox="0 0 14 14" className={styles.legendGlyph}>
          <circle cx={7} cy={7} r={5} fill="#fff" stroke={INK} strokeWidth={1.5} />
          <path d="M 7 2.6 A 4.4 4.4 0 0 1 7 11.4 Z" fill={INK} />
        </svg>
        {status(50)}
        <svg viewBox="0 0 14 14" className={styles.legendGlyph}><circle cx={7} cy={7} r={5} fill="#fff" stroke={INK} strokeWidth={1.5} /></svg>
        {status(0)}
        <svg viewBox="0 0 22 14" className={styles.legendGlyphWide}>
          <path d="M 2 12 L 2 5 Q 2 2 5 2 L 17 2 Q 20 2 20 5 L 20 12" fill="none" stroke="var(--muted)" strokeWidth={1.6} />
        </svg>
        {t(locale, 'legendBypass')}
        <span className={styles.legendTrack}>
          <span className={styles.legendSwatch} />
          {t(locale, 'legendTrack')}
        </span>
      </p>
    </div>
  );
}
