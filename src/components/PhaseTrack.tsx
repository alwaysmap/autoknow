'use client';

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import Markdown from './Markdown';
import MarkdownNoteEditor from './MarkdownNoteEditor';
import { computeCriticalChain } from '../lib/criticalChain';
import {
  stationOrder, bundleEdges, focusSubgraph, isBypass,
  type Edge, type Bundle, type BundleTie,
} from '../lib/phaseTrackLayout';
import PhaseHillChart from './PhaseHillChart';
import { deriveEndPhase } from '../lib/programDag';
import { validateTemplateDag } from '../lib/templateDag';
import { HILL_PATH, hillCoordinates } from '../lib/geometry';
import { t, statusKey, Locale } from '../lib/i18n';
import { isPhaseActive, statusProgress, phaseColor, phaseDetailHash, parsePhaseDetailHash } from '../lib/phase';
import AnchorHeading from './AnchorHeading';
import ConstraintRing from './ConstraintRing';
import HillHistoryList from './HillHistoryList';
import type { HillChange } from '../lib/history';
import { updatePhaseHill, setPhaseStarted, getPhaseLog, type PhaseLogEntry } from '../app/actions/hill';
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
// Bypasses that share an endpoint ride ONE bundled branch line (lib/phaseTrackLayout):
// a trunk in a single lane with a short tie into the main line at every phase on it.
// The alternative — one lane per dependency — put NINE parallel tracks down the
// gutter of a 15-phase program: accurate, and useless. Bundling drops that to three
// while removing no relationship and inventing none (a phase is on the branch iff it
// has a tie). Rejected on the way there: hiding low-value edges (a missing line is a
// lie in this grammar), and collapsing a fan behind an "N dependencies" disclosure
// (it hides the structure at exactly the moment the reader is asking about it).
//
// FOCUS answers "what does THIS phase depend on, and what waits on it": clicking a
// station — or the phase's name, which is the keyboard path to the same thing —
// traces its ancestors, descendants and only the edges on a path through it, and
// dims everything else. Dimming (plus one quiet surface tint on the selected row) is
// the whole treatment: weight already means "on the critical chain" and the chain
// purple already means "the constraint", so the highlight had to take a free channel.
// Escape or the Clear affordance on the tracing line is the way out.
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
// third inline density. That popover is a phase's ONLY home: the standalone
// /history/phase/:id page was retired 2026-07-21, so the popover is itself a URL
// (`#phase-:id-detail`, lib/phase) and carries the COMPLETE log, not an excerpt.
// STRUCTURE is not editable here: phases and dependencies are added/removed only in
// the program phase editor (/programs/[id]/phases), which validates the whole DAG —
// so the rail can never produce a broken program.
// All strings via lib/i18n (en / de / ja / ko).

export interface PhaseActivity {
  id: number;
  description: string;
  nextStep: string; // "Undecided" | "Resolved" | "Partner" | "Googler"
  assignedTo: string | null;
  linkUrl: string | null;
}

// One hill update in a phase's log. Defined by the action that reads them
// (app/actions/hill) so the popover's on-demand full log and the page's preloaded
// excerpt can never drift into two shapes.
export type PhaseHistoryEntry = PhaseLogEntry;

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

// The open popover IS a URL — the same rule the needle's log follows (design.md
// §4b). Opening writes `#phase-:id-detail`, closing takes it back off, and arriving
// with it opens that phase. replaceState, never push: the popover is a mode of this
// page, and a trail of entries would make Back mean "close the thing I already
// closed". Fragments that aren't ours (the rail's own `#phase-:id` row anchors) are
// left exactly as they are.
const writeHash = (id: number | null) => {
  const current = window.location.hash;
  if (id == null) {
    if (parsePhaseDetailHash(current) == null) return;
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    return;
  }
  const want = `#${phaseDetailHash(id)}`;
  if (current !== want) window.history.replaceState(null, '', want);
};

