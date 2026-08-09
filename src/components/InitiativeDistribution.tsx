import MemberStatusDot from './MemberStatusDot';
import type { InitiativeRollup } from '../lib/initiative';
import type { Locale } from '../lib/i18n';
import styles from './InitiativeDistribution.module.css';

// The ONE rendering of an initiative's member-status distribution: zeros omitted, each
// surviving status a `MemberStatusDot` with its count, an em-dash when there is nothing
// to distribute. Extracted from the /initiatives list the moment a second surface
// (/ecosystem's initiatives section) needed the same reading — authoring it twice is how
// two pages drift into disagreeing about one rollup (AGENTS lesson 7). Both surfaces
// render `rollup` fields verbatim, so every count equals the member list the detail page
// shows (the summary-count ADR).

export default function InitiativeDistribution({ rollup, locale }: { rollup: InitiativeRollup; locale: Locale }) {
  const parts = [
    { status: 'complete' as const, n: rollup.complete },
    { status: 'on-track' as const, n: rollup.onTrack },
    { status: 'at-risk' as const, n: rollup.atRisk },
    { status: 'no-date' as const, n: rollup.noDate },
  ].filter((p) => p.n > 0);
  if (parts.length === 0) return <span className={styles.none}>—</span>;
  return (
    <span className={styles.distribution}>
      {parts.map((p) => (
        <MemberStatusDot key={p.status} status={p.status} count={p.n} locale={locale} />
      ))}
    </span>
  );
}
