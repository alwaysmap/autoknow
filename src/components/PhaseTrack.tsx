'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Markdown from './Markdown';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import { computeCriticalChain } from '../lib/criticalChain';
import { stationOrder, classifyEdges, type Edge } from '../lib/phaseTrackLayout';
import PhaseHillChart from './PhaseHillChart';
import { deriveEndPhase } from '../lib/programDag';
import { validateTemplateDag } from '../lib/templateDag';
import { HILL_PATH, hillCoordinates } from '../lib/geometry';
import { t, statusKey, Locale } from '../lib/i18n';
import { isPhaseActive, statusProgress, phaseColor } from '../lib/phase';
import HillHistoryList from './HillHistoryList';
import type { HillChange } from '../lib/history';
import { updatePhaseHill, setPhaseStarted } from '../app/actions/hill';
import { addPhasePartner, removePhasePartner } from '../app/actions/phasePartners';
import { addPhasePerson, removePhasePerson } from '../app/actions/phasePeople';
import type { PhaseGraphRow } from './PhaseGraph';
import styles from './PhaseTrack.module.css';
import { localDate } from '../lib/dates';

// The phase surface as a single train line. The CRITICAL CHAIN is the main line —
// its stations come first, in chain order, so the chain renders as one contiguous
// solid track. Branch phases follow; their real dependencies arrive as express bypass
// loops in an outer lane. Where two adjacent stations share no dependency there is NO
// connector at all — a line would imply a relationship that doesn't exist. Each
// dependency segment carries STATE ONLY: it inks solid once the phase it departs is
// done, and stays gray otherwise. Never a proportional fill — a part-inked segment
// beside a filled "done" station read as a contradiction. Schedule pace (ahead/over
// plan) is words instead: a small chip beside the planned/elapsed label.
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
  startedAt: string | null; // explicit Active toggle if set, else first state with progress > 0
  startedExplicit: boolean; // an explicit start claim exists (vs derived from first progress)
  completedAt: string | null; // first state with progress >= 100
  activities: PhaseActivity[]; // pending action items (no longer surfaced on the rail)
  history: PhaseHistoryEntry[]; // hill updates, newest first (latest == note above)
  people: PhasePersonLink[]; // involved individuals
  description: string | null; // markdown, copied from the template, per-project editable
  googleFocus: string | null; // markdown — what Googlers/TSC focus on
}

interface PhaseTrackProps {
  projectId: number;
  phases: PhaseTrackRow[];
  allPartners: { id: number; name: string }[];
  allPeople: { id: number; name: string }[];
  locale: Locale;
}

// Ink rides the theme token — a hardcoded dark gray vanishes on the dark paper.
const RAIL_PAD = 10, LANE_W = 20, INK = 'var(--fg)';
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

// Monochrome station symbol: filled = done, right-half = in progress, open = not
// started. Heavier ink for critical-chain stations; a single amber ring marks the
// constraint. Hover for the name+status; click jumps to the row.
function Station({ x, y, progress, started, onChain, isConstraint, title, onClick }: {
  x: number; y: number; progress: number; started?: boolean; onChain: boolean; isConstraint: boolean;
  title: string; onClick?: () => void;
}) {
  const r = onChain ? 6 : 5;
  const stroke = onChain ? INK : 'var(--muted)';
  return (
    <g onClick={onClick} className={styles.station}>
      {/* interchange-station treatment: the ring's interior is solid white so the
          track visibly terminates at the station instead of passing through */}
      {isConstraint && <circle cx={x} cy={y} r={r + 4} fill="var(--paper)" stroke="var(--chain)" strokeWidth={2} />}
      <circle cx={x} cy={y} r={r} fill={progress >= 100 ? stroke : 'var(--paper)'} stroke={stroke} strokeWidth={onChain ? 2 : 1.5} />
      {progress > 0 && progress < 100 && (
        <path d={`M ${x} ${y - (r - 0.75)} A ${r - 0.75} ${r - 0.75} 0 0 1 ${x} ${y + (r - 0.75)} Z`} fill={stroke} stroke="none" />
      )}
      {/* started (Active toggle) with no progress yet: a center dot — work is
          underway even though the hill hasn't moved */}
      {progress <= 0 && started && <circle cx={x} cy={y} r={r - 3} fill={stroke} stroke="none" />}
      <title>{title}</title>
    </g>
  );
}