// Ink rides the theme token — a hardcoded dark gray vanishes on the dark paper.
const RAIL_PAD = 10, LANE_W = 20, INK = 'var(--fg)';
// The traced track's backing band — wide enough to read as a band UNDER the line
// rather than a halo around it (the hill chart backs its 2.5px line the same way).
// Its caps are BUTT everywhere: a round cap on a 9px band overshoots the 3.5px ink
// it backs by ~2.75px, and that overshoot is what showed as a coloured nub sticking
// out of every corner. Butt ends exactly where its path does, so neighbouring
// stretches meet flush instead of poking past each other.
const BACKING_W = 9;
// Hop-over geometry: half-width of the bridge and how far it rises. Sized to clear
// the 3.5px track it crosses AND to stay legible under the 9px band that may be
// riding the same path.
const HOP_R = 5, HOP_RISE = 9;
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
// started. Heavier ink for critical-chain stations; the shared ConstraintRing marks
// the constraint. Hover for the name+status; click traces the phase's dependencies.
function Station({ x, y, progress, started, onChain, isConstraint, title, dimmed, onClick }: {
  x: number; y: number; progress: number; started?: boolean; onChain: boolean; isConstraint: boolean;
  title: string; dimmed?: boolean; onClick?: () => void;
}) {
  const r = onChain ? 6 : 5;
  const stroke = onChain ? INK : 'var(--muted)';
  return (
    <g onClick={onClick} className={`${styles.station} ${dimmed ? styles.dim : ''}`.trim()}>
      {/* The dot is 10px across and it is now a control (click to trace), so it
          carries a 24px transparent target — the drawn symbol stays the same size,
          the thing you can hit does not. `transparent` is a paint, so SVG's
          visiblePainted hit-testing still captures it. */}
      <circle cx={x} cy={y} r={12} fill="transparent" />
      {/* interchange-station treatment: the ring's interior is opaque so the
          track visibly terminates at the station instead of passing through */}
      {isConstraint && <ConstraintRing cx={x} cy={y} r={r} opaque />}
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

  // FOCUS: one phase at a time, traced through the whole graph. A persistent
  // selection rather than hover — hover cannot be reached from a keyboard, and a
  // structure you have to keep the pointer still to read is not one you can study.
  // It is resolved BEFORE the bundling because it changes it: traced dependencies
  // are bundled apart from untraced ones so no line carries both (phaseTrackLayout).
  const [focusId, setFocusId] = useState<number | null>(null);
  const focus = focusSubgraph(ordered, focusId);
  const focused = focusId != null ? byId.get(focusId) : null;
  const toggleFocus = (id: number) => setFocusId((cur) => (cur === id ? null : id));

  const { mainline, bundles, laneCount, restingLaneCount } = bundleEdges(ordered, chain.edgeKeys, focus);
  // The gutter is sized by the RESTING lane count and never moves: it is the rows'
  // left padding, so a wider one re-wraps row text and the whole list jumps under the
  // pointer the moment you click a phase. Extra lanes a trace needs are fitted into
  // the same width at a finer pitch — the rail gets denser, never wider. (Measured:
  // three of the fifteen phases on Ford Evos changed row heights before this.)
  const mainX = RAIL_PAD + restingLaneCount * LANE_W + 6;
  // +28, not +16: the extra 12px is breathing room between the station marker and
  // the card content, so a phase doesn't butt right up against its own dot.
  const gutterW = mainX + 28;
  const lanePitch = laneCount > 0
    ? Math.min(LANE_W, (restingLaneCount * LANE_W) / laneCount)
    : LANE_W;
  const laneX = (lane: number) => mainX - lane * lanePitch;

  const status = (p: number) => t(locale, statusKey(p));
  const skippedNames = (e: Edge) => ordered.slice(e.fromIdx + 1, e.toIdx).map((s) => s.name).join(', ');
  // The "skips" clause is dropped while tracing: it enumerates the stations a line
  // flies OVER, which during a trace are mostly ghosted, and a lit line whose label
  // lists faded phases is exactly the confusion this mode exists to remove. At rest
  // it is the useful half of the label and stays.
  const edgeTitle = (e: Edge) =>
    `${byId.get(e.from)?.name} → ${byId.get(e.to)?.name}` +
    (isBypass(e) && !focus ? ` · ${t(locale, 'skips', { names: skippedNames(e) })}` : '');
  // The hub tie carries the whole bundle: name every phase on the branch, so the
  // merged line can be read back out to the dependencies it stands for. Because a
  // bundle is never mixed, a LIT stem can only ever name phases that are lit too.
  const tieTitle = (b: Bundle, tie: BundleTie) => {
    if (tie.edges.length === 1) return edgeTitle(tie.edges[0]);
    const hub = byId.get(b.hubId)?.name ?? '';
    const others = tie.edges.map((e) => byId.get(b.kind === 'out' ? e.to : e.from)?.name).join(' · ');
    return b.kind === 'out' ? `${hub} → ${others}` : `${others} → ${hub}`;
  };

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
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  const [detailsId, setDetailsId] = useState<number | null>(null);

  // FOUR levels while tracing, all on the one recession channel (PhaseTrack.module.css):
  // the phase itself, what WAITS on it at full strength, what it waits FOR at half,
  // and everything else a ghost. Splitting the two directions is what gives a trace on
  // a spine phase anything to say — everything is on a path through those, so a
  // near/far scale dimmed nothing and the click read as "nothing happened".
  // Off the mode, everything reads at full strength.
  const relOf = (id: number): 'self' | 'up' | 'down' | 'far' | undefined =>
    !focus ? undefined
      : id === focus.id ? 'self'
      : focus.upstream.has(id) ? 'up'
      : focus.downstream.has(id) ? 'down'
      : 'far';
  const dimNode = (id: number) => !!focus && !focus.nodes.has(id);
  const onPath = (e: Edge) => !!focus && focus.edgeKeys.has(`${e.from}-${e.to}`);
  const dimEdge = (e: Edge) => !!focus && !onPath(e);
  // A stretch of shared trunk takes its level from its riders. Since the bundling is
  // partitioned by the trace, riders are either ALL on the path or ALL off it, so
  // "any rider is traced" and "every rider is traced" now agree — a stem can no
  // longer light on behalf of dependencies that are not on the path.
  const dimEdges = (es: Edge[]) => !!focus && es.length > 0 && es.every(dimEdge);
  const inkClass = (es: Edge[]): string | undefined =>
    !focus ? undefined : dimEdges(es) ? styles.dim : undefined;

  // DIRECTION rides the TRACK, as a solid band laid UNDER the ink — the way the hill
  // chart backs its line. It paints the phase's DIRECT neighbourhood only: what it
  // waits for, and what waits on it.
  //
  // Painting the transitive closure was the mistake. On a converging plan the
  // closure is nearly the whole diagram — tracing a mid-chain phase lit 14 of 15 —
  // so the ink scaled with reachability, which is not information, instead of with
  // the structure, which is. 11 of those 15 phases have exactly one edge in and one
  // out; the fan points top out at 8. So the neighbourhood is small at any program
  // size, and it is the thing a reader can act on: these must finish before I can
  // start, and these unblock the moment I do. The FULL reach stays on the tracing
  // line in words, where a count belongs.
  const backingOf = (es: Edge[]): string | undefined => {
    if (!focus || es.length === 0) return undefined;
    const live = es.filter((e) => focus.directKeys.has(`${e.from}-${e.to}`));
    if (live.length === 0) return undefined;
    // An edge ENDING at the phase is something it waits for; one LEAVING it is
    // something waiting on it. A stretch carrying both gets no band rather than a
    // guessed one — silence beats a confident wrong answer.
    const up = live.every((e) => e.to === focus.id);
    const down = live.every((e) => e.from === focus.id);
    return up ? 'var(--trace-up-band)' : down ? 'var(--trace-down-band)' : undefined;
  };

  const closeDetails = useCallback(() => { setDetailsId(null); writeHash(null); }, []);

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
  // "Collapse the diagram" is one state, not two: every card at min AND the track
  // ink put away, leaving the stations as a plain list. Collapsing only the cards
  // left the densest thing on screen — the tracks — untouched, which is why the
  // bulk item read as doing nothing on a rail that already opens collapsed.
  const [tracksHidden, setTracksHidden] = useState(false);
  const setAll = (collapse: boolean) => {
    setCollapsed(Object.fromEntries(phases.map((p) => [p.id, collapse])));
    setTracksHidden(collapse);
    setMenuOpen(false);
  };
  /** How many cards are at standard size — with the tracks, this is what the bulk
   *  items act on, so each can tell whether it still has anything to do. */
  const openCount = phases.filter((p) => !isCollapsed(p)).length;
  const fullyExpanded = openCount === phases.length && !tracksHidden;
  const fullyCollapsed = openCount === 0 && tracksHidden;

  // Jump-and-flash (station clicks, chain links, dependency chips).
  const [flashId, setFlashId] = useState<number | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jumpTo = useCallback((id: number) => {
    closeDetails();
    setCollapsed((s) => ({ ...s, [id]: false }));
    // Align the phase head to the TOP of the scrollport (it clears the sticky nav via
    // html { scroll-padding-top }), matching the row's `#phase-N` anchor so the two
    // scrolls this click fires agree instead of fighting (one to top, one to centre).
    headRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setFlashId(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashId(null), 1400);
  }, [closeDetails]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  // Deeplinks from the dashboard's hill chart: a dot click jump-and-flashes here.
  useEffect(() => {
    const onJump = (e: Event) => {
      const id = (e as CustomEvent<number>).detail;
      if (phases.some((p) => p.id === id)) jumpTo(id);
    };
    window.addEventListener('autoknow:jump-phase', onJump);
    return () => window.removeEventListener('autoknow:jump-phase', onJump);
  }, [phases, jumpTo]);

  // Esc closes the focused popover — the scrim is the other way out.
  useEffect(() => {
    if (detailsId == null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDetails(); };
    window.addEventListener('keydown', onKey);
    // A modal owns the viewport: the page behind must not scroll under the scrim.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [detailsId, closeDetails]);

  // Esc leaves the traced mode too — but only once the popover has taken its turn,
  // so one key never closes two things at once.
  useEffect(() => {
    if (focusId == null || detailsId != null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocusId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focusId, detailsId]);

  // Station y-centers are measured from the DOM so the track follows real row heights.
  // The measurement anchors on the phase NAME, not the header box: on a phone the
  // header wraps to three lines and its centre lands two lines below the name, which
  // slides every station off the row it belongs to. The head ref stays — it is what
  // `jumpTo` scrolls to.
  const containerRef = useRef<HTMLDivElement>(null);
  const headRefs = useRef(new Map<number, HTMLDivElement>());
  const nameRefs = useRef(new Map<number, HTMLAnchorElement>());
  const [geom, setGeom] = useState<{ ys: Record<number, number>; h: number }>({ ys: {}, h: 0 });

  const measure = () => {
    const c = containerRef.current;
    if (!c) return;
    const cTop = c.getBoundingClientRect().top;
    const ys: Record<number, number> = {};
    headRefs.current.forEach((head, id) => {
      const el = nameRefs.current.get(id) ?? head;
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

  // A bundled branch line: out of the main line at the top, down an outer lane, back
  // in at the bottom, with a plain tie at every phase in between. Tube-map grammar —
  // 90° jogs with small radii, no curves. The corner radius is clamped positive: a
  // degenerate span must degrade to a tight jog, never a negative radius (which
  // renders as a giant off-panel arc — the old branch-then-rejoin bug). A bundle of
  // one draws exactly the single bypass loop it always did.
  // The radius is clamped by the lane PITCH as well as the vertical gap: at a trace's
  // finer pitch an unclamped corner would start its arc past the main line and the
  // jog would double back on itself.
  const corner = (yA: number, yB: number) =>
    Math.max(2, Math.min(7, lanePitch - 3, Math.abs(yB - yA) / 2 - 2));
  // ---- crossings ----
  // A tube map has no unexplained crossings and neither does a circuit diagram: where
  // one line must pass another it says so with a hop. Here the only crossing kind is
  // a branch's horizontal tie running out to its own lane ACROSS some other branch's
  // trunk. Those get the hop; the line that hops is the one going over.
  const trunkSpans = bundles.map((b) => {
    const ys = b.ties.map((tie) => geom.ys[tie.phaseId]);
    if (ys.some((y) => y == null)) return null;
    const last = ys.length - 1;
    return {
      key: b.key,
      x: laneX(b.lane),
      y0: ys[0]! + corner(ys[0], ys[1]),
      y1: ys[last]! - corner(ys[last - 1], ys[last]),
    };
  }).filter((t): t is { key: string; x: number; y0: number; y1: number } => t !== null);

  /** Lane x-positions a horizontal run at `y` crosses, in the order it meets them. */
  const hopsBetween = (xA: number, xB: number, y: number, ownKey: string) => {
    const lo = Math.min(xA, xB), hi = Math.max(xA, xB);
    const xs = trunkSpans
      .filter((t) => t.key !== ownKey && t.x > lo + 1 && t.x < hi - 1 && y > t.y0 + 1 && y < t.y1 - 1)
      .map((t) => t.x);
    return xB < xA ? xs.sort((a, b) => b - a) : xs.sort((a, b) => a - b);
  };

  /** A horizontal run that arcs OVER each track it crosses instead of through it. */
  const runX = (fromX: number, toX: number, y: number, hops: number[]) => {
    const dir = toX > fromX ? 1 : -1;
    let d = '';
    for (const x of hops) {
      d += ` L ${x - dir * HOP_R} ${y} Q ${x} ${y - HOP_RISE} ${x + dir * HOP_R} ${y}`;
    }
    return `${d} L ${toX} ${y}`;
  };

  const tiePath = (bx: number, y: number, r: number, at: 'top' | 'bottom' | 'mid', key: string) => {
    if (at === 'top') {
      return `M ${mainX} ${y}${runX(mainX, bx + r, y, hopsBetween(mainX, bx + r, y, key))} Q ${bx} ${y} ${bx} ${y + r}`;
    }
    if (at === 'bottom') {
      return `M ${bx} ${y - r} Q ${bx} ${y} ${bx + r} ${y}${runX(bx + r, mainX, y, hopsBetween(bx + r, mainX, y, key))}`;
    }
    return `M ${mainX} ${y}${runX(mainX, bx, y, hopsBetween(mainX, bx, y, key))}`;
  };

  // THE CARD IS THE CONTROL. A phase reads as one object — title, goal, plan, hill,
  // note, involvement — even though it is a dozen elements, so a click anywhere on it
  // does the single thing that object means: pick this phase. That one gesture now
  // covers what took a chevron, a station click and a separate selection:
  //   size    min ↔ standard, so the click that selects also opens what you selected
  //   trace   its upstream/downstream highlight comes up with it
  //   focus   selection is single, so picking this one drops the last one
  //   place   it ends up whole on screen rather than half under the sticky nav
  const activateCard = (p: PhaseTrackRow) => {
    setFocusId(p.id);
    setCollapsed((s) => ({ ...s, [p.id]: !isCollapsed(p) }));
    // AFTER the commit: expanding changes the card's height, and measuring first
    // would scroll to the box it used to have. Two frames — one for React to paint
    // the new size, one for layout to settle on it.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const node = rowRefs.current.get(p.id);
      if (!node) return;
      // Move the page ONLY when the card is not already whole on screen. Scrolling
      // on every click reads as the page yanking itself around under a plain
      // selection — the motion has to be the exception that rescues a half-visible
      // card, not the rule. The threshold is the scroll padding itself, resolved to
      // px by the computed style, so "clear of the sticky nav" means exactly what it
      // means to the scroll that follows.
      const clearance = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
      const box = node.getBoundingClientRect();
      if (box.top >= clearance && box.bottom <= window.innerHeight) return;
      // `block: 'start'` honours html { scroll-padding-top } and matches the card's
      // own `#phase-N` anchor, so the deep link and this scroll agree.
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }));
  };

  // Everything interactive inside the card keeps its own job — pills navigate, the
  // zoom button opens the popover. The TITLE is the exception: it is the card's own
  // name, so it deep-links AND activates, which is also the keyboard path in.
  const onCardClick = (p: PhaseTrackRow) => (e: React.MouseEvent) => {
    const hit = (e.target as HTMLElement).closest('a, button, input, select, textarea, form');
    if (hit && !hit.hasAttribute('data-card-title')) return;
    activateCard(p);
  };


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
  // The page preloads only the 6 newest updates per phase (a dozen phases render at
  // once and the log is append-only), but this popover is a phase's whole record, so
  // it pulls the rest for the ONE phase that was opened. The preloaded excerpt shows
  // instantly and the older updates land under it; a failed fetch leaves the excerpt
  // standing rather than emptying the pane.
  const [fullLog, setFullLog] = useState<{ phaseId: number; entries: PhaseHistoryEntry[] } | null>(null);
  const loadLog = async (phaseId: number) => {
    try { setFullLog({ phaseId, entries: await getPhaseLog(phaseId) }); }
    catch (err) { console.error(err); }
  };
  const openDetails = (p: PhaseTrackRow) => {
    setDrag(p.progress); setNoteError(false); setAddOpen(null); setEditing(false);
    if (startedTimer.current) clearTimeout(startedTimer.current);
    setStartedSave(null);
    setFullLog(null);
    setDetailsId(p.id);
    writeHash(p.id);
    void loadLog(p.id);
  };

  // Arriving at /programs/:id#phase-:phaseId-detail opens that phase's popover, so a
  // link anywhere in the app (feeds, briefings, partner and person pages) lands on the
  // record itself. Re-runs when `phases` changes identity after a revalidate; the
  // already-open guard keeps that from resetting a pane someone is working in.
  const detailsIdRef = useRef<number | null>(null);
  useEffect(() => { detailsIdRef.current = detailsId; }, [detailsId]);
  useEffect(() => {
    const openFromHash = () => {
      const id = parsePhaseDetailHash(window.location.hash);
      if (id == null || id === detailsIdRef.current) return;
      const target = byId.get(id);
      if (target) openDetails(target);
    };
    openFromHash();
    window.addEventListener('hashchange', openFromHash);
    return () => window.removeEventListener('hashchange', openFromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phases]);
  const startedRef = useRef<HTMLInputElement>(null);
  // Commit (or clear) the explicit "work started on" date — shared by the date picker
  // and the drag-to-Not-Started gesture. An empty value nulls the start (nullable).
  const commitStarted = async (value: string) => {
    if (!details) return;
    const fd = new FormData();
    fd.set('phaseId', String(details.id));
    fd.set('projectId', String(projectId));
    fd.set('startedOn', value);
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
  };
  // Dragging the dot to the far-left "Not Started" position clears the start date, so a
  // retract is one gesture. No-ops once the field is already empty, so a drag that
  // dwells at 0 commits the clear only once.
  const clearStarted = () => {
    const el = startedRef.current;
    if (!el || !el.value) return;
    el.value = '';
    void commitStarted('');
  };
  const fromX = (clientX: number) => {
    if (!updateSvgRef.current) return;
    const r = updateSvgRef.current.getBoundingClientRect();
    const xv = ((clientX - r.left) / r.width) * 200;
    const next = Math.round(Math.max(0, Math.min(100, ((xv - 10) / 180) * 100)));
    setDrag(next);
    if (next === 0) clearStarted();
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
    // The complete log once it arrives, the page's preloaded 6 until then.
    const log = fullLog?.phaseId === p.id ? fullLog.entries : p.history;

    return (
      <div className={styles.scrim} role="presentation" onClick={closeDetails}>
        <div
          className={styles.popover}
          role="dialog"
          aria-modal="true"
          aria-label={p.name}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className={styles.popClose} onClick={closeDetails}
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
              // noValidate: the "Work started on" date input auto-commits on its own
              // (setPhaseStarted) and never rides this submit, but a half-cleared date
              // left it :invalid and the browser blocked Save — including a drag back
              // to Not Started. The note is validated in JS below, so native
              // constraint validation has nothing else to enforce here.
              noValidate
              action={async (fd) => {
                if (!((fd.get('notes') as string) || '').trim()) { setNoteError(true); return; }
                setNoteError(false);
                setSubmitting(true);
                // The saved update has to join the log the popover is showing —
                // revalidatePath refreshes the page's preloaded excerpt, not the
                // full log this pane fetched for itself.
                try { await updatePhaseHill(fd); setEditing(false); await loadLog(p.id); }
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
                  ref={startedRef}
                  type="date"
                  className={styles.startedInput}
                  defaultValue={p.startedAt ? p.startedAt.slice(0, 10) : ''}
                  disabled={submitting}
                  onChange={(e) => commitStarted(e.target.value)}
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
                      so both light and dark paper keep the contrast. The trail is
                      RECENT movement, so it stays capped at five ghosts however long
                      the log below it runs. */}
                  {log.slice(1, 6).map((h, i) => {
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
                    // (keyboard/E2E path to the same dot) — 0 clears the start too
                    value={drag}
                    onChange={(e) => { const v = parseInt(e.target.value); setDrag(v); if (v === 0) clearStarted(); }}
                    style={{ position: 'absolute', left: '-624.9375rem', width: 10, height: 10, opacity: 0.01 }}
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
                note, status + date · author above it — and EVERY older update
                follows as a compact card. This list is the phase's complete
                record; there is nowhere further to click through to. */}
            {!editing && (
              <div className={styles.storyView}>
                {log.length > 0 ? (
                  <div className={styles.latestUpdate}>
                    <div className={styles.latestMeta}>
                      <span className={styles.latestStatus} style={{ color: phaseColor(p.id) }}>
                        {status(log[0].progress)}
                      </span>
                      <span className={styles.latestWhen}>
                        {fmtDate(log[0].at)}
                        {log[0].by ? ` · ${log[0].by}` : ''}
                      </span>
                    </div>
                    {log[0].note
                      ? <div className={styles.latestNote}><Markdown>{log[0].note}</Markdown></div>
                      : <div className={styles.noteEmpty}>{t(locale, 'noNote')}</div>}
                  </div>
                ) : (
                  <div className={styles.noteEmpty}>{t(locale, 'noNote')}</div>
                )}
                {log.length > 1 && (
                  <div className={styles.historyList}>
                    <span className={styles.metaLabel}>{t(locale, 'history')}</span>
                    <HillHistoryList
                      compact
                      locale={locale}
                      color={phaseColor(p.id)}
                      changes={log.slice(1).map((h, i): HillChange => ({
                        timestamp: h.at,
                        progress: h.progress,
                        previousProgress: log[i + 2]?.progress ?? null,
                        notes: h.note,
                        source: h.by,
                      }))}
                    />
                  </div>
                )}
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
          here, off the rail — the rail itself stays read-only reporting.
          They ride INSIDE AnchorHeading via `actions`, never as siblings of it:
          the heading row ends in the graticule (a ::after), so a sibling lands
          after the rule — the affordances get flung to the far right, visually
          divorced from the title they act on, and the menu (left-anchored) then
          opens off the edge of the container. */}
      <AnchorHeading
        id="phases"
        linkLabel={t(locale, 'anchorLink')}
        actions={
          <>
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
                  {/* Each of these is disabled when it would do nothing. Rows default
                      to collapsed, so on a fresh page "Hide all" was a live-looking
                      item that changed not one pixel — and an affordance that does
                      nothing when you click it does not read as "already done", it
                      reads as broken. */}
                  <button type="button" role="menuitem" className={styles.menuItem}
                    disabled={fullyExpanded} onClick={() => setAll(false)}>
                    {t(locale, 'expandAll')}
                  </button>
                  <button type="button" role="menuitem" className={styles.menuItem}
                    disabled={fullyCollapsed} onClick={() => setAll(true)}>
                    {t(locale, 'collapseAll')}
                  </button>
                  <Link href={`/programs/${projectId}/phases`} role="menuitem" className={styles.menuItem}
                    onClick={() => setMenuOpen(false)}>
                    {t(locale, 'editPhases')}
                  </Link>
                </div>
              )}
            </div>
          </>
        }
      >
        {t(locale, 'phasesCard')}
      </AnchorHeading>

      {/* Summary hill first: every phase as a dot on one wide hill — the at-a-glance
          progress read before the rail's structural detail. Dots deeplink to rows via
          JUMP_PHASE_EVENT, which this component already listens for. */}
      {phases.length > 0 && (
        <div className={styles.hillSummary}>
          {/* statusProgress, not raw progress: a phase explicitly marked Active
              before its hill has moved is In Progress, and the rail directly below
              says so. Passing the raw 0 put it in the "Not Started" pile — the two
              views contradicting each other about the same phase, on one screen. */}
          <PhaseHillChart wide phases={phases.map((p) => ({
            id: p.id, name: p.name, progress: statusProgress(p.progress, p.startedAt),
          }))} />
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

      {/* Tracing line: the mode says its own name, counts what it found, and carries
          the way out. A selection you cannot see the edge of is a trap. */}
      {focus && focused && (
        <div className={styles.tracing} role="status">
          <span className={styles.tracingLabel}>{t(locale, 'tracingLabel')}</span>
          <span className={styles.tracingName}>{focused.name}</span>
          <span className={styles.tracingCounts}>
            {t(locale, 'tracingCounts', { u: focus.upstream.size, d: focus.downstream.size })}
          </span>
          <button type="button" className={styles.tracingClear} onClick={() => setFocusId(null)}>
            {t(locale, 'clearTrace')}
          </button>
        </div>
      )}

      {/* Collapsed, the rail has no connecting ink — and in this grammar a missing
          line MEANS "no relationship". So the state says itself, with the way back
          on the same line: absent ink is only honest while it is labelled absent. */}
      {tracksHidden && (
        <div className={styles.tracing} role="status">
          <span className={styles.tracingLabel}>{t(locale, 'tracksHidden')}</span>
          <button type="button" className={styles.tracingClear} onClick={() => setTracksHidden(false)}>
            {t(locale, 'showTracks')}
          </button>
        </div>
      )}

      <div ref={containerRef} className={styles.graph} style={{ paddingLeft: gutterW }}>
        {/* the track: dependency segments only — where adjacent stations share no
            dependency there is NO connector (a line would claim a false relation);
            bypass loops in outer lanes, stations on top */}
        <svg className={styles.rail} width={gutterW} height={Math.max(geom.h, 1)} aria-hidden>
          {/* Collapsed: stations only. The dependency ink is what makes a 15-phase
              program dense, so putting it away IS the collapse — and the stations
              stay, so the phases keep their place on the line. */}
          {!tracksHidden && mainline.map((e) => {
            const y1 = geom.ys[e.from], y2 = geom.ys[e.to];
            if (y1 == null || y2 == null) return null;
            return (
              <g key={`m${e.from}-${e.to}`} className={inkClass([e])}>
                {backingOf([e]) && (
                  <line x1={mainX} y1={y1} x2={mainX} y2={y2} className={styles.trackBacking}
                    stroke={backingOf([e])} strokeWidth={BACKING_W} strokeLinecap="butt" />
                )}
                <line x1={mainX} y1={y1} x2={mainX} y2={y2}
                  stroke={e.done ? INK : 'var(--border)'} strokeWidth={e.onChain ? 3.5 : 2} strokeLinecap="round" />
                <title>{edgeTitle(e)}</title>
              </g>
            );
          })}
          {/* ghosts first, traced routes last: the answer is never crossed by the
              context it was extracted from */}
          {!tracksHidden && [...bundles].sort((a, b) => Number(a.traced) - Number(b.traced)).map((b) => {
            const ys = b.ties.map((tie) => geom.ys[tie.phaseId]);
            if (ys.some((y) => y == null)) return null;
            const bx = laneX(b.lane);
            const last = ys.length - 1;
            const rTop = corner(ys[0], ys[1]);
            const rBot = corner(ys[last - 1], ys[last]);
            return (
              <g key={b.key}>
                {/* trunk, one stretch per gap between ties — each inks only when
                    every dependency riding that stretch has departed a done phase */}
                {b.segments.map((s, k) => {
                  const y1 = k === 0 ? ys[0]! + rTop : ys[k]!;
                  const y2 = k === last - 1 ? ys[last]! - rBot : ys[k + 1]!;
                  const back = backingOf(s.edges);
                  return (
                    <React.Fragment key={`s${k}`}>
                      {back && (
                        <line x1={bx} x2={bx} y1={y1} y2={y2} className={styles.trackBacking}
                          stroke={back} strokeWidth={BACKING_W} strokeLinecap="butt" />
                      )}
                      <line x1={bx} x2={bx} y1={y1} y2={y2}
                        stroke={s.done ? INK : 'var(--border)'} strokeWidth={s.onChain ? 3.5 : 1.8}
                        className={inkClass(s.edges)} />
                    </React.Fragment>
                  );
                })}
                {/* ties: the branch meeting the main line at each phase on it */}
                {b.ties.map((tie, k) => {
                  const d = tiePath(bx, ys[k]!, k === 0 ? rTop : rBot, k === 0 ? 'top' : k === last ? 'bottom' : 'mid', b.key);
                  const back = backingOf(tie.edges);
                  return (
                    <g key={tie.phaseId} className={inkClass(tie.edges)}>
                      {back && (
                        <path d={d} fill="none" stroke={back} strokeWidth={BACKING_W}
                          strokeLinecap="butt" strokeLinejoin="round" className={styles.trackBacking} />
                      )}
                      <path
                        d={d}
                        fill="none" stroke={tie.done ? INK : 'var(--border)'}
                        strokeWidth={tie.onChain ? 3.5 : 1.8} strokeLinecap="round"
                        className={styles.hoverable} />
                      <title>{tieTitle(b, tie)}</title>
                    </g>
                  );
                })}
              </g>
            );
          })}
          {ordered.map((p) =>
            geom.ys[p.id] == null ? null : (
              <Station key={p.id} x={mainX} y={geom.ys[p.id]} progress={p.progress}
                started={isPhaseActive(p.progress, p.startedAt)}
                onChain={onChainSet.has(p.id)} isConstraint={chain.constraintId === p.id}
                dimmed={dimNode(p.id)}
                title={`${p.name} — ${status(statusProgress(p.progress, p.startedAt))}`}
                onClick={() => toggleFocus(p.id)} />
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
              ref={(el) => { if (el) rowRefs.current.set(p.id, el); else rowRefs.current.delete(p.id); }}
              className={`${styles.row} ${flashId === p.id ? styles.flash : ''}`}
              data-rel={relOf(p.id)} data-testid="phase-row"
              onClick={onCardClick(p)}>
              <div
                ref={(el) => { if (el) headRefs.current.set(p.id, el); else headRefs.current.delete(p.id); }}
                className={styles.head}
              >
                {/* The card's own name: a real href so the section stays linkable and
                    copyable, and the keyboard route into everything the card click
                    does — aria-expanded because it is now what opens the card. */}
                <a href={`#phase-${p.id}`} className={styles.name} data-card-title
                  ref={(el) => { if (el) nameRefs.current.set(p.id, el); else nameRefs.current.delete(p.id); }}
                  aria-current={focusId === p.id ? 'true' : undefined}
                  aria-expanded={open}
                  title={`${status(statusProgress(p.progress, p.startedAt))} · ${t(locale, 'traceHint')}`}
                  style={!open && p.progress >= 100 ? { color: 'var(--muted)' } : undefined}>
                  {p.name}
                </a>
                {/* The head is name on the left, plan + zoom right-justified on the SAME
                    line (headRight is margin-left:auto). The goal excerpt used to ride
                    here; it is gone — the full Goal lives in the popover, and a clamped
                    half-sentence per row was noise between the two things that matter,
                    the name and the schedule. The zoom button shows only at standard
                    size, so min stays a single clean line. */}
                <span className={styles.headRight}>
                  <span className={styles.plan}>{planWords(p)}</span>
                  {paceChip(p)}
                  {/* The card's ONE affordance, and only at standard size — the step
                      the card cannot do itself: lift the phase into its focused
                      popover. Arrows breaking outward, because that is the promise:
                      bigger, not "more below". */}
                  {open && <button type="button" className={styles.iconBtn} onClick={() => openDetails(p)}
                    title={t(locale, 'details')} aria-label={t(locale, 'details')}>
                    <svg viewBox="0 0 14 14" width={13} height={13} aria-hidden>
                      <path d="M8.5 5.5 L12.5 1.5 M12.5 1.5 H9 M12.5 1.5 V5
                               M5.5 8.5 L1.5 12.5 M1.5 12.5 H5 M1.5 12.5 V9"
                        fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>}
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
          {/* The legend swatch is the SAME marker at the same proportions — a
              lighter-weight imitation here is how a legend starts lying. */}
          <svg viewBox="0 0 20 20" className={styles.legendGlyph} style={{ overflow: 'visible' }}>
            <ConstraintRing cx={10} cy={10} r={4} opaque />
            <circle cx={10} cy={10} r={4} fill="var(--paper)" stroke={INK} strokeWidth={1.5} />
            <path d="M 10 6.4 A 3.6 3.6 0 0 1 10 13.6 Z" fill={INK} />
          </svg>
          {t(locale, 'legendConstraint')}
        </div>
        <div className={styles.legendRow}>
          {/* the swatch is the drawing: a trunk leaving the main line, a tie at every
              phase riding it, and the rejoin — not a lighter-weight imitation */}
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide}>
            <path d="M 20 2 L 5 2 Q 2 2 2 5 L 2 9 Q 2 12 5 12 L 20 12"
              fill="none" stroke="var(--muted)" strokeWidth={1.6} />
            <path d="M 2 7 L 20 7" fill="none" stroke="var(--muted)" strokeWidth={1.6} />
          </svg>
          {t(locale, 'legendBypass')}
        </div>
        <div className={styles.legendRow}>
          <span className={styles.legendSwatch} />
          {t(locale, 'legendTrack')}
        </div>
        <div className={styles.legendRow}>
          {/* two stations on a line, one of them receding — the trace treatment itself */}
          <svg viewBox="0 0 22 14" className={styles.legendGlyphWide}>
            <line x1={5} y1={7} x2={17} y2={7} stroke={INK} strokeWidth={1.6} />
            <circle cx={5} cy={7} r={3.2} fill="var(--paper)" stroke={INK} strokeWidth={1.5} />
            <circle cx={17} cy={7} r={3.2} fill="var(--paper)" stroke="var(--muted)" strokeWidth={1.5}
              opacity={0.25} />
          </svg>
          {t(locale, 'legendTrace')}
        </div>
      </dialog>

      {detailsOverlay}
    </div>
  );
}
