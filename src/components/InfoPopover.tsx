'use client';

import AnchoredPopover from './AnchoredPopover';
import styles from './InfoPopover.module.css';

// The ⓘ that explains a section without spending the page on it.
//
// design.md §7 asks whether a reader could scan a block without their eyes stopping. Two
// paragraphs of caveat under a quoted block fail that test: the caveats are true and worth
// having, but they are read ONCE and then re-read forever by everyone who only wanted the
// quote. This puts them one click away and leaves the page with the thing it is about.
//
// Built on `AnchoredPopover` (`variant='panel'`), which flips and clamps so the panel
// cannot open off the container's edge — the defect four hand-rolled popovers had before
// #24. It is NOT a `<dialog>`: this is an aside about what is already on screen, not a
// mode the reader has to leave.
//
// Placement rule it exists to satisfy (§8c, third trap): a ⓘ belonging to an `<h2>` rides
// in `AnchorHeading`'s `actions` slot, never as a sibling — the heading row ends in a
// `::after` graticule, so a sibling lands after the rule, is flung to the far right, and
// opens its panel off the edge.

export default function InfoPopover({
  label,
  children,
}: {
  /** Accessible name for both the trigger and the panel — say what it explains
   *  ("About the original request"), not "More info". */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <AnchoredPopover
      variant="panel"
      panelLabel={label}
      panelClassName={styles.panel}
      renderTrigger={(props) => (
        <button {...props} type="button" className={styles.trigger} aria-label={label} title={label}>
          {/* Drawn, not a glyph: the app keeps icons scarce (§8c) and an ⓘ character
              renders at a different weight in every font the four locales pull in. */}
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden>
            <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
            <path d="M8 7v4.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <circle cx="8" cy="4.75" r="0.85" fill="currentColor" />
          </svg>
        </button>
      )}
    >
      <div className={styles.body}>{children}</div>
    </AnchoredPopover>
  );
}