// Small inline station glyph for the popover header — ties the focused card to its
// place on the line.
function StationGlyph({ progress }: { progress: number }) {
  return (
    <svg viewBox="0 0 14 14" width={14} height={14} className={styles.popStation} aria-hidden>
      <circle cx={7} cy={7} r={5} fill={progress >= 100 ? INK : 'var(--paper)'} stroke={INK} strokeWidth={1.5} />
      {progress > 0 && progress < 100 && <path d="M 7 2.6 A 4.4 4.4 0 0 1 7 11.4 Z" fill={INK} />}
    </svg>
  );
}


// Textless mini hill for standard cards: the trail of every historical position as
// small dots, the current position as the one big ball.
// A single phase's hill: the immediately-prior position as a light ghost marker, and
// the current position as a bigger, darker dot. Two markers whenever a prior exists,
// so movement reads at a glance (no scatter of every past point).
function MiniHill({ progress, previousProgress }: { progress: number; previousProgress?: number | null }) {
  const c = hillCoordinates(progress);
  const prev = previousProgress != null && previousProgress !== progress ? hillCoordinates(previousProgress) : null;
  return (
    <svg viewBox="0 0 200 90" className={styles.miniHill} aria-hidden>
      <path d={HILL_PATH} fill="none" stroke="var(--border)" strokeWidth={3} strokeLinecap="round" />
      <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border)" strokeDasharray="3 3" />
      {prev && <circle cx={prev.x} cy={prev.y} r={5} fill="var(--paper)" stroke="var(--muted)" strokeWidth={2} />}
      <circle cx={c.x} cy={c.y} r={8} fill={INK} stroke="var(--paper)" strokeWidth={1.6} />
    </svg>
  );
}

