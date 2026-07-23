import Link from 'next/link';
import { prisma } from '../../../lib/db';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import { DEFAULT_SUMMARY_PROMPTS, SUMMARY_SCOPES } from '../../../lib/summaryPrompts';
import { saveSummaryPrompt, restoreDefaultPrompt } from '../../actions/summaries';

export const dynamic = 'force-dynamic';

// The summary prompts, readable and tunable in one place. The textarea shows what
// will actually run: the DB override when one exists, otherwise the default from
// src/lib/summaryPrompts.ts. Saving stores/updates the override; clearing the field
// (or saving it identical to the default) reverts to the default.
export default async function SummaryPromptsPage() {
  const locale = await getLocale();
  const overrides = await prisma.summaryPrompt.findMany();
  const overrideBy = new Map(overrides.map((o) => [o.scope, o.prompt]));

  return (
    <div style={{ padding: '2rem var(--page-gutter)', maxWidth: '53.75rem' }}>
      <header style={{ marginBottom: '1.25rem' }}>
        <div style={{ marginBottom: '0.5rem', fontSize: '0.8125rem' }}>
          <Link href="/manage" style={{ color: 'var(--muted, #666)' }}>← {t(locale, 'navManage')}</Link>
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t(locale, 'promptsTitle')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: '0.875rem', marginTop: '0.25rem', maxWidth: '45rem' }}>
          {t(locale, 'promptsIntro')}
        </p>
      </header>

      {SUMMARY_SCOPES.map((scope) => {
        const override = overrideBy.get(scope);
        return (
          <section key={scope} style={{ marginBottom: '2rem' }} data-testid={`prompt-${scope}`}>
            <h2 style={{ fontSize: '1rem', fontWeight: 600, marginBottom: '0.125rem', textTransform: 'capitalize' }}>
              {scope}
              <span style={{
                marginLeft: '0.625rem', fontSize: '0.6875rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.05em', color: override ? 'var(--chain-ink, #5a4488)' : 'var(--muted, #888)',
              }}>
                {override ? t(locale, 'promptCustom') : t(locale, 'promptDefault')}
              </span>
            </h2>
            <form action={saveSummaryPrompt}>
              <input type="hidden" name="scope" value={scope} />
              <textarea
                name="prompt"
                rows={12}
                defaultValue={override ?? DEFAULT_SUMMARY_PROMPTS[scope]}
                aria-label={`${scope} prompt`}
                style={{
                  width: '100%', font: '12.5px/1.55 var(--font-geist-mono, monospace)',
                  padding: '0.625rem 0.75rem', border: '1px solid var(--border, #ddd)', borderRadius: '0.5rem',
                  background: 'var(--paper)', color: 'var(--fg, #222)', resize: 'vertical',
                }}
              />
              <div style={{ marginTop: '0.5rem' }}>
                <button type="submit" style={{
                  fontSize: '0.75rem', fontWeight: 600, padding: '0.375rem 1rem', borderRadius: '0.375rem', cursor: 'pointer',
                  border: '1px solid var(--fg, #222)', background: 'var(--fg, #222)', color: 'var(--paper)',
                }}>
                  {t(locale, 'savePrompt')}
                </button>
              </div>
            </form>
            {/* Restore is a SEPARATE form (a second submit button inside the save form
                hijacks the plain Save submit; nested forms are invalid). */}
            {override && (
              <form action={restoreDefaultPrompt} style={{ marginTop: '0.5rem' }}>
                <input type="hidden" name="scope" value={scope} />
                <button type="submit" style={{
                  fontSize: '0.75rem', fontWeight: 600, padding: '0.375rem 1rem', borderRadius: '0.375rem', cursor: 'pointer',
                  border: '1px solid var(--border, #ccc)', background: 'var(--paper)', color: 'var(--fg, #222)',
                }}>
                  {t(locale, 'restoreDefaultPrompt')}
                </button>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
