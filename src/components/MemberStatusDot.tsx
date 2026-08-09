'use client';

import { MEMBER_STATUS_KEY, displayStatus, type MemberStatus } from '../lib/initiative';
import { t, type Locale } from '../lib/i18n';
import styles from './MemberStatusDot.module.css';

// The ONE rendering of an initiative member's status: reserved color beside its label,
// never color alone. Three surfaces (initiative members table, the /initiatives list's
// distribution, the partner page's rows) each hand-rolled this before review caught it
// (AGENTS lesson 7); the label map and the inactive→no-date display coercion live with
// the model (lib/initiative.ts).
const STATUS_CLASS: Record<Exclude<MemberStatus, 'inactive'>, string> = {
  'complete': styles.stComplete,
  'on-track': styles.stOnTrack,
  'at-risk': styles.stAtRisk,
  'no-date': styles.stNoDate,
};

export default function MemberStatusDot({
  status,
  locale,
  count,
}: {
  status: MemberStatus;
  locale: Locale;
  /** When set, renders "● N Label" — the list page's distribution shape. */
  count?: number;
}) {
  const shown = displayStatus(status);
  return (
    <span className={styles.wrap}>
      <span className={`${styles.dot} ${STATUS_CLASS[shown]}`} aria-hidden />
      {count != null && <span className={styles.count}>{count}</span>}
      {t(locale, MEMBER_STATUS_KEY[shown])}
    </span>
  );
}
