import Link from 'next/link';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

// The authoring/administration hub — home of everything pulled OUT of the navbar
// (Templates, Ingest, Dev Console) so day-to-day reading surfaces keep the chrome.
export default async function ManagePage() {
  const locale = await getLocale();

  const entries = [
    { href: '/templates', label: t(locale, 'navTemplates'), desc: t(locale, 'manageTemplatesDesc') },
    { href: '/manage/prompts', label: t(locale, 'promptsTitle'), desc: t(locale, 'managePromptsDesc') },
    { href: '/manage/sources', label: t(locale, 'sourcesTitle'), desc: t(locale, 'manageSourcesDesc') },
    { href: '/admin', label: t(locale, 'navDevConsole'), desc: t(locale, 'manageAdminDesc') },
  ];

  return (
    <div style={{ padding: '2rem var(--page-gutter)', maxWidth: '45rem' }}>
      <header style={{ marginBottom: '1.25rem' }}>
        <h1>{t(locale, 'navManage')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
          {t(locale, 'manageIntro')}
        </p>
      </header>

      <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
        {entries.map((e) => (
          <li key={e.href} style={{ borderBottom: '1px solid var(--border, #ddd)', padding: '1rem 0' }}>
            <Link href={e.href} style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--fg, #222)', textDecoration: 'none' }}>
              {e.label} →
            </Link>
            <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--muted, #666)' }}>{e.desc}</p>
          </li>
        ))}
        {/* Personal settings (theme, language) live in the User menu, not here —
            Manage is for deployment-level authoring/admin surfaces. */}
      </ul>
    </div>
  );
}
