'use client';

import Link from 'next/link';
import DataTable from './DataTable';
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
  return (
    <DataTable
      headers={[
        { key: 'partner', label: 'Partner' },
        { key: 'projectName', label: 'Project' },
        { key: 'currentPhase', label: 'Current Phase' },
        { key: 'figuringItOutDays', label: '"Figuring it out" Time' },
        { key: 'needle', label: 'The Needle' },
        { key: 'lastStateChange', label: 'Last Update' }
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
            <Link href={`/projects/${program.id}`} className={styles.tableLink}>
              {program.projectName}
            </Link>
          </td>
          <td>{program.currentPhase}</td>
          <td>
            {program.figuringItOutDays}d 
            {program.figuringItOutDays > 7 && <span className={styles.alertText}> (Blocked)</span>}
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
