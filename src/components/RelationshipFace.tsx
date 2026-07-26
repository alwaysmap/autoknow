'use client';

import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import { REL_KEY, relScoreLabel, type RelScore } from '../lib/relationship';

// The two glyphs of the partner relationship scale, in their own module because four
// surfaces draw them (the partner header, the list cell, the activity feed, the
// history log) and one of those — NeedleHistoryList — is now rendered BY
// RelationshipScale. Left where they were, that would be an import cycle (#111).
//
// A pain-scale/"airport bathroom" face carries the VALENCE a dot-axis could not:
// nobody has to ask whether 5 is good when 5 is beaming. Ink-only (the scale stays
// colorless by design — see lib/relationship) — mouth curvature and eyes do the work.

export function RelationshipFace({ score, size = 22, decorative = false }: {
  score: RelScore; size?: number;
  /** Inside an already-labeled control (e.g. the picker radios) the face must not
   *  contribute to the accessible name. */
  decorative?: boolean;
}) {
  const locale = useLocale();
  // curvature: -1 (deep frown, 1) .. +1 (big smile, 5); 3 is a flat "steady".
  const c = (score - 3) / 2;
  const endY = 3.6 - c * 1.6;
  const ctlY = 3.6 + c * 3.4;
  // The word leads; the numeral follows as the axis coordinate it is. A screen-reader
  // user gets no axis to look at, so the position is spelled out rather than implied.
  const name = `${relScoreLabel(locale, score)} — ${score}/5`;
  return (
    <svg
      viewBox="-10 -10 20 20"
      width={size}
      height={size}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': name })}
    >
      <circle cx={0} cy={0} r={8.6} fill="none" stroke="currentColor" strokeWidth={1.5} />
      <circle cx={-3.1} cy={-2.6} r={1.15} fill="currentColor" />
      <circle cx={3.1} cy={-2.6} r={1.15} fill="currentColor" />
      <path
        d={`M -4 ${endY} Q 0 ${ctlY} 4 ${endY}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
      />
      {!decorative && (
        <title>{`${name} (1 = ${t(locale, REL_KEY[1])}, 5 = ${t(locale, REL_KEY[5])})`}</title>
      )}
    </svg>
  );
}

/** "Was unrated" — the prior slot when health goes from nothing to its first value.
 *  A dashed empty ring with a centre dash; not a face (there was no reading). */
export function RelationshipNoValue({ size = 26, decorative = false }: { size?: number; decorative?: boolean }) {
  const locale = useLocale();
  return (
    <svg
      viewBox="-10 -10 20 20"
      width={size}
      height={size}
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': t(locale, 'relNotRated') })}
    >
      <circle cx={0} cy={0} r={8.6} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="2.4 2.4" />
      <line x1={-3.6} y1={0} x2={3.6} y2={0} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
      {!decorative && <title>{t(locale, 'relNotRated')}</title>}
    </svg>
  );
}
