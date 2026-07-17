'use client';

import React, { useActionState, useState } from 'react';
import { quickIngestAction, type QuickIngestState } from '../app/actions/context';
import { inferSource, type SourceKind, type TrackingMode } from '../lib/sources';
import { t, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import styles from './QuickIngest.module.css';

// Scoped "paste a link" (plan §5.2): the host page provides the anchor, inference
// provides the tracking mode as a visible two-state chip (never a required
// question), and the result reports where the link landed. Collapsed to a quiet
// "+ Add link" so it costs no chrome until used.

const KIND_KEY: Record<SourceKind, StringKey> = {
  drive: 'kindDrive',
  chat: 'kindChat',
  tracker: 'kindTracker',
  web: 'kindWeb',
  text: 'kindWeb',
};

export default function QuickIngest({
  anchorKind,
  anchorId,
  phaseId,
  path,
}: {
  /** Omit both anchor props for an UNSCOPED paste — the global classifier places it. */
  anchorKind?: 'program' | 'partner';
  anchorId?: number;
  phaseId?: number;
  path: string; // revalidated after a successful ingest
}) {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [override, setOverride] = useState<TrackingMode | null>(null);
  const [state, formAction, pending] = useActionState<QuickIngestState, FormData>(quickIngestAction, {});

  const inferred = inferSource(url || null);
  const mode: TrackingMode = override ?? inferred.mode;
  const result = state.result;

  if (!open) {
    return (
      <div className={styles.collapsed}>
        <button type="button" className={styles.opener} data-testid="quick-ingest-open" onClick={() => setOpen(true)}>
          {t(locale, 'addLink')}
        </button>
        {result?.ok && result.title && (
          <span className={styles.savedNote}>{t(locale, 'qiSaved', { t: result.title })}</span>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className={styles.form} data-testid="quick-ingest">
      {anchorKind && anchorId != null && (
        <>
          <input type="hidden" name="anchorKind" value={anchorKind} />
          <input type="hidden" name="anchorId" value={anchorId} />
        </>
      )}
      {phaseId != null && <input type="hidden" name="phaseId" value={phaseId} />}
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="mode" value={mode} />

      <div className={styles.row}>
        <input
          type="url"
          name="url"
          value={url}
          onChange={(e) => { setUrl(e.target.value); setOverride(null); }}
          placeholder={t(locale, 'qiPlaceholder')}
          className={styles.input}
          autoFocus
        />
        {/* the mode chip: inferred, visible, tappable — never a required question */}
        {url.trim() && (
          <button
            type="button"
            className={`${styles.chip} ${mode === 'watched' ? styles.chipWatched : ''}`}
            title={t(locale, KIND_KEY[inferred.kind])}
            data-testid="mode-chip"
            onClick={() => setOverride(mode === 'watched' ? 'snapshot' : 'watched')}
          >
            {t(locale, mode === 'watched' ? 'chipWatched' : 'chipSnapshot')}
            <span className={styles.chipKind}> · {t(locale, KIND_KEY[inferred.kind])}</span>
          </button>
        )}
        <button type="submit" disabled={pending || !url.trim()} className={styles.addBtn}>
          {pending ? '…' : t(locale, 'add')}
        </button>
        <button type="button" className={styles.cancel} onClick={() => { setOpen(false); setUrl(''); setOverride(null); }}>
          {t(locale, 'cancel')}
        </button>
      </div>

      {result && !pending && (
        <div className={styles.result} data-testid="quick-ingest-result">
          {result.ok && result.duplicateOf ? (
            <span className={styles.muted}>{t(locale, 'qiDuplicate')}</span>
          ) : result.ok ? (
            <span>
              {t(locale, 'qiSaved', { t: result.title ?? '' })}
              {result.attachedTo?.name && (
                <span className={styles.muted}> · {t(locale, 'qiAttached', { n: result.attachedTo.name })}</span>
              )}
            </span>
          ) : (
            <span className={styles.error}>{result.error}</span>
          )}
        </div>
      )}
    </form>
  );
}
