'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import DataTable from '../../components/DataTable';
import styles from './page.module.css';
import { formatNeedleValue } from '../../lib/needle';
import { healthColor, healthKey } from '../../lib/health';
import { deriveEmail } from '../../lib/auth';
import { t } from '../../lib/i18n';
import { useLocale } from '../../components/LocaleProvider';

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
  const locale = useLocale();
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
      // The active phase is the first one in flight (progress off zero, not yet done) —
      // derived from progress, never from the legacy stored status string.
      const activePhase =
        p.phases.find((phase) => {
          const progress = phase.states[0]?.hillChartProgress ?? 0;
          return progress > 0 && progress < 100;
        }) || p.phases[0];

      return {
        id: p.id,
        name: p.name,
        partnerName: p.partner.name,
        partnerId: p.partner.id,
        activePhaseName: activePhase?.name || t(locale, 'notAvailable'),
        theNeedle: p.theNeedle,
        hillChartProgress: p.hillChartProgress,
      };
    });
  }, [projects, locale]);

  // Map action items
  const actionItemsDisplayData = useMemo(() => {
    return actionItems.map((ai) => ({
      id: ai.id,
      description: ai.description,
      projectName: ai.phase.project.name,
      projectId: ai.phase.project.id,
      phaseName: ai.phase.name,
      partnerName: ai.phase.project.partner.name,
      createdAt: new Date(ai.createdAt).toLocaleDateString(locale),
    }));
  }, [actionItems, locale]);

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
            <h2>{t(locale, 'myActionItems')}</h2>
            <DataTable
              headers={[
                { key: 'description', label: t(locale, 'actionItemDescription') },
                { key: 'projectName', label: t(locale, 'projectContext') },
                { key: 'createdAt', label: t(locale, 'assignedDate') },
              ]}
              data={actionItemsDisplayData}
              renderRow={(ai) => (
                <tr key={ai.id}>
                  <td>
                    <strong>{ai.description}</strong>
                    <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: '2px' }}>
                      {t(locale, 'phaseLabel')}: {ai.phaseName}
                    </div>
                  </td>
                  <td>
                    <Link href={`/programs/${ai.projectId}`} className={styles.tableLink}>
                      {ai.projectName}
                    </Link>{' '}
                    <span style={{ fontSize: '11px', color: 'var(--muted)' }}>({ai.partnerName})</span>
                  </td>
                  <td>{ai.createdAt}</td>
                </tr>
              )}
              defaultSortKey="createdAt"
              pageSize={10}
              emptyStateMessage={t(locale, 'noPendingAssigned')}
            />
          </div>

          {/* Card 2: My Project Accountabilities */}
          <div className={styles.card}>
            <h2>{t(locale, 'myProjects')}</h2>
            <DataTable
              headers={[
                { key: 'name', label: t(locale, 'projectNameHeader') },
                { key: 'partnerName', label: t(locale, 'partnerLabel') },
                { key: 'activePhaseName', label: t(locale, 'activePhase') },
                { key: 'theNeedle', label: t(locale, 'needleLabel') },
                { key: 'hillChartProgress', label: t(locale, 'progressLabel') },
              ]}
              data={projectDisplayData}
              renderRow={(p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/programs/${p.id}`} className={styles.tableLink}>
                      {p.name}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/partners/${p.partnerId}`} className={styles.tableLink}>
                      {p.partnerName}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/programs/${p.id}`} className={styles.tableLink}>
                      {p.activePhaseName}
                    </Link>
                  </td>
                  <td>
                    {(() => {
                      const label = formatNeedleValue(p.theNeedle);
                      return (
                        <span className={styles.badge} style={{ color: healthColor(label) }}>
                          {t(locale, healthKey(label))}
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
              emptyStateMessage={t(locale, 'noProjectAccountabilities')}
            />
          </div>
        </div>

        {/* Right Column: Bio timeline and partner relations */}
        <div className={styles.rightCol}>

          {/* Card 2: My Partner Relationships */}
          <div className={styles.card}>
            <h2>{t(locale, 'myPartners')}</h2>
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
              <p className={styles.emptyState}>{t(locale, 'noPartnerRelationships')}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
