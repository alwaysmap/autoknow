'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import styles from './page.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { healthColor } from '../../lib/health';
import { deriveEmail } from '../../lib/auth';

interface Partner {
  id: number;
  name: string;
  type: string;
}

interface Project {
  id: number;
  name: string;
  partner: Partner;
  theNeedle: string;
  hillChartProgress: number;
  phases: {
    name: string;
    states: {
      status: string;
      theNeedle: string | null;
      hillChartProgress: number | null;
    }[];
  }[];
}

interface ActionItem {
  id: number;
  description: string;
  createdAt: string | Date;
  phase: {
    name: string;
    project: {
      id: number;
      name: string;
      partner: Partner;
    };
  };
}

interface Affiliation {
  id: number;
  role: string;
  startDate: string | Date;
  endDate: string | Date | null;
  partner: Partner;
}

interface Person {
  id: number;
  name: string;
  email: string;
  notes: string | null;
  currentPartner: Partner | null;
  affiliations: Affiliation[];
}

interface MeClientProps {
  currentUser: string;
  person: Person | null;
  projects: Project[];
  actionItems: ActionItem[];
  partners: {
    id: number;
    name: string;
    type: string;
  }[];
}

export default function MeClient({
  currentUser,
  person,
  projects,
  actionItems,
  partners,
}: MeClientProps) {
  // Avatar initials
  const initials = useMemo(() => {
    if (person?.name) {
      return person.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
    }
    return currentUser.replace('@', '').toUpperCase().slice(0, 2);
  }, [person, currentUser]);

  // Format date helper
  const formatDate = (dateStr: string | Date) => {
    return new Date(dateStr).toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    });
  };

  // Map projects to displayable list
  const projectDisplayData = useMemo(() => {
    return projects.map((p) => {
      // Find the active phase
      const activePhase = p.phases.find((phase) => phase.states[0]?.status === 'Active WIP') || p.phases[0];

      return {
        id: p.id,
        name: p.name,
        partnerName: p.partner.name,
        partnerId: p.partner.id,
        activePhaseName: activePhase?.name || 'N/A',
        theNeedle: p.theNeedle,
        hillChartProgress: p.hillChartProgress,
      };
    });
  }, [projects]);

  // Map action items
  const actionItemsDisplayData = useMemo(() => {
    return actionItems.map((ai) => ({
      id: ai.id,
      description: ai.description,
      projectName: ai.phase.project.name,
      projectId: ai.phase.project.id,
      phaseName: ai.phase.name,
      partnerName: ai.phase.project.partner.name,
      createdAt: new Date(ai.createdAt).toLocaleDateString(),
    }));
  }, [actionItems]);

  return (
    <div className={styles.container}>
      <header className={styles.profileHeader}>
        <div className={styles.avatar}>{initials}</div>
        <div className={styles.profileInfo}>
          <h1>{person ? person.name : currentUser.replace('@', '')}</h1>
          <span className={styles.userHandle}>
            {currentUser} | {person ? person.email : deriveEmail(currentUser)}
          </span>
          {person?.notes && <p className={styles.bioNotes}>&ldquo;{person.notes}&rdquo;</p>}
        </div>
      </header>

      <div className={styles.grid}>
        {/* Left Column: Actions and Accountabilities */}
        <div className={styles.leftCol}>
          {/* Card 1: My Action Items */}
          <div className={styles.card}>
            <h2>My action items</h2>
            <DataTable
              headers={[
                { key: 'description', label: 'Action Item Description' },
                { key: 'projectName', label: 'Project Context' },
                { key: 'createdAt', label: 'Assigned Date' },
              ]}
              data={actionItemsDisplayData}
              renderRow={(ai: any) => (
                <tr key={ai.id}>
                  <td>
                    <strong>{ai.description}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      Phase: {ai.phaseName}
                    </div>
                  </td>
                  <td>
                    <Link href={`/projects/${ai.projectId}`} className={styles.tableLink}>
                      {ai.projectName}
                    </Link>{' '}
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>({ai.partnerName})</span>
                  </td>
                  <td>{ai.createdAt}</td>
                </tr>
              )}
              defaultSortKey="createdAt"
              pageSize={10}
              emptyStateMessage="No pending action items assigned to you."
            />
          </div>

          {/* Card 2: My Project Accountabilities */}
          <div className={styles.card}>
            <h2>My projects</h2>
            <DataTable
              headers={[
                { key: 'name', label: 'Project Name' },
                { key: 'partnerName', label: 'Partner' },
                { key: 'activePhaseName', label: 'Active Phase' },
                { key: 'theNeedle', label: 'Needle' },
                { key: 'hillChartProgress', label: 'Progress' },
              ]}
              data={projectDisplayData}
              renderRow={(p: any) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/projects/${p.id}`} className={styles.tableLink}>
                      {p.name}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/partners/${p.partnerId}`} className={styles.tableLink}>
                      {p.partnerName}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/projects/${p.id}`} className={styles.tableLink}>
                      {p.activePhaseName}
                    </Link>
                  </td>
                  <td>
                    {(() => {
                      const label = formatNeedleValue(p.theNeedle);
                      return (
                        <span className={styles.badge} style={{ color: healthColor(label) }}>
                          {label}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', width: '80px', height: '8px', backgroundColor: 'var(--border)', borderRadius: '4px', overflow: 'hidden' }}>
                      <div style={{ width: `${p.hillChartProgress}%`, height: '100%', backgroundColor: 'var(--p-500)' }} />
                    </div>
                  </td>
                </tr>
              )}
              defaultSortKey="name"
              pageSize={10}
              emptyStateMessage="No project accountabilities found for you."
            />
          </div>
        </div>

        {/* Right Column: Bio timeline and partner relations */}
        <div className={styles.rightCol}>

          {/* Card 2: My Partner Relationships */}
          <div className={styles.card}>
            <h2>My partners</h2>
            {partners.length > 0 ? (
              <div className={styles.partnerList}>
                {partners.map((partner) => (
                  <Link
                    key={partner.id}
                    href={`/partners/${partner.id}`}
                    className={styles.partnerTag}
                  >
                    <span>{partner.name}</span>
                    <span style={{ fontSize: '11px', color: 'var(--muted)', fontWeight: 'normal' }}>
                      ({partner.type})
                    </span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className={styles.emptyState}>No partner relationships associated with you.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
