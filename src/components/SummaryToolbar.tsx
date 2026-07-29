'use client';

import React from 'react';
import { t } from '../lib/i18n';
import { tNodes } from './tNodes';
import { useLocale } from './LocaleProvider';
import AiBadge from './AiBadge';
import RelativeTime from './RelativeTime';
import styles from './SummaryToolbar.module.css';

// The provenance row shared by every AI-summary surface: the AI badge, the
// "Generated <when> from <n> sources" line, an optional "Updating…" flag, and a
// reload-style refresh button. One component so the treatment (and vertical
// alignment) can't drift between scopes.
//
// #171: <when> answers "is this current" as a duration (RelativeTime), not a UTC
// stamp the reader subtracts by hand — the exact instant survives in `dateTime`/
// `title`, RelativeTime's own contract.

function ReloadIcon({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v5h-5" />
    </svg>
  );
}

export default function SummaryToolbar({
  generatedAt,
  sourceCount,
  updating,
  pending,
  onRefresh,
}: {
  generatedAt: string | Date;
  sourceCount: number;
  updating: boolean;
  pending: boolean;
  onRefresh?: () => void;
}) {
  const locale = useLocale();
  return (
    <div className={styles.bar}>
      <span className={styles.provenance}>
        <AiBadge />
        <span>{tNodes(locale, 'summaryProvenance', { d: <RelativeTime value={generatedAt} />, n: sourceCount })}</span>
        {updating && <span className={styles.updating}>{t(locale, 'summaryUpdating')}</span>}
      </span>
      {onRefresh && (
        <button
          type="button"
          className={styles.refreshBtn}
          disabled={pending}
          onClick={onRefresh}
          title={t(locale, 'summaryRefresh')}
          aria-label={t(locale, 'summaryRefresh')}
          data-pending={pending || undefined}
        >
          <ReloadIcon />
        </button>
      )}
    </div>
  );
}
