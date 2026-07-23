import React from 'react';

// An SVG chart label with a background-coloured HALO under the fill, so it stays
// legible wherever it crosses ink — a buffer band, a progress bar, a grid line,
// or another label (issue #23). `paint-order: stroke` draws the stroke BEFORE the
// fill, so the stroke reads as a halo of page background around the glyphs, not an
// outline on them. The halo is a background TOKEN, never a literal (design.md §8b),
// so it is theme-correct for free: `var(--white)` tracks `--bg` and has a
// dark-theme value. A chart sitting on a bordered surface (a filter-bar card)
// passes `halo="var(--surface)"` instead — match what is actually behind the text.
//
// Six charts hand-copied a `<text>` with no halo; one copied it WITH the halo and
// the other five didn't (AGENTS lesson 7, inverted). This is the one place the
// triple lives now, so it cannot drift, and a call site cannot silently forget it.

type ChartLabelProps = React.SVGProps<SVGTextElement> & {
  /** Background token painted as the halo. Default: the page background. */
  halo?: string;
  /** Halo stroke width in px (§9 sanctions px for SVG strokes). Default scales
   *  with font size so it reads as a halo, not faux-bold — ~2.5px at 8px type,
   *  capped so 10–11px labels don't thicken. */
  haloWidth?: number;
};

export default function ChartLabel({ halo = 'var(--white)', haloWidth, fontSize, children, ...rest }: ChartLabelProps) {
  const size = typeof fontSize === 'number' ? fontSize : 10;
  const width = haloWidth ?? Math.min(3, Math.round(size * 0.31 * 10) / 10);
  return (
    <text {...rest} fontSize={fontSize} stroke={halo} strokeWidth={width} paintOrder="stroke">
      {children}
    </text>
  );
}
