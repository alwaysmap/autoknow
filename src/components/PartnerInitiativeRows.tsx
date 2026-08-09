import Link from 'next/link';
import { NeedleGaugeSvg } from './NeedleGaugeSvg';
import DateCell from './DateCell';
import MemberStatusDot from './MemberStatusDot';
import { initiativeHref, initiativeProjectHref } from '../lib/entityHref';
import type { PartnerInitiativeRow } from '../lib/initiativeQueries';
import { t, type Locale } from '../lib/i18n';
import styles from './PartnerInitiativeRows.module.css';

// The partner page's #initiatives rows (gh-286 part g): this partner's active
// memberships, each with the same needle instrument its program rows carry, the
// membership's status·target, and two links — the initiative, and this partner's own
// copy underneath it. Server component: rows only, no state.

export default function PartnerInitiativeRows({ rows, locale }: { rows: PartnerInitiativeRow[]; locale: Locale }) {
  if (rows.length === 0) {
    return <p className={styles.empty}>{t(locale, 'initiativeNoMembers')}</p>;
  }
  return (
    <ul className={styles.rows}>
      {rows.map((r) => {
        return (
          <li key={r.initiativeId} className={styles.row}>
            <span className={styles.gauge}>
              <NeedleGaugeSvg progress={r.completion} health={r.theNeedle} />
            </span>
            <span className={styles.who}>
              <Link href={r.projectId ? initiativeProjectHref(r.initiativeId, r.projectId) : initiativeHref(r.initiativeId)} className={styles.name}>
                {r.initiativeName}
              </Link>
              <span className={styles.reading}>
                <MemberStatusDot status={r.status} locale={locale} />
                <span className={styles.pct}>{r.completion}%</span>
                {r.targetDate && (
                  <>
                    <span className={styles.sep} aria-hidden>·</span>
                    <DateCell value={r.targetDate} />
                  </>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
