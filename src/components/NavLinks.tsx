'use client';

import React, { useCallback, useRef, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import AnchoredPopover from './AnchoredPopover';
import { fitCount } from '../lib/navCollapse';
import styles from './NavLinks.module.css';
import { useElementObserver } from '../lib/useElementObserver';

// Priority-plus nav links (#28). The nav's flexible middle: brand is pinned left and the
// controls right by the parent nav's flex layout; this region takes the rest and NEVER
// wraps or scrolls sideways. It shows as many links as fit and drops the remainder into a
// ⋯ overflow menu; zero visible links (everything in the menu) is a valid end state. With
// the nav locked to one row, --nav-h is a single correct value again instead of a per-
// breakpoint guess against a bar of unknowable height (the wrapping nav's real bug).
//
// CSS-vs-JS decision, stated per the issue's §8c constraint: this MEASURES in JS
// (ResizeObserver), because the collapse point must reflect the real rendered label
// widths per locale (EN/DE/JA/KO differ) — a container-query / hard-coded-breakpoint CSS
// solution would bake in English widths, which the issue explicitly forbids, and a
// flex+overflow CSS solution cannot move only-the-overflow into a menu without leaving a
// half-clipped label (a "clipped control", §9). The §8c trap — a measurement observer
// that never fires leaving the UI empty — is sidestepped structurally: the SERVER and
// pre-observer state render EVERY link inline (getServerSnapshot → all visible), inside an
// overflow-clipped never-wrap row. So if the observer never fires, the reader sees all the
// links (the resting state is usable, never empty); the observer only ever HIDES links
// that would overflow. The collapse decision itself is the pure, unit-tested fitCount.

export interface NavItem {
  href: string;
  label: string;
}

// A quiet three-dot glyph drawn as an SVG (not a font character) so the measurer's copy
// and the real trigger are byte-identical in width regardless of the loaded font.
const DOTS = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
    <circle cx="5" cy="12" r="2" />
    <circle cx="12" cy="12" r="2" />
    <circle cx="19" cy="12" r="2" />
  </svg>
);

export default function NavLinks({ items, moreLabel }: { items: NavItem[]; moreLabel: string }) {
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const n = items.length;

  // useSyncExternalStore: the "store" is the browser's layout of the off-flow measurer
  // plus the region's available width. getSnapshot reads those rects and returns the
  // visible count via the pure fitCount; subscribe re-runs it whenever the region resizes
  // (or fonts finish loading, which changes label widths without a resize). No
  // setState-in-effect — the read is hydration-safe and matches ThemeToggle's pattern.
  // `fonts` because this measures TEXT: late webfonts reflow label widths without resizing
  // anything, so a nav measured against fallback metrics would collapse at the wrong point
  // and never look again. The shared hook carries why both resize AND the observer are
  // wired. The initial count is read once on mount by useSyncExternalStore regardless — so
  // even if no signal ever fires, the resting state is the correctly-measured load-width
  // nav, never an empty one (§8c).
  const subscribe = useElementObserver(rootRef, { fonts: true });

  const getSnapshot = useCallback((): number => {
    const root = rootRef.current;
    const measure = measureRef.current;
    // Pre-mount / hydration: refs not attached yet → all visible, matching the server.
    if (!root || !measure) return n;
    const itemEls = measure.querySelectorAll<HTMLElement>('[data-nav-measure]');
    const moreEl = measure.querySelector<HTMLElement>('[data-nav-more]');
    const itemWidths = Array.from(itemEls, (el) => el.getBoundingClientRect().width);
    const overflowWidth = moreEl ? moreEl.getBoundingClientRect().width : 0;
    const gap = parseFloat(getComputedStyle(measure).columnGap || '0') || 0;
    return fitCount({ available: root.clientWidth, itemWidths, gap, overflowWidth });
  }, [n]);

  const getServerSnapshot = useCallback(() => n, [n]);

  const count = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const visible = items.slice(0, count);
  const overflow = items.slice(count);
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);

  return (
    <div ref={rootRef} className={styles.root}>
      {/* Off-flow full-width copy of every link + the ⋯, laid out so it has real widths but
          invisible and inert. It always holds ALL items, so the widths handed to fitCount
          reflect the current locale/font — the measurement, not an English assumption. */}
      <div ref={measureRef} className={styles.measure} aria-hidden="true">
        {items.map((it) => (
          <span key={it.href} data-nav-measure className={styles.link}>{it.label}</span>
        ))}
        <span data-nav-more className={styles.moreTrigger}>{DOTS}</span>
      </div>

      {/* The real, single-row nav. .root is min-width:0 + overflow:hidden, so this never
          wraps to a second line and never scrolls sideways — the controls stay pinned. */}
      <div className={styles.row}>
        {visible.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={styles.link}
            aria-current={isActive(it.href) ? 'page' : undefined}
          >
            {it.label}
          </Link>
        ))}
        {overflow.length > 0 && (
          <AnchoredPopover
            variant="menu"
            align="end"
            panelLabel={moreLabel}
            panelClassName={styles.menu}
            renderTrigger={(triggerProps) => (
              <button
                {...triggerProps}
                type="button"
                className={styles.moreTrigger}
                aria-label={moreLabel}
                title={moreLabel}
                data-testid="nav-more"
              >
                {DOTS}
              </button>
            )}
          >
            {overflow.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                className={styles.menuItem}
                aria-current={isActive(it.href) ? 'page' : undefined}
              >
                {it.label}
              </Link>
            ))}
          </AnchoredPopover>
        )}
      </div>
    </div>
  );
}
