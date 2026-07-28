'use client';

import React, { useEffect, useRef, useTransition } from 'react';
import { regenerateSummary } from '../app/actions/summaries';
import type { SummaryView, SectionKey } from '../lib/summaries';
import type { Segment } from '../lib/untrackedPeople';
import { annotateUntracked, type UntrackedContext } from '../lib/untrackedPeople';
import { TrackPersonProvider, UntrackedMention, type TrackPersonSurface } from './TrackPersonProse';
import type { SummaryScope } from '../lib/summaryPrompts';
import { t, type StringKey } from '../lib/i18n';
import { useLocale } from './LocaleProvider';
import SummaryToolbar from './SummaryToolbar';
import styles from './SummaryPanel.module.css';
import { isoDateTime } from '../lib/dates';

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

// Render briefing prose with its real nouns linked (#77). The links are DATA the
// server resolved (segments carry an href from our own routes, never a model-authored
// URL), so this only reads them — no dangerouslySetInnerHTML over model text. Absent
// segments (old briefs, or a link-free line) ⇒ the plain string.
function renderProse(
  text: string,
  segments: Segment[] | undefined,
  untracked?: UntrackedContext,
): React.ReactNode {
  // The SECOND pass, composed onto the first (#127 E15): `linkify` already claimed the
  // entities we know, and this claims the humans we do not from what is left. Passing
  // the segments rather than the text is what keeps a linked entity from also being
  // offered as an untracked person — the contradiction the composition exists to avoid.
  const runs = untracked ? annotateUntracked(text, untracked, segments) : segments;
  if (!runs || runs.length === 0) return text;
  return runs.map((s, i) =>
    s.untracked ? (
      <UntrackedMention key={i} address={s.untracked}>{s.text}</UntrackedMention>
    ) : s.href ? (
      <a
        key={i}
        href={s.href}
        className={styles.entityLink}
        {...(s.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {s.text}
      </a>
    ) : (
      <React.Fragment key={i}>{s.text}</React.Fragment>
    ),
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
  untracked,
}: {
  scope: SummaryScope;
  targetId: number;
  path: string; // revalidated after regeneration
  summary: SummaryView | null;
  /** Turns the untracked-mention affordance on for the briefing (#127 E15). Omitted,
   *  the prose renders exactly as before. */
  untracked?: TrackPersonSurface;
  configured: boolean;
}) {
  const locale = useLocale();
  const [pending, startTransition] = useTransition();
  const autoRan = useRef(false);
  // Whether a generation has completed at least once this mount. Distinguishes
  // "still synthesizing" from "finished, but there was nothing to synthesize" — the
  // latter must show an honest empty state, not a perpetual spinner.
  const [attempted, setAttempted] = React.useState(false);
  // Why the last refresh did not happen, in the server's own words. Held here rather
  // than thrown, because the auto-run below fires on ordinary page views and an
  // unhandled rejection there costs the whole page, not the briefing
  // (docs/knowledge/a-server-action-a-component-auto-fires-is-on-the-pages-critical-path.md).
  const [refreshError, setRefreshError] = React.useState<string | null>(null);

  const regenerate = () =>
    startTransition(async () => {
      const fd = new FormData();
      fd.set('scope', scope);
      fd.set('targetId', String(targetId));
      fd.set('path', path);
      try {
        const { error } = await regenerateSummary(fd);
        setRefreshError(error ?? null);
      } catch (err) {
        console.error('summary refresh failed:', err);
        setRefreshError(t(locale, 'summaryRefreshNoAnswer'));
      }
      setAttempted(true);
    });

  // One concept, named once: there is a reason to show, and we are not already busy
  // re-trying — which is also what makes the toolbar stop claiming "updating".
  const showRefreshError = !pending && refreshError !== null;
  const errorLine = (
    <p className={styles.empty} data-testid={`summary-error-${scope}`}>{refreshError}</p>
  );

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
    // Three states, never a stuck spinner. (A refusal is the FOURTH, and it is not one
    // of these `message` keys — it renders as `errorLine` just below, because its words
    // are the server's, not a key of ours.)
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
          {showRefreshError ? errorLine : <p className={styles.empty}>{t(locale, message)}</p>}
          <button type="button" className={styles.geminiBtn} disabled={pending} onClick={regenerate}
            title={t(locale, 'summaryGenerate')} aria-label={t(locale, 'summaryGenerate')}
            data-pending={pending || undefined}>
            <GeminiSpark />
          </button>
        </div>
      </div>
    );
  }

  // To the minute, not the day — lib/dates.isoDateTime carries why.
  const generated = isoDateTime(summary.generatedAt);
  const ordered = SECTION_ORDER.map((key) => summary.body.sections.find((s) => s.key === key)).filter(
    (s): s is NonNullable<typeof s> => !!s && s.bullets.length > 0,
  );

  return (
    // The provider is what a claimed mention reads its picker and date from. A briefing
    // carries no per-bullet timestamp, so `mentionDate` is null and the dialog SAYS today
    // is a guess rather than passing it off as the mention's own date.
    <TrackPersonProvider config={{ partners: untracked?.partners ?? [], mentionDate: null }}>
    <div data-testid={`summary-${scope}`}>
      {/* `updating`: a refresh already refused is not "updating" — leaving the toolbar
          in that state is the perpetual spinner AGENTS lesson 5 forbids. */}
      <SummaryToolbar
        generatedLabel={generated}
        sourceCount={summary.sourceCount}
        updating={pending || (summary.stale && !showRefreshError)}
        pending={pending}
        onRefresh={configured ? regenerate : undefined}
      />

      {/* A refresh that was declined or failed says so, once, above the briefing it
          could not replace — the cached one below is still true, just older. */}
      {showRefreshError && errorLine}

      <p className={styles.tldr}>{renderProse(summary.tldr, summary.body.tldrSegments, untracked?.ctx)}</p>

      <div className={styles.grid}>
        {ordered.map((section) => (
          <section key={section.key} className={`${styles.section} ${section.key === 'risks' ? styles.riskSection : ''}`}>
            <h3 className={styles.sectionTitle}>{t(locale, SECTION_LABEL[section.key])}</h3>
            <ul className={styles.bullets}>
              {section.bullets.map((b, i) => (
                <li key={i} className={styles.bullet}>
                  {renderProse(b.text, b.segments, untracked?.ctx)}
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
    </TrackPersonProvider>
  );
}
