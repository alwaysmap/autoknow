'use client';

import Link from 'next/link';
import DataTable from './DataTable';
import styles from '../app/page.module.css';

interface ActionItem {
  id: number;
  priority: string;
  description: string;
  projectId: number;
  project: string;
  owner: string;
  status: string;
}

export default function ActionItemsTable({ actionItems }: { actionItems: ActionItem[] }) {
  return (
    <DataTable
      headers={[
        { key: 'priority', label: 'Priority' },
        { key: 'description', label: 'Substantive Blocker' },
        { key: 'project', label: 'Project' },
        { key: 'owner', label: 'Owner' },
        { key: 'status', label: 'Status' }
      ]}
      data={actionItems}
      renderRow={(item: ActionItem) => {
        const cleanHandle = item.owner.replace('@', '').trim().toLowerCase();
        
        return (
          <tr key={item.id}>
            <td>
              <Link href={`/projects/${item.projectId}`} className={styles.tableLink}>
                {item.priority}
              </Link>
            </td>
            <td>
              <Link href={`/projects/${item.projectId}`} className={styles.tableLink}>
                <strong>{item.description}</strong>
              </Link>
            </td>
            <td>
              <Link href={`/projects/${item.projectId}`} className={styles.tableLink}>
                {item.project}
              </Link>
            </td>
            <td>
              <Link href={`/search?q=${cleanHandle}`} className={styles.tableLink}>
                <code>{item.owner}</code>
              </Link>
            </td>
            <td>
              <Link href={`/projects/${item.projectId}`} className={styles.tableLink}>
                {item.status}
              </Link>
            </td>
          </tr>
        );
      }}
      defaultSortKey="priority"
      pageSize={10}
    />
  );
}
