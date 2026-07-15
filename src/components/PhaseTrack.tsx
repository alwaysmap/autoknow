'use client';

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Markdown from './Markdown';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import { computeCriticalChain } from '../lib/criticalChain';
import { HILL_PATH, hillCoordinates } from '../lib/geometry';
import { t, statusKey, Locale } from '../lib/i18n';
import { updatePhaseHill } from '../app/actions/hill';
import { addPhasePartner, removePhasePartner } from '../app/actions/phasePartners';
import { addPhasePerson, removePhasePerson } from '../app/actions/phasePeople';
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
// A phase reads at one of two rest states on the rail: collapsed (header only) or
// standard (mini hill, latest note, and who's involved as company-typed pills — no
// role labels, the pill colour carries the type). The DETAILS affordance lifts the
// phase into a focused popover over a scrim (status update with a REQUIRED note, full
// history, partner/people involvement editing) — clearly a different mode, not a
// third inline density. STRUCTURE is not editable here: phases and dependencies are
// added/removed only in the program phase editor (/programs/[id]/phases), which
// validates the whole DAG — so the rail can never produce a broken program.
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
  company: string | null; // employer name — resolves the involvement pill's colour
  companyType: string | null; // PartnerType of the employer (OEM / Supplier / …)
  otherActive?: number; // active phases in OTHER programs involving this person (resource contention)
}

