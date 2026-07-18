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
    <div style={{ padding: '32px 40px', maxWidth: 860 }}>
      <header style={{ marginBottom: 20 }}>
        <div style={{ marginBottom: 8, fontSize: 13 }}>
          <Link href="/manage" style={{ color: 'var(--muted, #666)' }}>← {t(locale, 'navManage')}</Link>
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t(locale, 'promptsTitle')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4, maxWidth: 720 }}>
          {t(locale, 'promptsIntro')}
        </p>
      </header>

      {SUMMARY_SCOPES.map((scope) => {
        const override = overrideBy.get(scope);
        return (
          <section key={scope} style={{ marginBottom: 32 }} data-testid={`prompt-${scope}`}>
            <h2 style={{ fontSize: '1.05rem', fontWeight: 600, marginBottom: 2, textTransform: 'capitalize' }}>
              {scope}
              <span style={{
                marginLeft: 10, fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase',
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
                  padding: '10px 12px', border: '1px solid var(--border, #ddd)', borderRadius: 8,
                  background: '#fff', color: 'var(--fg, #222)', resize: 'vertical',
                }}
              />
              <div style={{ marginTop: 8 }}>
                <button type="submit" style={{
                  fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--fg, #222)', background: 'var(--fg, #222)', color: '#fff',
                }}>
                  {t(locale, 'savePrompt')}
                </button>
              </div>
            </form>
            {/* Restore is a SEPARATE form (a second submit button inside the save form
                hijacks the plain Save submit; nested forms are invalid). */}
            {override && (
              <form action={restoreDefaultPrompt} style={{ marginTop: 8 }}>
                <input type="hidden" name="scope" value={scope} />
                <button type="submit" style={{
                  fontSize: 12, fontWeight: 600, padding: '6px 16px', borderRadius: 6, cursor: 'pointer',
                  border: '1px solid var(--border, #ccc)', background: '#fff', color: 'var(--fg, #222)',
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
