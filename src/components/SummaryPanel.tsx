'use client';

import React, { useEffect, useRef, useTransition } from 'react';
import { regenerateSummary } from '../app/actions/summaries';
import type { SummaryView, SectionKey } from '../lib/summaries';
import type { SummaryScope } from '../lib/summaryPrompts';
import { t, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import AiBadge from './AiBadge';
import styles from './SummaryPanel.module.css';

// The leadership summary — the "read this first" slot for a scope (ecosystem /
// partner / program). Highly structured: TL;DR, then Risks / Actions / Progress /
// Themes, every bullet carrying citations back to the exact in-app history page or
// ingested source it was drawn from. Synthesized only from data AutoKnow already
// stores; degrades to an honest empty state when Gemini is off.
//
// Freshness: summaries are cached append-only; when scope-relevant content is newer
// than the cached copy the server marks it stale and this panel regenerates it in the
// background (you keep reading the cached one meanwhile).

const SECTION_LABEL: Record<SectionKey, StringKey> = {
  risks: 'summaryRisks',
  actions: 'summaryActions',
  progress: 'summaryProgress',
  themes: 'summaryThemes',
};

// Risks and actions lead — that's what leadership scans for.
const SECTION_ORDER: SectionKey[] = ['risks', 'actions', 'progress', 'themes'];

export default function SummaryPanel({
  scope,
  targetId,
  path,
  summary,
  configured,
}: {
  scope: SummaryScope;
  targetId: number;
  path: string; // revalidated after regeneration
  summary: SummaryView | null;
  configured: boolean;
}) {
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const autoRan = useRef(false);

  const regenerate = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set('scope', scope);
      fd.set('targetId', String(targetId));
      fd.set('path', path);
      await regenerateSummary(fd);
    });

  // New content ingested or added ⇒ stale ⇒ refresh in the background, once.
  useEffect(() => {
    if (configured && summary?.stale && !autoRan.current) {
      autoRan.current = true;
      regenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configured, summary?.stale]);

  // A stored summary renders even when Gemini is currently unconfigured — cached
  // knowledge stays readable; only (re)generation needs the key.
  // No heading — the words ARE the point; chrome stays to one slim row.
  if (!configured && !summary) {
    return (
      <div data-testid={`summary-${scope}`}>
        <p className={styles.empty}>
          {t(locale, 'summariesOffPrefix')} <code>GEMINI_API_KEY</code> {t(locale, 'summariesOffSuffix')}
        </p>
      </div>
    );
  }

  if (!summary) {
    return (
      <div data-testid={`summary-${scope}`}>
        <div className={styles.header}>
          <p className={styles.empty}>{t(locale, 'summaryEmpty')}</p>
          <button type="button" className={styles.refreshBtn} disabled={pending} onClick={regenerate}>
            {pending ? t(locale, 'summarySynthesizing') : t(locale, 'summaryGenerate')}
          </button>
        </div>
      </div>
    );
  }

  const generated = new Date(summary.generatedAt).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
  const ordered = SECTION_ORDER.map((key) => summary.body.sections.find((s) => s.key === key)).filter(
    (s): s is NonNullable<typeof s> => !!s && s.bullets.length > 0,
  );

  return (
    <div data-testid={`summary-${scope}`}>
      <div className={styles.header}>
        <span className={styles.provenance}>
          <AiBadge />{' '}
          {t(locale, 'summaryProvenance', { d: generated, n: summary.sourceCount })}
          {(summary.stale || pending) && (
            <span className={styles.stale}> {t(locale, 'summaryUpdating')}</span>
          )}
        </span>
        {configured && (
          <button type="button" className={styles.refreshBtn} disabled={pending} onClick={regenerate}>
            {pending ? t(locale, 'summarySynthesizing') : t(locale, 'summaryRefresh')}
          </button>
        )}
      </div>

      <p className={styles.tldr}>{summary.tldr}</p>

      <div className={styles.grid}>
        {ordered.map((section) => (
          <section key={section.key} className={`${styles.section} ${section.key === 'risks' ? styles.riskSection : ''}`}>
            <h3 className={styles.sectionTitle}>{t(locale, SECTION_LABEL[section.key])}</h3>
            <ul className={styles.bullets}>
              {section.bullets.map((b, i) => (
                <li key={i} className={styles.bullet}>
                  {b.text}
                  {b.citations.length > 0 && (
                    <span className={styles.citations}>
                      {b.citations.map((c, j) => (
                        <a
                          key={j}
                          href={c.href}
                          className={styles.citation}
                          title={c.label}
                          {...(c.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                        >
                          {j + 1}
                        </a>
                      ))}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
