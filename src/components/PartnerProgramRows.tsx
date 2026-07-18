import Link from 'next/link';
import { NeedleGaugeSvg } from './NeedleGauge';
import { phaseColor } from '../lib/phase';
import { t, statusKey, type Locale } from '../lib/i18n';
import type { PartnerProgram } from '../lib/partnerPrograms';
import styles from './PartnerProgramRows.module.css';
import { localDate } from '../lib/dates';

// Condensed program list for the Briefing layout: one scannable row per program
// (name, ownership, gauge, updated date), phases behind a native <details>
// disclosure. Same data as the PartnerPrograms cards, a fraction of the ink —
// whitespace separates rows, no borders (design.md §7 / Refactoring UI).

export default function PartnerProgramRows({ programs, locale = 'en' }: { programs: PartnerProgram[]; locale?: Locale }) {
  if (programs.length === 0) {
    return <p className={styles.empty}>{t(locale, 'noPartnerPrograms')}</p>;
  }

  return (
    <div className={styles.rows}>
      {programs.map((prog) => (
        <details key={`${prog.relationship}-${prog.id}`} className={styles.row} open>
          {/* The gauge is absolutely positioned so it spans the whole card — the
              title line AND the phase chips — vertically centered beside both. */}
          <span className={styles.gauge}>
            <NeedleGaugeSvg
              progress={prog.progress}
              health={prog.health}
              previousProgress={prog.previousProgress}
              previousHealth={prog.previousHealth}
            />
          </span>
          <summary className={styles.line}>
            <span className={styles.chevron} aria-hidden>
              <svg viewBox="0 0 10 10" width="10" height="10">
                <path d="M 3 1.5 L 7 5 L 3 8.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <Link href={`/programs/${prog.id}`} className={styles.name}>{prog.name}</Link>
            {prog.relationship === 'involved' && (() => {
              // everything is a URL (design.md): the owner is a link; split the localized
              // template around {p} so word order survives ja/ko.
              const [before, after] = t(locale, 'viaPartner', { p: '\u0000' }).split('\u0000');
              return (
                <span className={styles.via}>
                  {before}
                  <Link href={`/partners/${prog.ownerPartner.id}`} className={styles.viaLink}>{prog.ownerPartner.name}</Link>
                  {after}
                </span>
              );
            })()}
            {prog.isArchived && <span className={styles.archived}>{t(locale, 'archived')}</span>}
            <span className={styles.spacer} />
            {prog.updatedAt && (
              <span className={styles.updated}>
                {localDate(prog.updatedAt, locale, { month: 'short', day: 'numeric' })}
              </span>
            )}
          </summary>
          {prog.phases.length > 0 ? (
            <div className={styles.phases}>
              {prog.phases.map((ph) => (
                <Link
                  key={ph.id}
                  href={`/history/phase/${ph.id}`}
                  className={styles.phaseChip}
                  title={`${ph.name} — ${t(locale, statusKey(ph.progress))}${ph.role ? ` · ${ph.role}` : ''}`}
                >
                  <span className={styles.phaseDot} style={{ background: phaseColor(ph.id) }} />
                  {ph.name}
                  {ph.role && <span className={styles.phaseRole}>{ph.role}</span>}
                </Link>
              ))}
            </div>
          ) : (
            <p className={styles.noPhases}>{t(locale, 'statusNotStarted')}</p>
          )}
        </details>
      ))}
    </div>
  );
}
