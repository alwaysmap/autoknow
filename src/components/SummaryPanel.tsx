'use client';

import React, { useEffect, useRef, useTransition } from 'react';
import { regenerateSummary } from '../app/actions/summaries';
import type { SummaryView, SectionKey } from '../lib/summaries';
import type { SummaryScope } from '../lib/summaryPrompts';
import { t, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import AiBadge from './AiBadge';
import styles from './SummaryPanel.module.css';
import { localDate } from '../lib/dates';

// The leadership summary — the "read this first" slot for a scope (ecosystem /
// partner / program). Highly structured: TL;DR, then Risks / Actions / Progress /
// Themes, every bullet carrying citations back to the exact in-app history page or
// ingested source it was drawn from. Synthesized only from data AutoKnow already
// stores; degrades to an honest empty state when Gemini is off.
//
// Freshness: summaries are cached append-only; when scope-relevant content is newer
// than the cached copy the server marks it stale and this panel regenerates it in the
// background (you keep reading the cached one meanwhile). A scope with NO summary
// yet generates one automatically on first view — nobody should have to click for
// the briefing to exist. The only control is a small Gemini spark (re-synthesize).

function GeminiSpark({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 12 12" width={size} height={size} aria-hidden>
      <path d="M 6 0.5 Q 6.9 4.4 11.5 6 Q 6.9 7.6 6 11.5 Q 5.1 7.6 0.5 6 Q 5.1 4.4 6 0.5 Z" fill="currentColor" />
    </svg>
  );
}

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
  // Whether a generation has completed at least once this mount. Distinguishes
  // "still synthesizing" from "finished, but there was nothing to synthesize" — the
  // latter must show an honest empty state, not a perpetual spinner.
  const [attempted, setAttempted] = React.useState(false);

  const regenerate = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set('scope', scope);
      fd.set('targetId', String(targetId));
      fd.set('path', path);
      await regenerateSummary(fd);
      setAttempted(true);
    });

  // Stale content ⇒ refresh in the background; NO summary yet ⇒ generate one
  // automatically — either way, once per mount.
  useEffect(() => {
    if (configured && !autoRan.current && (!summary || summary.stale)) {
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
    // Three honest states, never a stuck spinner:
    //  - a generation is actually running (or the auto-run is about to fire) → synthesizing
    //  - it finished and produced nothing (no evidence for this scope) → nothing-to-summarize
    //  - Gemini configured but nothing attempted yet, or unconfigured → prompt to generate
    const message = pending
      ? 'summarySynthesizing'
      : attempted
        ? 'summaryNoEvidence'
        : configured
          ? 'summarySynthesizing' // the mount effect is about to auto-generate
          : 'summaryEmpty';
    return (
      <div data-testid={`summary-${scope}`}>
        <div className={styles.header}>
          <p className={styles.empty}>{t(locale, message)}</p>
          <button type="button" className={styles.geminiBtn} disabled={pending} onClick={regenerate}
            title={t(locale, 'summaryGenerate')} aria-label={t(locale, 'summaryGenerate')}
            data-pending={pending || undefined}>
            <GeminiSpark />
          </button>
        </div>
      </div>
    );
  }

  const generated = localDate(summary.generatedAt, locale, { month: 'short', day: 'numeric' });
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
          <button type="button" className={styles.geminiBtn} disabled={pending} onClick={regenerate}
            title={t(locale, 'summaryRefresh')} aria-label={t(locale, 'summaryRefresh')}
            data-pending={pending || undefined}>
            <GeminiSpark />
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
