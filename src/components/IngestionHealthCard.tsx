import type { Locale } from '../lib/i18n';
import { t } from '../lib/i18n';
import type { IngestionHealth } from '../lib/ingestionHealth';
import { isoDateTime } from '../lib/dates';
import { MAX_DOC_CHARS } from '../lib/gemini';
import { knownCyclesPerDay, resolveCyclesPerDay } from '../lib/cronCadence';
import BudgetSlider from './BudgetSlider';
import styles from './IngestionHealthCard.module.css';

// #38: the operator's ingestion-health panel on Manage → Sources. It surfaces the bounded
// latest-cycle summary (never a growing history — see the ingestion-health ADR), the
// free-tier budget knob, the standing limits in plain language, and the live "shared but
// not indexed" list. Presentational: all data comes pre-shaped from lib/ingestionHealth,
// all math from lib/ingestBudget.
//
// It is also the boundary where the Scheduler cadence crosses into the browser: this is a
// server component, so it can read the exported schedule, and it hands the result down as
// a prop rather than letting the client half guess (#197). The two readings differ on
// purpose — `resolveCyclesPerDay` gives the budget math a number it can always divide by,
// while `knownCyclesPerDay` gives the COPY the truth, including "we were not told", so a
// sentence never promises a cadence no deployment committed to.

const FOLLOWED_FOLDER_DEPTH = 5; // mirrors MAX_FOLDER_DEPTH in lib/driveSync (surfaced to users)

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className={styles.stat}>
      <span className={`${styles.statValue} ${warn && value > 0 ? styles.warnValue : ''}`}>{value}</span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export default function IngestionHealthCard({
  locale,
  health,
}: {
  locale: Locale;
  health: IngestionHealth;
}) {
  const { summary, skipped, truncated, budget } = health;
  const cycles = knownCyclesPerDay();

  return (
    <section className={styles.card} data-testid="ingestion-health">
      <h2 className={styles.cardTitle}>{t(locale, 'ingestHealthTitle')}</h2>

      {summary ? (
        <>
          <div className={styles.summary}>
            <Stat label={t(locale, 'ingestStatBacklog')} value={summary.backlog} warn />
            <Stat label={t(locale, 'ingestStatDiscovered')} value={summary.discovered} />
            <Stat label={t(locale, 'ingestStatRefreshed')} value={summary.refreshed + summary.changed} />
            <Stat label={t(locale, 'ingestStatSkipped')} value={summary.skippedOtherTypes + summary.skippedTooDeep} />
            <Stat label={t(locale, 'ingestStatErrors')} value={summary.errors + summary.driveErrors} warn />
          </div>
          <p className={styles.ranAt}>
            {t(locale, 'ingestRanAt', { when: isoDateTime(summary.ranAt) })}
            {summary.quotaStopped && ` · ${t(locale, 'ingestQuotaStopped')}`}
          </p>
        </>
      ) : (
        <p className={styles.skipEmpty}>{t(locale, 'ingestNeverRun')}</p>
      )}

      {/* free-tier budget knob */}
      <div className={styles.section}>
        <div className={styles.budgetHead}>
          <h3 className={styles.sectionTitle}>{t(locale, 'ingestBudgetTitle')}</h3>
        </div>
        <BudgetSlider
          initialBudgetDocs={budget.dailyReingestBudgetDocs}
          initialFreeTierRpd={budget.freeTierRequestsPerDay}
          cyclesPerDay={resolveCyclesPerDay()}
          labels={{
            help: t(locale, 'ingestBudgetHelp'),
            sliderLabel: t(locale, 'ingestBudgetSliderLabel'),
            docsUnit: t(locale, 'ingestBudgetDocsUnit'),
            requestsUnit: t(locale, 'ingestBudgetRequestsUnit'),
            freeTierMarker: t(locale, 'ingestBudgetFreeTierMarker'),
            safeTag: t(locale, 'ingestBudgetSafe'),
            overTag: t(locale, 'ingestBudgetOver'),
            freeTierLabel: t(locale, 'ingestBudgetFreeTierLabel'),
            save: t(locale, 'ingestBudgetSave'),
            saving: t(locale, 'ingestBudgetSaving'),
            saved: t(locale, 'ingestBudgetSaved'),
            verify: t(locale, 'ingestBudgetVerify'),
          }}
        />
      </div>

      {/* standing limits, in plain language */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>{t(locale, 'ingestLimitsTitle')}</h3>
        <ul className={styles.limitsList}>
          <li>{t(locale, 'ingestLimitDocs')}</li>
          <li>
            {t(locale, 'ingestLimitChars', { chars: MAX_DOC_CHARS.toLocaleString(locale) })}
            {/* #56: the standing limit, and — only when it has actually bitten — how many
                sources it bit. A count of zero is not a finding, so it stays quiet. */}
            {truncated > 0 && (
              <span data-testid="truncated-count"> {t(locale, 'ingestLimitTruncatedNow', { count: truncated })}</span>
            )}
          </li>
          <li>{t(locale, 'ingestLimitDepth', { depth: FOLLOWED_FOLDER_DEPTH })}</li>
          <li>
            {cycles === null
              ? t(locale, 'ingestLimitCadence')
              : t(locale, 'ingestLimitCadenceKnown', { cycles })}
          </li>
        </ul>
      </div>

      {/* shared but not indexed — every dropped file, never silent */}
      <div className={styles.section}>
        <h3 className={styles.sectionTitle}>
          {t(locale, 'ingestSkipsTitle', { count: skipped.length })}
        </h3>
        {skipped.length === 0 ? (
          <p className={styles.skipEmpty}>{t(locale, 'ingestSkipsEmpty')}</p>
        ) : (
          <div data-testid="skip-list">
            {skipped.map((s) => (
              <div key={s.fileId} className={styles.skipRow}>
                <span className={styles.skipName} title={s.name}>{s.name}</span>
                <span className={styles.skipMeta}>
                  {s.reason === 'beyond-folder-depth'
                    ? t(locale, 'ingestSkipReasonDepth')
                    : t(locale, 'ingestSkipReasonType')}
                  {s.sharedBy ? ` · ${s.sharedBy}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