export interface PhaseTrackRow extends PhaseGraphRow {
  startedAt: string | null; // first state with progress > 0
  completedAt: string | null; // first state with progress >= 100
  activities: PhaseActivity[]; // pending action items (no longer surfaced on the rail)
  history: PhaseHistoryEntry[]; // hill updates, newest first (latest == note above)
  people: PhasePersonLink[]; // involved individuals
  description: string | null; // markdown, copied from the template, per-project editable
  googleFocus: string | null; // markdown — what Googlers/TSC focus on
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

// Involvement pills replace the old "· Role" text. A company's kind drives its colour,
// so the label is redundant: the OEM is the PRIMARY partner (solid ink); suppliers and
// every other company are light-gray chips; Googlers get a dotted outline (shape, not
// just colour). People never take the solid treatment — a person reads as a light chip.
function pillClass(typeName: string | null, companyName: string | null, isPerson = false): string {
  if (typeName === 'Google' || companyName === 'Google') return styles.pillGoogler;
  if (!isPerson && typeName === 'OEM') return styles.pillLead;
  return styles.pillCompany;
}

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

// Small inline station glyph for the popover header — ties the focused card to its
// place on the line.
function StationGlyph({ progress }: { progress: number }) {
  return (
    <svg viewBox="0 0 14 14" width={14} height={14} className={styles.popStation} aria-hidden>
      <circle cx={7} cy={7} r={5} fill={progress >= 100 ? INK : '#fff'} stroke={INK} strokeWidth={1.5} />
      {progress > 0 && progress < 100 && <path d="M 7 2.6 A 4.4 4.4 0 0 1 7 11.4 Z" fill={INK} />}
    </svg>
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

  // WHY a phase wears the CONSTRAINT tag — one COMPACT clause per signal: (1) it
  // heads the critical chain (time), (2) its people/partners/owner are multiplexed
  // across programs right now (resource — CCPM's other half), (3) it has outrun its
  // forecast (buffer consumption). Rendered as ONE quiet line under the tag — the
  // evidence must not out-shout the update itself.
  const constraintWhy = (p: PhaseTrackRow): string[] => {
    const parts = [t(locale, 'constraintGates', { n: chain.remainingDays })];
    const contended: string[] = [];
    if (owner && otherActive.length > 0) contended.push(`${owner} +${otherActive.length}`);
    for (const pp of p.partners) {
      if ((pp.otherActive ?? 0) > 0) contended.push(`${pp.name} +${pp.otherActive}`);
    }
    for (const pp of p.people) {
      if ((pp.otherActive ?? 0) > 0) contended.push(`${pp.name} +${pp.otherActive}`);
    }
    if (contended.length > 0) parts.push(t(locale, 'constraintStretched', { items: contended.join(', ') }));
    if (p.progress < 100 && p.startedAt) {
      const elapsed = (now - +new Date(p.startedAt)) / DAY_MS;
      if (elapsed > p.forecastedDuration) {
        parts.push(t(locale, 'constraintWhyOverPlan', { e: fmtW(elapsed), p: fmtW(p.forecastedDuration) }));
      }
    }
    return parts;
  };

  // Expire the retired offline-worker cookie from earlier sessions. (Locale is
  // app-wide now — the nav switcher owns the `lang` cookie.)
  useEffect(() => {
    document.cookie = 'phaseTrack=; path=/; max-age=0';
  }, []);

  // Downstream ("Enables") per phase, with the edge's linkId so it can be removed here.
  const enables = new Map<number, { linkId: number; id: number }[]>();
  phases.forEach((r) =>
    r.parents.forEach((p) => enables.set(p.id, [...(enables.get(p.id) ?? []), { linkId: p.linkId, id: r.id }])),
  );

  // Cards: Done phases start collapsed. One phase may own the focused DETAILS popover.
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const isCollapsed = (p: PhaseTrackRow) => collapsed[p.id] ?? p.progress >= 100;
  const toggle = (p: PhaseTrackRow) => setCollapsed((s) => ({ ...s, [p.id]: !isCollapsed(p) }));
  const [detailsId, setDetailsId] = useState<number | null>(null);

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

  // Esc closes the focused popover — the scrim is the other way out.
  useEffect(() => {
    if (detailsId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetailsId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailsId]);

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

  // ---- Focused DETAILS popover: floats over a scrim, the rail dimmed behind ----
  const details = detailsId != null ? byId.get(detailsId) : null;
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);
  const updateSvgRef = useRef<SVGSVGElement>(null);
  const openDetails = (p: PhaseTrackRow) => { setDrag(p.progress); setNoteError(false); setDetailsId(p.id); };
  const fromX = (clientX: number) => {
    if (!updateSvgRef.current) return;
    const r = updateSvgRef.current.getBoundingClientRect();
    const xv = ((clientX - r.left) / r.width) * 200;
    setDrag(Math.round(Math.max(0, Math.min(100, ((xv - 10) / 180) * 100))));
  };

  // The popover body — built only when a phase is focused, rendered inside the scrim.
  const detailsOverlay = (() => {
    if (!details) return null;
    const p = details;
    const dot = hillCoordinates(drag);
    const isConstraint = chain.constraintId === p.id;
    const availablePartners = allPartners.filter((a) => !p.partners.some((pp) => pp.partnerId === a.id));
    const availablePeople = allPeople.filter((a) => !p.people.some((pp) => pp.personId === a.id));
    const upstream = p.parents.filter((par) => byId.has(par.id));
    const downstream = enables.get(p.id) ?? [];

    return (
      <div className={styles.scrim} role="presentation" onClick={() => setDetailsId(null)}>
        <div
          className={styles.popover}
          role="dialog"
          aria-modal="true"
          aria-label={p.name}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className={styles.popClose} onClick={() => setDetailsId(null)}
            aria-label={t(locale, 'closeEdit')}>✕</button>

          <div className={styles.details} data-testid="phase-details">
            <div className={styles.detailsHead}>
              <StationGlyph progress={p.progress} />
              <h3 className={styles.detailsTitle} title={status(p.progress)}>{p.name}</h3>
              <span className={styles.plan}>{planWords(p)}</span>
            </div>

            {isConstraint && (
              <p className={styles.constraintWhy}>{constraintWhy(p).join(' · ')}</p>
            )}

            {/* template-sourced content: what this phase is, and where Google leans in */}
            {p.description && (
              <div className={styles.templateDoc}><Markdown>{p.description}</Markdown></div>
            )}
            {p.googleFocus && (
              <div className={styles.metaLine}>
                <span className={styles.metaLabel}>{t(locale, 'googleFocusLabel')}</span>
                <span className={styles.templateFocus}><Markdown>{p.googleFocus}</Markdown></span>
              </div>
            )}

            {/* status update: drag the hill, say what changed — the note is REQUIRED,
                a silent dot move is unreadable in history and invisible to the brief */}
            <form
              action={async (fd) => {
                if (!((fd.get('notes') as string) || '').trim()) { setNoteError(true); return; }
                setNoteError(false);
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

              <span className={styles.fieldLabel}>{t(locale, 'noteFieldLabel')}</span>
              {/* WYSIWYG markdown (MDXEditor): rich editing, markdown persisted */}
              <MarkdownNoteEditor name="notes" placeholder={t(locale, 'notePlaceholder')}
                ariaLabel={t(locale, 'noteFieldLabel')} />
              {noteError && <div className={styles.depError}>{t(locale, 'noteRequired')}</div>}

              <div className={styles.immersiveActions}>
                <button type="button" className={styles.miniBtn} disabled={submitting} onClick={() => setDetailsId(null)}>
                  {t(locale, 'cancel')}
                </button>
                <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                  {submitting ? t(locale, 'saving') : t(locale, 'save')}
                </button>
              </div>
            </form>

            {/* who's involved: partners and people, editable (roles kept here, where the
                free-text function is actually edited — the rail shows type-coloured pills) */}
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
              {availablePartners.length > 0 ? (
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
              ) : (
                // never leave the section affordance-less: say WHY there's nothing to add
                <span className={styles.depNone}>{t(locale, 'allPartnersInvolved')}</span>
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
              {availablePeople.length > 0 ? (
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
              ) : (
                // never leave the section affordance-less: say WHY there's nothing to add
                <span className={styles.depNone}>{t(locale, 'allPeopleInvolved')}</span>
              )}
            </div>

            {/* dependencies: read-only here — chips jump to the phase; the structure
                itself is edited only in the DAG-validated program phase editor */}
            <div className={styles.depsRow}>
              <span className={styles.depsLabel}>{t(locale, 'after')}</span>
              {upstream.map((par) => (
                <span key={par.linkId} className={styles.depChip}>
                  <button type="button" className={styles.depJump} onClick={() => jumpTo(par.id)}>
                    {byId.get(par.id)?.name}
                  </button>
                </span>
              ))}
              {upstream.length === 0 && <span className={styles.depNone}>{t(locale, 'startingPhase')}</span>}
            </div>
            {downstream.length > 0 && (
              <div className={styles.depsRow}>
                <span className={styles.depsLabel}>{t(locale, 'enables')}</span>
                {downstream.map((d) => (
                  <span key={d.linkId} className={styles.depChip}>
                    <button type="button" className={styles.depJump} onClick={() => jumpTo(d.id)}>
                      {byId.get(d.id)?.name}
                    </button>
                  </span>
                ))}
              </div>
            )}

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
          </div>
        </div>
      </div>
    );
  })();

  return (
    <div className={styles.wrapper}>
      {/* No chain summary up top — the chain is already the rail's heavy track, and the
          constraint card carries the evidence line. A second rendering said it twice. */}

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
              <Link href={`/programs/${pid}`} className={styles.resourceProgram}>{g.name}</Link>
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
          // Who's involved, as company-typed pills (partners then their people). The
          // pill colour carries the type, so no role text rides along on the rail.
          const involved = [
            ...p.partners.map((pp) => ({
              key: `pa${pp.linkId}`, href: `/partners/${pp.partnerId}`, name: pp.name,
              cls: pillClass(pp.type ?? null, pp.name), load: pp.otherActive ?? 0,
            })),
            ...p.people.map((pp) => ({
              key: `pe${pp.linkId}`, href: `/people/${pp.personId}`, name: pp.name,
              cls: pillClass(pp.companyType, pp.company, true), load: pp.otherActive ?? 0,
            })),
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
                  title={status(p.progress)}
                  style={!open && p.progress >= 100 ? { color: 'var(--muted)' } : undefined}>
                  {p.name}
                </a>
                <span className={styles.headRight}>
                  <span className={styles.plan}>{planWords(p)}</span>
                  {open && (
                    <button type="button" className={styles.iconBtn} onClick={() => openDetails(p)}
                      title={t(locale, 'details')} aria-label={t(locale, 'details')}>
                      <svg viewBox="0 0 14 14" width={13} height={13} aria-hidden>
                        <path d="M2 5 V2 H5 M9 2 H12 V5 M12 9 V12 H9 M5 12 H2 V9"
                          fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  )}
                  <button type="button" className={styles.chevron} onClick={() => toggle(p)}
                    aria-expanded={open}
                    aria-label={`${t(locale, 'toggleDetail')}: ${open ? 'open' : 'collapsed'}`}>
                    <svg viewBox="0 0 12 12" width={12} height={12} aria-hidden
                      style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.15s ease' }}>
                      <path d="M2.5 4.5 L6 8 L9.5 4.5" fill="none" stroke="currentColor"
                        strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </span>
              </div>

              {open && (
                <div className={styles.body}>
                  <div className={styles.hillCol}>
                    <MiniHill progress={p.progress} pastPositions={p.history.slice(1).map((h) => h.progress)} />
                  </div>
                  <div className={styles.detailCol}>
                    {/* THE update is the card's headline — what happened, who said so, when */}
                    {p.note
                      ? <div className={`${styles.note} ${styles.noteClamp}`}>{p.note}</div>
                      : <div className={styles.noteEmpty}>{t(locale, 'noNote')}</div>}
                    {p.updatedAt && (
                      <div className={styles.noteBy}>
                        {fmtDate(p.updatedAt)}
                        {p.updatedBy ? ` · ${p.updatedBy}` : ''}
                      </div>
                    )}

                    {/* problems, if any: ONE clamped line of evidence (full text on hover) */}
                    {isConstraint && (
                      <p className={styles.constraintWhy} title={constraintWhy(p).join(' · ')}>
                        {constraintWhy(p).join(' · ')}
                      </p>
                    )}

                    {/* who's involved: quiet company-typed pills; +n = active elsewhere */}
                    {involved.length > 0 && (
                      <div className={styles.pillRow}>
                        {involved.map((it) => (
                          <Link key={it.key} href={it.href} className={`${styles.pill} ${it.cls}`}
                            title={it.load > 0 ? t(locale, 'contendedTitle', { name: it.name, n: it.load }) : undefined}>
                            {it.name}
                            {it.load > 0 && <span className={styles.pillLoad}>+{it.load}</span>}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* structure is edited in one place: the DAG-validated program phase editor */}
        <div className={styles.addRow}>
          <Link href={`/programs/${projectId}/phases`} className={styles.editPhasesLink}>
            {t(locale, 'editPhases')}
          </Link>
        </div>
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
        <svg viewBox="0 0 18 18" className={styles.legendGlyph}>
          <circle cx={9} cy={9} r={7.5} fill="none" stroke="#c98a1a" strokeWidth={1.8} />
          <circle cx={9} cy={9} r={4} fill="#fff" stroke={INK} strokeWidth={1.5} />
          <path d="M 9 5.4 A 3.6 3.6 0 0 1 9 12.6 Z" fill={INK} />
        </svg>
        {t(locale, 'legendConstraint')}
        <svg viewBox="0 0 22 14" className={styles.legendGlyphWide}>
          <path d="M 2 12 L 2 5 Q 2 2 5 2 L 17 2 Q 20 2 20 5 L 20 12" fill="none" stroke="var(--muted)" strokeWidth={1.6} />
        </svg>
        {t(locale, 'legendBypass')}
        <span className={styles.legendTrack}>
          <span className={styles.legendSwatch} />
          {t(locale, 'legendTrack')}
        </span>
      </p>

      {detailsOverlay}
    </div>
  );
}
