'use client';

import Link from 'next/link';
import DataTable from '../../../components/DataTable';
import DateCell from '../../../components/DateCell';
import PhaseHillChart from '../../../components/PhaseHillChart';
import { NeedleGaugeSvg } from '../../../components/NeedleGaugeSvg';
import MemberStatusDot from '../../../components/MemberStatusDot';
import { initiativeProjectHref, partnerHref } from '../../../lib/entityHref';
import type { InitiativeMemberRow } from '../../../lib/initiativeQueries';
import { t, type Locale } from '../../../lib/i18n';
import styles from './page.module.css';

// The initiative's partners as the shared DataTable (owner call 2026-08-08): needle
// gauge in one column, the copy's little hill in another — the same instruments the
// partner page's program rows and the program page carry, so one partner's reading
// looks identical wherever it appears. A CLIENT component because DataTable takes
// `renderRow` (the house reason).

export default function InitiativeMembersTable({
  initiativeId,
  members,
  locale,
  removeAction,
}: {
  initiativeId: number;
  members: InitiativeMemberRow[];
  locale: Locale;
  removeAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <DataTable
      headers={[
        { key: 'partnerName', label: t(locale, 'initiativeColPartners'), sortable: true },
        { key: 'theNeedle', label: t(locale, 'initiativeColHealth') },
        { key: 'phases', label: t(locale, 'phasesCard') },
        { key: 'completion', label: t(locale, 'initiativeColProgress'), sortable: true, sortType: 'number' },
        { key: 'targetDate', label: t(locale, 'initiativeTargetLabel'), sortable: true, sortType: 'date' },
        { key: 'remove', label: '' },
      ]}
      data={members}
      defaultSortKey="partnerName"
      defaultSortOrder="asc"
      paginate={false}
      emptyStateMessage={t(locale, 'initiativeNoMembers')}
      renderRow={(m: InitiativeMemberRow) => {
        return (
          <tr key={m.partnerId}>
            <td>
              <div className={styles.memberWho}>
                <Link href={m.projectId ? initiativeProjectHref(initiativeId, m.projectId) : partnerHref(m.partnerId)}>
                  {m.partnerName}
                </Link>
                <small>
                  <Link href={partnerHref(m.partnerId)} className={styles.regionLink}>{m.regionName}</Link>
                </small>
              </div>
            </td>
            <td>
              <span className={styles.gaugeCell}>
                <NeedleGaugeSvg progress={m.completion} health={m.theNeedle} />
              </span>
            </td>
            <td>
              {m.phases.length > 0 ? (
                <span className={styles.hillCell}>
                  <PhaseHillChart phases={m.phases} />
                </span>
              ) : (
                <span className={styles.mutedCell}>—</span>
              )}
            </td>
            <td>
              <span className={styles.pct}>{m.completion}%</span>{' '}
              <MemberStatusDot status={m.status} locale={locale} />
            </td>
            <td><DateCell value={m.targetDate} /></td>
            <td>
              <form action={removeAction} className={styles.removeForm}>
                <input type="hidden" name="initiativeId" value={initiativeId} />
                <input type="hidden" name="partnerId" value={m.partnerId} />
                <button type="submit" className={styles.removeBtn}>
                  {t(locale, 'removeFromInitiative')}
                </button>
              </form>
            </td>
          </tr>
        );
      }}
    />
  );
}