export default function PhaseTrack({ projectId, phases, allPartners, allPeople, locale }: PhaseTrackProps) {
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
    if (isPhaseActive(p.progress, p.startedAt) && p.startedAt) {
      return t(locale, 'plannedElapsed', { p: planned, e: fmtW((now - +new Date(p.startedAt)) / DAY_MS) });
    }
    return t(locale, 'plannedOnly', { p: planned });
  };

  // Schedule pace, kept OUT of the rail: words in a quiet chip, never a fill, so it
  // cannot be misread as completion. Done under plan → "early"; running or finished
  // past the forecast → "over plan". A phase in progress but within plan is simply
  // on plan — no chip. Sub-day deltas stay silent (rounding noise, not signal).
  const pace = (p: PhaseTrackRow): { over: boolean; text: string } | null => {
    let actualDays: number | null = null;
    if (p.progress >= 100 && p.startedAt && p.completedAt) {
      actualDays = (+new Date(p.completedAt) - +new Date(p.startedAt)) / DAY_MS;
    } else if (isPhaseActive(p.progress, p.startedAt) && p.startedAt) {
      actualDays = (now - +new Date(p.startedAt)) / DAY_MS;
    }
    if (actualDays == null) return null;
    const delta = actualDays - p.forecastedDuration;
    if (p.progress >= 100 && delta <= -1) return { over: false, text: t(locale, 'paceEarly', { d: fmtW(-delta) }) };
    if (delta >= 1) return { over: true, text: t(locale, 'paceOver', { d: fmtW(delta) }) };
    return null;
  };
  const paceChip = (p: PhaseTrackRow) => {
    const pc = pace(p);
    if (!pc) return null;
    return <span className={`${styles.pace} ${pc.over ? styles.paceOver : styles.paceEarly}`}>{pc.text}</span>;
  };

  // WHY a phase wears the CONSTRAINT tag — one COMPACT clause per signal: (1) it
  // heads the critical chain (time), (2) its people/partners/owner are multiplexed
  // across programs right now (resource — CCPM's other half), (3) it has outrun its
  // forecast (buffer consumption). Rendered as ONE quiet line under the tag — the
  // evidence must not out-shout the update itself.
  const constraintWhy = (p: PhaseTrackRow): string[] => {
    const parts = [t(locale, 'constraintGates', { n: chain.remainingDays })];
    const contended: string[] = [];
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

  // Cards: EVERY phase starts collapsed (hide-all default) — the rail itself is the
  // overview; expand is opt-in per row or via the ⋯ menu. One phase may own the
  // focused DETAILS popover.
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({});
  const isCollapsed = (p: PhaseTrackRow) => collapsed[p.id] ?? true;
  const toggle = (p: PhaseTrackRow) => setCollapsed((s) => ({ ...s, [p.id]: !isCollapsed(p) }));
  const [detailsId, setDetailsId] = useState<number | null>(null);

  // Title ⋯ menu: bulk expand/hide plus the one door to structural editing.
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const legendRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);
  const setAll = (value: boolean) => {
    setCollapsed(Object.fromEntries(phases.map((p) => [p.id, value])));
    setMenuOpen(false);
  };

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

  // Deeplinks from the dashboard's hill chart: a dot click jump-and-flashes here.
  useEffect(() => {
    const onJump = (e: Event) => {
      const id = (e as CustomEvent<number>).detail;
      if (phases.some((p) => p.id === id)) jumpTo(id);
    };
    window.addEventListener('autoknow:jump-phase', onJump);
    return () => window.removeEventListener('autoknow:jump-phase', onJump);
  }, [phases]);

  // Esc closes the focused popover — the scrim is the other way out.
  useEffect(() => {
    if (detailsId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetailsId(null); };
    window.addEventListener('keydown', onKey);
    // A modal owns the viewport: the page behind must not scroll under the scrim.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
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
  // grammar — 90° jogs with small radii, no curves. Direction-agnostic and the radius
  // clamped positive: stationOrder guarantees downward edges, but a degenerate span
  // must degrade to a tight loop, never a negative radius (which renders as a giant
  // off-panel arc — the old branch-then-rejoin bug).
  const bypassPath = (e: Edge, yA: number, yB: number) => {
    const [y1, y2] = yA <= yB ? [yA, yB] : [yB, yA];
    const bx = laneX(e.lane);
    const r = Math.max(2, Math.min(7, (y2 - y1) / 2 - 2));
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


  // One-line goal excerpt for the rail card: the first meaningful line of the
  // Goal & DoD markdown, tokens stripped — the phase's purpose at a glance.
  const goalExcerpt = (md: string): string =>
    md.split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/\*\*/g, '').trim()).find(Boolean) ?? '';

  const fmtDate = (iso: string) =>
    localDate(iso, locale, { month: 'short', day: 'numeric' });

  // Structural DAG problems (cycles, dead-ending branches, unknown deps) join the
  // notices list — the same validator the phase editor runs, so the rail and the
  // editor never disagree about what "broken" means.
  const structureIssues = useMemo(() => {
    const nodes = deriveEndPhase(
      phases.map((p, i) => ({ id: p.id, name: p.name, sortOrder: i, dependsOn: p.parents.map((x) => x.id) })),
    );
    const v = validateTemplateDag(
      nodes.map((n) => ({ id: n.id, name: n.name, isEndPhase: n.isEndPhase })),
      phases.flatMap((r) => r.parents.map((par) => ({ nodeId: r.id, dependsOnId: par.id }))),
    );
    return v.ok ? [] : v.errors.map((e) => e.message);
  }, [phases]);

  // ---- Focused DETAILS popover: floats over a scrim, the rail dimmed behind ----
  const details = detailsId != null ? byId.get(detailsId) : null;
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [noteError, setNoteError] = useState(false);
  // Involvement add-forms are on-demand: chips at rest, a ghost "+" reveals the
  // small form for exactly one of partner/person at a time.
  const [addOpen, setAddOpen] = useState<'partner' | 'person' | null>(null);
  // The work-started date commits the moment it's picked — unlike the rest of the
  // pane, which commits on Save Update. That asymmetry must be visible: a quiet
  // transient "✓ Saved" confirms the write; a persistent error says it failed.
  const [startedSave, setStartedSave] = useState<'saved' | 'error' | null>(null);
  const startedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (startedTimer.current) clearTimeout(startedTimer.current); }, []);
  // The progress pane rests in VIEW mode: read-only hill + the update story.
  // The Update affordance flips to EDIT (draggable ball, required note, Save);
  // Save/Cancel drop back to view.
  const [editing, setEditing] = useState(false);
  const updateSvgRef = useRef<SVGSVGElement>(null);
  const openDetails = (p: PhaseTrackRow) => {
    setDrag(p.progress); setNoteError(false); setAddOpen(null); setEditing(false);
    if (startedTimer.current) clearTimeout(startedTimer.current);
    setStartedSave(null);
    setDetailsId(p.id);
  };
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

          {/* keyed by phase: swapping a neighbour into this window must remount the
              form (a half-typed note belongs to the phase it was typed for) */}
          <div className={styles.details} data-testid="phase-details" key={p.id}>
            <div className={styles.detailsHead}>
              <StationGlyph progress={p.progress} />
              <h3 className={styles.detailsTitle} title={status(statusProgress(p.progress, p.startedAt))}>{p.name}</h3>
              <span className={styles.plan}>{planWords(p)}</span>
              {paceChip(p)}
            </div>

            {isConstraint && (
              <p className={styles.constraintWhy}>{constraintWhy(p).join(' · ')}</p>
            )}

            {/* Option-1 dossier: two zones, hard-separated. LEFT = Progress (what
                happened — the update form + full history, scrollable). RIGHT =
                About (what the phase IS — goal & definition of done, flow,
                involvement, timing). Updates lead; metadata follows. */}
            <div className={styles.dossier}>
              <div className={styles.progressPane}>

            {/* Two modes. VIEW (rest): read-only hill, the work-started fact, and
                the story — latest update big, older ones compact. EDIT (behind the
                Update affordance): the ball unlocks, the REQUIRED note appears —
                a silent dot move is unreadable in history and invisible to the
                brief — and Save lands the update back at the top of the story. */}
            <form
              action={async (fd) => {
                if (!((fd.get('notes') as string) || '').trim()) { setNoteError(true); return; }
                setNoteError(false);
                setSubmitting(true);
                try { await updatePhaseHill(fd); setEditing(false); }
                catch (err) { console.error(err); }
                finally { setSubmitting(false); }
              }}
              className={styles.detailsForm}
            >
              <input type="hidden" name="phaseId" value={p.id} />
              <input type="hidden" name="projectId" value={projectId} />

              {/* work-started leads the pane: the cycle-time clock (wait vs active),
                  claimed as a DATE — blank until someone records when work actually
                  began. Saves immediately on pick; nameless so it never rides the
                  update-form submission. The Update affordance rides the same row:
                  one fact + one action line (design.md §7). */}
              <div className={styles.startedActionRow}>
              <label className={styles.startedRow}>
                <span>{t(locale, 'workStartedOn')}</span>
                <input
                  type="date"
                  className={styles.startedInput}
                  defaultValue={p.startedAt ? p.startedAt.slice(0, 10) : ''}
                  disabled={submitting}
                  onChange={async (e) => {
                    const fd = new FormData();
                    fd.set('phaseId', String(p.id));
                    fd.set('projectId', String(projectId));
                    fd.set('startedOn', e.target.value);
                    setSubmitting(true);
                    if (startedTimer.current) clearTimeout(startedTimer.current);
                    setStartedSave(null);
                    try {
                      await setPhaseStarted(fd);
                      setStartedSave('saved');
                      startedTimer.current = setTimeout(() => setStartedSave(null), 2500);
                    } catch (err) {
                      console.error(err);
                      setStartedSave('error');
                    } finally {
                      setSubmitting(false);
                    }
                  }}
                />
                {startedSave === 'saved' && (
                  <span className={styles.savedTick} role="status">✓ {t(locale, 'saved')}</span>
                )}
                {startedSave === 'error' && (
                  <span className={styles.depError} role="alert">{t(locale, 'saveFailed')}</span>
                )}
              </label>
              {!editing && (
                <button type="button" className={styles.primaryQuietBtn}
                  onClick={() => { setDrag(p.progress); setNoteError(false); setEditing(true); }}>
                  {t(locale, 'update')}
                </button>
              )}
              </div>

              <div className={styles.immersiveHill} style={{ userSelect: 'none' }}>
                {editing && <span className={styles.dragHint}>{t(locale, 'dragHint')}</span>}
                <svg
                  ref={updateSvgRef}
                  viewBox="0 0 200 104"
                  className={styles.updateSvg}
                  style={{ cursor: editing ? 'ew-resize' : 'default', touchAction: 'none' }}
                  onPointerDown={editing ? (e) => { e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); fromX(e.clientX); } : undefined}
                  onPointerMove={editing ? (e) => { if (dragging) fromX(e.clientX); } : undefined}
                  onPointerUp={editing ? (e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); } : undefined}
                >
                  <path d={HILL_PATH} fill="none" stroke="var(--border)" strokeWidth={2.5} strokeLinecap="round" />
                  <line x1={100} y1={10} x2={100} y2={80} stroke="var(--border)" strokeDasharray="3 3" />
                  {/* movement in brand ink: the immediate PRIOR position is a ghost
                      ring (same grammar as the rail's mini hill), older positions a
                      faint trail, and the live ball full brand — all theme tokens,
                      so both light and dark paper keep the contrast */}
                  {p.history.slice(1).map((h, i) => {
                    const d = hillCoordinates(h.progress);
                    return i === 0 ? (
                      <circle key={i} cx={d.x} cy={d.y} r={4} fill="var(--paper)"
                        stroke="var(--p-400)" strokeWidth={1.8} />
                    ) : (
                      <circle key={i} cx={d.x} cy={d.y} r={2.5} fill="var(--p-400)" opacity={0.35} />
                    );
                  })}
                  <circle cx={dot.x} cy={dot.y} r={6} fill="var(--p-500)" stroke="var(--paper)" strokeWidth={1.6}
                    style={{ transition: dragging ? 'none' : 'cx 0.15s, cy 0.15s' }} />
                  <text x={50} y={99} textAnchor="middle" fontSize={8} fill="var(--muted)">{t(locale, 'figuringItOut')}</text>
                  <text x={150} y={99} textAnchor="middle" fontSize={8} fill="var(--muted)">{t(locale, 'makingItHappen')}</text>
                </svg>
                {/* off-screen range input keeps E2E drivable without visual noise
                    (design.md §3) — present only while editing, like the ball */}
                {editing && (
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
                )}
              </div>

              {editing && (
                <>
                  {/* WYSIWYG markdown (MDXEditor): rich editing, markdown persisted.
                      No visible label — the placeholder carries the prompt; the
                      aria-label keeps the field named for assistive tech. */}
                  <MarkdownNoteEditor name="notes" placeholder={t(locale, 'notePlaceholder')}
                    ariaLabel={t(locale, 'noteFieldLabel')} />
                  {noteError && <div className={styles.depError}>{t(locale, 'noteRequired')}</div>}

                  <div className={styles.immersiveActions}>
                    <button type="button" className={styles.miniBtn} disabled={submitting}
                      onClick={() => { setEditing(false); setNoteError(false); setDrag(p.progress); }}>
                      {t(locale, 'cancel')}
                    </button>
                    <button type="submit" className={styles.primaryBtn} disabled={submitting}>
                      {submitting ? t(locale, 'saving') : t(locale, 'save')}
                    </button>
                  </div>
                </>
              )}
            </form>

            {/* the story, view mode only: the LATEST update is the headline — big
                note, status + date · author above it — older updates follow as the
                same compact cards as /history/phase/:id */}
            {!editing && (
              <div className={styles.storyView}>
                {p.history.length > 0 ? (
                  <div className={styles.latestUpdate}>
                    <div className={styles.latestMeta}>
                      <span className={styles.latestStatus} style={{ color: phaseColor(p.id) }}>
                        {status(p.history[0].progress)}
                      </span>
                      <span className={styles.latestWhen}>
                        {fmtDate(p.history[0].at)}
                        {p.history[0].by ? ` · ${p.history[0].by}` : ''}
                      </span>
                    </div>
                    {p.history[0].note
                      ? <div className={styles.latestNote}><Markdown>{p.history[0].note}</Markdown></div>
                      : <div className={styles.noteEmpty}>{t(locale, 'noNote')}</div>}
                  </div>
                ) : (
                  <div className={styles.noteEmpty}>{t(locale, 'noNote')}</div>
                )}
                {p.history.length > 1 && (
                  <div className={styles.historyList}>
                    <span className={styles.metaLabel}>{t(locale, 'history')}</span>
                    <HillHistoryList
                      compact
                      locale={locale}
                      color={phaseColor(p.id)}
                      changes={p.history.slice(1).map((h, i): HillChange => ({
                        timestamp: h.at,
                        progress: h.progress,
                        previousProgress: p.history[i + 2]?.progress ?? null,
                        notes: h.note,
                        source: h.by,
                      }))}
                    />
                  </div>
                )}
                <Link href={`/history/phase/${p.id}`} className={styles.fullHistory}>
                  {t(locale, 'fullHistory')}
                </Link>
              </div>
            )}

              </div>

              <div className={styles.aboutPane}>
                {/* immediate neighbourhood as quiet clickable labels: ← feeds this
                    phase, → departs it. Clicking swaps THAT phase into this same
                    window (openDetails, not jumpTo — the popover is reused). The
                    structure itself is edited only in the program phase editor. */}
                {(upstream.length > 0 || downstream.length > 0) && (
                  <div className={styles.flowLinks}>
                    {upstream.length > 0 && (
                      <div className={styles.flowRow} aria-label={t(locale, 'after')}>
                        <span className={styles.flowArrow} aria-hidden>←</span>
                        <span className={styles.flowSet}>
                          {upstream.map((par) => (
                            <button key={par.linkId} type="button" className={styles.flowLink}
                              title={`${t(locale, 'after')} · ${byId.get(par.id)?.name}`}
                              onClick={() => { const target = byId.get(par.id); if (target) openDetails(target); }}>
                              {byId.get(par.id)?.name}
                            </button>
                          ))}
                        </span>
                      </div>
                    )}
                    {downstream.length > 0 && (
                      <div className={styles.flowRow} aria-label={t(locale, 'enables')}>
                        <span className={styles.flowArrow} aria-hidden>→</span>
                        <span className={styles.flowSet}>
                          {downstream.map((d) => (
                            <button key={d.linkId} type="button" className={styles.flowLink}
                              title={`${t(locale, 'enables')} · ${byId.get(d.id)?.name}`}
                              onClick={() => { const target = byId.get(d.id); if (target) openDetails(target); }}>
                              {byId.get(d.id)?.name}
                            </button>
                          ))}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {/* template-sourced content: what this phase is, and where Google leans in.
                    Absent content still gets a doorway — the field lives in Edit phases. */}
                {p.description ? (
                  <div className={styles.templateDoc}><Markdown>{p.description}</Markdown></div>
                ) : (
                  <p className={styles.noGoal}>
                    {t(locale, 'noGoalYet')}{' '}
                    <Link href={`/programs/${projectId}/phases`}>{t(locale, 'editPhases')}</Link>
                  </p>
                )}
                {p.googleFocus && (
                  <div className={styles.metaLine}>
                    <span className={styles.metaLabel}>{t(locale, 'googleFocusLabel')}</span>
                    <span className={styles.templateFocus}><Markdown>{p.googleFocus}</Markdown></span>
                  </div>
                )}
                <div className={styles.aboutMeta}>
                {/* who's involved: partners and people. Chips at rest; the ghost "+"
                    reveals the small add-form on demand (roles kept here, where the
                    free-text function is actually edited — the rail shows type-coloured
                    pills) */}
                <div className={styles.detailsSection}>
                  <span className={styles.depsLabel}>{t(locale, 'partnersLabel')}</span>
                  <span className={styles.chipCell}>
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
                  {addOpen === 'partner' ? (
                    <form action={async (fd) => { await addPhasePartner(fd); setAddOpen(null); }}
                      className={styles.addInlineForm}>
                      <input type="hidden" name="phaseId" value={p.id} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <select name="partnerId" className={styles.quietSelect} defaultValue="" required autoFocus
                        aria-label={t(locale, 'partnerToInvolve')}>
                        <option value="" disabled>{t(locale, 'addPartner')}</option>
                        {availablePartners.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <input name="role" className={styles.roleInput} placeholder={t(locale, 'role')}
                        aria-label={t(locale, 'roleOptional')} />
                      <button type="submit" className={styles.miniBtn}>{t(locale, 'add')}</button>
                      <button type="button" className={styles.chipRemove} onClick={() => setAddOpen(null)}
                        aria-label={t(locale, 'cancel')} title={t(locale, 'cancel')}>✕</button>
                    </form>
                  ) : availablePartners.length > 0 ? (
                    <button type="button" className={styles.addReveal} onClick={() => setAddOpen('partner')}
                      title={t(locale, 'partnerToInvolve')} aria-label={t(locale, 'partnerToInvolve')}>+</button>
                  ) : p.partners.length === 0 ? (
                    // never leave the section affordance-less: say WHY there's nothing to add
                    <span className={styles.depNone}>{t(locale, 'allPartnersInvolved')}</span>
                  ) : null}
                  </span>
                </div>

                <div className={styles.detailsSection}>
                  <span className={styles.depsLabel}>{t(locale, 'peopleLabel')}</span>
                  <span className={styles.chipCell}>
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
                  {addOpen === 'person' ? (
                    <form action={async (fd) => { await addPhasePerson(fd); setAddOpen(null); }}
                      className={styles.addInlineForm}>
                      <input type="hidden" name="phaseId" value={p.id} />
                      <input type="hidden" name="projectId" value={projectId} />
                      <select name="personId" className={styles.quietSelect} defaultValue="" required autoFocus
                        aria-label={t(locale, 'personToInvolve')}>
                        <option value="" disabled>{t(locale, 'addPerson')}</option>
                        {availablePeople.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                      </select>
                      <input name="role" className={styles.roleInput} placeholder={t(locale, 'role')}
                        aria-label={t(locale, 'roleOptional')} />
                      <button type="submit" className={styles.miniBtn}>{t(locale, 'add')}</button>
                      <button type="button" className={styles.chipRemove} onClick={() => setAddOpen(null)}
                        aria-label={t(locale, 'cancel')} title={t(locale, 'cancel')}>✕</button>
                    </form>
                  ) : availablePeople.length > 0 ? (
                    <button type="button" className={styles.addReveal} onClick={() => setAddOpen('person')}
                      title={t(locale, 'personToInvolve')} aria-label={t(locale, 'personToInvolve')}>+</button>
                  ) : p.people.length === 0 ? (
                    // never leave the section affordance-less: say WHY there's nothing to add
                    <span className={styles.depNone}>{t(locale, 'allPeopleInvolved')}</span>
                  ) : null}
                  </span>
                </div>

                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  })();

  return (
    <div className={styles.wrapper}>
      {/* Title + ⋯ actions: bulk expand/hide and the door to the phase editor live
          here, off the rail — the rail itself stays read-only reporting. */}
      <div className={styles.trackHead}>
        <h2 className={styles.trackTitle}>{t(locale, 'phasesCard')}</h2>
        <button type="button" className={styles.infoBtn} title={t(locale, 'phaseKeyTitle')}
          aria-label={t(locale, 'phaseKeyTitle')} onClick={() => legendRef.current?.showModal()}>
          <svg viewBox="0 0 16 16" width={15} height={15} aria-hidden>
            <circle cx={8} cy={8} r={6.6} fill="none" stroke="currentColor" strokeWidth={1.4} />
            <circle cx={8} cy={5} r={1} fill="currentColor" />
            <line x1={8} y1={7.4} x2={8} y2={11.2} stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
          </svg>
        </button>
        <div className={styles.menuWrap} ref={menuRef}>
          <button type="button" className={styles.menuBtn} aria-haspopup="menu" aria-expanded={menuOpen}
            aria-label={t(locale, 'phaseActions')} title={t(locale, 'phaseActions')}
            onClick={() => setMenuOpen((o) => !o)}>
            <svg viewBox="0 0 18 18" width={18} height={18} aria-hidden>
              <circle cx={9} cy={3.5} r={1.8} fill="currentColor" />
              <circle cx={9} cy={9} r={1.8} fill="currentColor" />
              <circle cx={9} cy={14.5} r={1.8} fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <div className={styles.menu} role="menu">
              <button type="button" role="menuitem" className={styles.menuItem} onClick={() => setAll(false)}>
                {t(locale, 'expandAll')}
              </button>
              <button type="button" role="menuitem" className={styles.menuItem} onClick={() => setAll(true)}>
                {t(locale, 'collapseAll')}
              </button>
              <Link href={`/programs/${projectId}/phases`} role="menuitem" className={styles.menuItem}
                onClick={() => setMenuOpen(false)}>
                {t(locale, 'editPhases')}
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Summary hill first: every phase as a dot on one wide hill — the at-a-glance
          progress read before the rail's structural detail. Dots deeplink to rows via
          JUMP_PHASE_EVENT, which this component already listens for. */}
      {phases.length > 0 && (
        <div className={styles.hillSummary}>
          <PhaseHillChart wide phases={phases.map((p) => ({ id: p.id, name: p.name, progress: p.progress }))} />
        </div>
      )}

      {/* No chain summary up top — the chain is already the rail's heavy track, and the
          constraint card carries the evidence line. A second rendering said it twice. */}

      {/* Problems & notices: structural DAG issues only. The owner's
          cross-program load moved to the Critical Chain next-steps list
          (2026-07-20) so every resource-contention recommendation reads in one
          place instead of two. */}
      {structureIssues.length > 0 && (
        <ul className={styles.notices}>
          {structureIssues.map((msg, i) => (
            <li key={`st${i}`} className={styles.resourceLine}>
              <span className={styles.resourceLabel}>{t(locale, 'structureLabel')}</span>
              {msg}
            </li>
          ))}
        </ul>
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
                  stroke={e.done ? INK : 'var(--border)'} strokeWidth={e.onChain ? 3.5 : 2} strokeLinecap="round" />
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
                <path d={d} fill="none" stroke={e.done ? INK : 'var(--border)'} strokeWidth={e.onChain ? 3.5 : 1.8}
                  strokeLinecap="round" pathLength={100} className={styles.hoverable} />
                <title>{edgeTitle(e)}</title>
              </g>
            );
          })}
          {ordered.map((p) =>
            geom.ys[p.id] == null ? null : (
              <Station key={p.id} x={mainX} y={geom.ys[p.id]} progress={p.progress}
                started={isPhaseActive(p.progress, p.startedAt)}
                onChain={onChainSet.has(p.id)} isConstraint={chain.constraintId === p.id}
                title={`${p.name} — ${status(statusProgress(p.progress, p.startedAt))}`} onClick={() => jumpTo(p.id)} />
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
                  title={status(statusProgress(p.progress, p.startedAt))}
                  style={!open && p.progress >= 100 ? { color: 'var(--muted)' } : undefined}>
                  {p.name}
                </a>
                {p.description && <span className={styles.goalLine} title={goalExcerpt(p.description)}>{goalExcerpt(p.description)}</span>}
                <span className={styles.headRight}>
                  <span className={styles.plan}>{planWords(p)}</span>
                  {paceChip(p)}
                  {/* Details stays reachable even collapsed — rows default closed now */}
                  <button type="button" className={styles.iconBtn} onClick={() => openDetails(p)}
                    title={t(locale, 'details')} aria-label={t(locale, 'details')}>
                    <svg viewBox="0 0 14 14" width={13} height={13} aria-hidden>
                      <path d="M2 5 V2 H5 M9 2 H12 V5 M12 9 V12 H9 M5 12 H2 V9"
                        fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
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
                    <MiniHill progress={p.progress} previousProgress={p.previousProgress} />
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
      </div>

      {/* the key lives behind the ⓘ, not on the page (design.md §7: few titles,
          less chrome) — the rail should be read, the key consulted */}
      <dialog ref={legendRef} className={styles.legendDialog}
        onClick={(e) => { if (e.target === legendRef.current) legendRef.current?.close(); }}>
        <h3 className={styles.legendTitle}>{t(locale, 'phaseKeyTitle')}</h3>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 14 14" className={styles.legendGlyph}><circle cx={7} cy={7} r={5} fill={INK} /></svg>
          {status(100)}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 14 14" className={styles.legendGlyph}>
            <circle cx={7} cy={7} r={5} fill="var(--paper)" stroke={INK} strokeWidth={1.5} />
            <path d="M 7 2.6 A 4.4 4.4 0 0 1 7 11.4 Z" fill={INK} />
          </svg>
          {status(50)}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 14 14" className={styles.legendGlyph}><circle cx={7} cy={7} r={5} fill="var(--paper)" stroke={INK} strokeWidth={1.5} /></svg>
          {status(0)}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 18 18" className={styles.legendGlyph}>
            <circle cx={9} cy={9} r={7.5} fill="none" stroke="var(--chain)" strokeWidth={1.8} />
            <circle cx={9} cy={9} r={4} fill="var(--paper)" stroke={INK} strokeWidth={1.5} />
            <path d="M 9 5.4 A 3.6 3.6 0 0 1 9 12.6 Z" fill={INK} />
          </svg>
          {t(locale, 'legendConstraint')}
        </div>
        <div className={styles.legendRow}>
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide}>
            <path d="M 2 12 L 2 5 Q 2 2 5 2 L 17 2 Q 20 2 20 5 L 20 12" fill="none" stroke="var(--muted)" strokeWidth={1.6} />
          </svg>
          {t(locale, 'legendBypass')}
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatch} />
          {t(locale, 'legendTrack')}
        </div>
      </dialog>

      {detailsOverlay}
    </div>
  );
}
