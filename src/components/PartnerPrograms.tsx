import Link from 'next/link';
import { NeedleGaugeSvg } from './NeedleGauge';
import { phaseColor } from '../lib/phase';
import { t, statusKey, type Locale } from '../lib/i18n';
import type { PartnerProgram } from '../lib/partnerPrograms';
import styles from './PartnerPrograms.module.css';

// Program summaries on the partner page. A partner either OWNS a program or is
// INVOLVED via specific phases — each card says which, shows the program's current
// Progress & Health as a mini gauge, and lists the phases this partner touches
// (dot in the phase's own color, linked to the phase history).

export default function PartnerPrograms({ programs, locale = 'en' }: { programs: PartnerProgram[]; locale?: Locale }) {
  if (programs.length === 0) {
    return <p className={styles.empty}>{t(locale, 'noPartnerPrograms')}</p>;
  }

  return (
    <div className={styles.grid}>
      {programs.map((prog) => (
        <article key={`${prog.relationship}-${prog.id}`} className={styles.card}>
          <div className={styles.head}>
            <Link href={`/programs/${prog.id}`} className={styles.name}>{prog.name}</Link>
            <span className={prog.relationship === 'owner' ? styles.ownerBadge : styles.involvedBadge}>
              {prog.relationship === 'owner' ? t(locale, 'ownerLabel') : t(locale, 'involved')}
            </span>
            {prog.isArchived && <span className={styles.archived}>{t(locale, 'archived')}</span>}
          </div>

          {prog.relationship === 'involved' && (
            <div className={styles.meta}>
              {t(locale, 'ownedBy')} <Link href={`/partners/${prog.ownerPartner.id}`} className={styles.metaLink}>{prog.ownerPartner.name}</Link>
            </div>
          )}

          <div className={styles.gauge}>
            <NeedleGaugeSvg
              progress={prog.progress}
              health={prog.health}
              previousProgress={prog.previousProgress}
              previousHealth={prog.previousHealth}
            />
          </div>

          {prog.phases.length > 0 && (
            <div className={styles.phases}>
              {prog.phases.map((ph) => (
                <Link key={ph.id} href={`/history/phase/${ph.id}`} className={styles.phaseChip} title={`${ph.name} — ${t(locale, statusKey(ph.progress))}${ph.role ? ` · ${ph.role}` : ''}`}>
                  <span className={styles.phaseDot} style={{ background: phaseColor(ph.id) }} />
                  {ph.name}
                  {ph.role && <span className={styles.phaseRole}>{ph.role}</span>}
                </Link>
              ))}
            </div>
          )}

          {prog.updatedAt && (
            <div className={styles.updated}>
              {t(locale, 'updatedOn', { d: new Date(prog.updatedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' }) })}
            </div>
          )}
        </article>
      ))}
    </div>
  );
}
