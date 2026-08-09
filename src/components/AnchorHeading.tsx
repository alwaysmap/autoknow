'use client';

import React, { useContext } from 'react';
import { SectionCollapseContext } from './CollapsibleSection';
import { useLocale } from './LocaleProvider';
import { t } from '../lib/i18n';
import styles from './AnchorHeading.module.css';

// A section <h2> that carries its own anchor: the id lands on the heading, so
// `/programs/1#phases` is a real, shareable address the browser scrolls to
// natively. The row also hosts the section's affordances (⋯ menus, ⓘ) via
// `actions`, and in the instrument style ends in a graticule (see the module CSS).
// The heading shows no “#” — the ADR a-section-heading-carries-its-id says why.
//
// The id is always passed explicitly, never slugified from the heading text:
// headings are localized, and a text-derived anchor would give every locale a
// different URL for the same section (and break every link already shared).
//
// Inside a CollapsibleSection (autoknow-hcz.15) the row additionally carries the
// section's disclosure chevron — first in the affordance cluster, per §8c's one
// heading order (text → affordances → graticule) — and marks itself
// `data-collapse-heading`, which is what the wrapper's CSS folds the body against.
// While collapsed, the OTHER actions hide with the body they act on: a ⓘ whose
// legend explains a hidden chart, or a ⋯ opening a dialog over one, would
// otherwise operate on content the reader cannot see (and `<dialog>`s rendered in
// the folded body could not even paint).

interface AnchorHeadingProps {
  id: string;
  children: React.ReactNode;
  /** Extra class for the heading itself (page/component styling). */
  className?: string;
  /** Content that rides on the heading row, right of the title (menus, ⓘ). */
  actions?: React.ReactNode;
}

export default function AnchorHeading({ id, children, className, actions }: AnchorHeadingProps) {
  const locale = useLocale();
  const collapse = useContext(SectionCollapseContext);
  return (
    <div className={styles.row} data-collapse-heading={collapse ? '' : undefined}>
      <h2 id={id} className={`${styles.heading} ${className ?? ''}`}>{children}</h2>
      {collapse && (
        <button
          type="button"
          className={styles.disclosure}
          data-testid="section-toggle"
          aria-expanded={!collapse.collapsed}
          aria-label={t(locale, collapse.collapsed ? 'sectionExpand' : 'sectionCollapse')}
          title={t(locale, collapse.collapsed ? 'sectionExpand' : 'sectionCollapse')}
          onClick={collapse.toggle}
        >
          {/* Chevron: down = open, right = folded. currentColor, so it reads in both
              themes wherever the button's ink does. */}
          <svg viewBox="0 0 16 16" width={14} height={14} aria-hidden
            style={collapse.collapsed ? { transform: 'rotate(-90deg)' } : undefined}>
            <path d="M3.5 6l4.5 4.5L12.5 6" fill="none" stroke="currentColor" strokeWidth={1.8}
              strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      {collapse?.collapsed ? null : actions}
    </div>
  );
}
