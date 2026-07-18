import Link from 'next/link';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import LocaleSwitcher from '../../components/LocaleSwitcher';

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
    <div style={{ padding: '32px 40px', maxWidth: 720 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t(locale, 'navManage')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4 }}>
          {t(locale, 'manageIntro')}
        </p>
      </header>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {entries.map((e) => (
          <li key={e.href} style={{ borderBottom: '1px solid var(--border, #ddd)', padding: '16px 0' }}>
            <Link href={e.href} style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg, #222)', textDecoration: 'none' }}>
              {e.label} →
            </Link>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted, #666)' }}>{e.desc}</p>
          </li>
        ))}

        {/* Language: the locale picker lives here now, not in the global nav. */}
        <li style={{ padding: '16px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--fg, #222)' }}>{t(locale, 'settingsLanguage')}</div>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--muted, #666)' }}>{t(locale, 'settingsLanguageDesc')}</p>
          </div>
          <LocaleSwitcher locale={locale} />
        </li>
      </ul>
    </div>
  );
}
