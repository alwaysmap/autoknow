'use client';

import React, { createContext, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { COLLAPSED_SECTIONS, readLocalPref, subscribePrefChange, writeLocalPref, type SectionId } from '../lib/preferences';
import { subscribeLocationChange } from '../lib/locationHash';
import { useSteadyPageScroll } from '../lib/useSteadyPageScroll';
import { afterLayoutSettles } from '../lib/afterLayoutSettles';
import styles from './CollapsibleSection.module.css';

// THE collapse wrapper for a detail-page section (autoknow-hcz.15) — one primitive, not a
// per-section copy (AGENTS lesson 7). Wrap the page's `<section>` in this and the section
// becomes a disclosure: its AnchorHeading grows a chevron, the body folds away, and the
// choice persists per browser via the preferences registry (#31, COLLAPSED_SECTIONS).
//
// HOW THE PIECES FIND EACH OTHER. The heading often lives INSIDE the component this
// wraps (ChainLedger and PhaseTrack own their AnchorHeading rows, actions and all), so
// this cannot render the heading itself. Instead it provides SectionCollapseContext;
// AnchorHeading consumes it and renders the chevron — so every host keeps its own
// heading, actions and anchor id, and gains the affordance without a second heading
// grammar. The one contract: exactly ONE AnchorHeading anywhere under this wrapper
// (which §7's "few titles" already demands of a section) — the module CSS folds
// everything off that heading row's path, at whatever depth the host nests it, and a
// second heading in the body would anchor a second path and hold its wrappers open.
//
// COLLAPSED = CSS-HIDDEN, NOT UNMOUNTED — deliberately. Every anchor target inside the
// body (`#phase-7`, `#status-history`) stays in the DOM, so deep links still resolve and
// the expand-on-arrival below can find its target; unmounting would also discard host
// state (an open phase card, a loaded log) every time a reader toggles.
//
// ARRIVING BY URL EXPANDS. A fragment address is a promise the page scrolls there;
// landing on `#escalations` with escalations folded would keep that promise to a heading
// and break it for the content. So any navigation whose hash targets an element inside
// this section un-collapses it — persistently, because arriving at a section's address
// is as explicit a request to see it as the chevron is. For a target buried in the
// hidden BODY the browser's own jump found a box of zero size, so after expanding, the
// scroll is re-issued at the target once layout has it.
//
// Hydration: the server (and first client paint) renders every section open — the
// neutral-snapshot `useSyncExternalStore` pattern (ThemeToggle.tsx is the reference;
// setState-in-effect is a lint error here). A reader with stored collapses sees them
// applied at hydration, the same trade ROWS_PER_TABLE accepts; the #31 boot script only
// guards the appearance axes, and a pre-paint fold isn't worth a per-section inline
// script.

export interface SectionCollapse {
  collapsed: boolean;
  toggle: () => void;
  /** Un-collapse (idempotent). For hosts whose own jump targets live in the body —
   *  PhaseTrack expands before scrolling to a card the hill chart addressed. */
  expand: () => void;
}

export const SectionCollapseContext = createContext<SectionCollapse | null>(null);

function readCollapsed(sectionId: SectionId): boolean {
  return readLocalPref(COLLAPSED_SECTIONS).includes(sectionId);
}

function writeCollapsed(sectionId: SectionId, collapsed: boolean): void {
  const current = readLocalPref(COLLAPSED_SECTIONS);
  const next = collapsed
    ? [...current.filter((x) => x !== sectionId), sectionId]
    : current.filter((x) => x !== sectionId);
  writeLocalPref(COLLAPSED_SECTIONS, next);
}

export default function CollapsibleSection({
  sectionId,
  className,
  children,
}: {
  /** Stable per-SECTION id from the registry's catalog (`programs:chain`) — never a
   *  per-entity key: collapsing "Critical chain" means on every program. Typed against
   *  SECTION_IDS so a typo forks nothing: it does not compile. */
  sectionId: SectionId;
  /** The page's own section class (spacing stays the page's business). */
  className?: string;
  children: React.ReactNode;
}) {
  // localStorage as an external store; `.includes` returns a primitive, so the
  // snapshot is stable and never loops the store.
  const collapsed = useSyncExternalStore(
    subscribePrefChange,
    () => readCollapsed(sectionId),
    () => false,
  );
  const ref = useRef<HTMLElement>(null);
  // Page scrolls go through the press guard, never raw scrollIntoView
  // (docs/knowledge/a-page-scroll-between-press-and-release-loses-the-click.md).
  const scrollPageTo = useSteadyPageScroll();

  const toggle = useCallback(() => writeCollapsed(sectionId, !readCollapsed(sectionId)), [sectionId]);
  const expand = useCallback(() => {
    if (readCollapsed(sectionId)) writeCollapsed(sectionId, false);
  }, [sectionId]);

  // Fail-closed guard for the one-heading contract above (AGENTS lesson 2): a second
  // AnchorHeading under this wrapper anchors a second fold path and holds its wrapper
  // chain open — a partial fold that would otherwise fail silently. Loud in dev only;
  // production renders whatever it has.
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const headings = ref.current?.querySelectorAll('[data-collapse-heading]').length ?? 0;
    if (headings > 1) {
      console.error(
        `CollapsibleSection "${sectionId}" contains ${headings} AnchorHeadings — the fold needs exactly one (see the component header).`,
      );
    }
  }, [sectionId]);

  useEffect(() => {
    const expandIfAddressed = () => {
      const raw = window.location.hash.slice(1);
      if (!raw) return;
      let id: string;
      try {
        id = decodeURIComponent(raw);
      } catch {
        return;
      }
      const target = document.getElementById(id);
      if (!target || !ref.current?.contains(target) || !readCollapsed(sectionId)) return;
      expand();
      // The heading is visible even collapsed, so a heading anchor already scrolled and
      // this re-scroll lands where the page already is; a body target had no box until
      // now, so re-issue it — top-aligned, agreeing with the fragment's own jump.
      afterLayoutSettles(() => scrollPageTo(target, { behavior: 'smooth', block: 'start' }));
    };
    expandIfAddressed();
    // pushState (Next <Link>) does not fire `hashchange` — this covers both (#40).
    return subscribeLocationChange(expandIfAddressed);
  }, [sectionId, expand, scrollPageTo]);

  // Memoized so a parent re-render doesn't re-render every child under the provider.
  const value = useMemo(() => ({ collapsed, toggle, expand }), [collapsed, toggle, expand]);

  return (
    <section ref={ref} className={`${styles.section} ${className ?? ''}`} data-collapsed={collapsed || undefined}>
      <SectionCollapseContext.Provider value={value}>{children}</SectionCollapseContext.Provider>
    </section>
  );
}
