'use client';

import Link from 'next/link';
import DataTable from './DataTable';
import { t } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from '../app/page.module.css';

interface Program {
  id: number;
  partner: string;
  partnerId: number;
  projectName: string;
  currentPhase: string;
  figuringItOutDays: number;
  needle: string;
  lastStateChange: string;
}

export default function ProgramsTable({ programsRisk }: { programsRisk: Program[] }) {
  const locale = useLocale();
  return (
    <DataTable
      headers={[
        { key: 'partner', label: t(locale, 'partnerLabel') },
        { key: 'projectName', label: t(locale, 'projectLabel') },
        { key: 'currentPhase', label: t(locale, 'currentPhase') },
        { key: 'figuringItOutDays', label: t(locale, 'figuringItOutTime') },
        { key: 'needle', label: t(locale, 'theNeedle') },
        { key: 'lastStateChange', label: t(locale, 'lastUpdate') }
      ]}
      data={programsRisk}
      renderRow={(program: Program) => (
        <tr key={program.id}>
          <td>
            <Link href={`/partners/${program.partnerId}`} className={styles.tableLink}>
              {program.partner}
            </Link>
          </td>
          <td>
            <Link href={`/programs/${program.id}`} className={styles.tableLink}>
              {program.projectName}
            </Link>
          </td>
          <td>{program.currentPhase}</td>
          <td>
            {t(locale, 'daysShort', { n: program.figuringItOutDays })}{' '}
            {program.figuringItOutDays > 7 && <span className={styles.alertText}> {t(locale, 'blockedTag')}</span>}
          </td>
          <td>
            <span className={`${styles.badge} ${styles[program.needle.toLowerCase()]}`}>
              {program.needle}
            </span>
          </td>
          <td>{program.lastStateChange}</td>
        </tr>
      )}
      defaultSortKey="projectName"
      pageSize={10}
    />
  );
}
