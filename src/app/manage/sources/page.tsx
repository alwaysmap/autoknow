import { prisma } from '../../../lib/db';
import { refreshSourceAction, toggleSourcePause, toggleSourceMode } from '../../actions/context';
import { driveConfigured, serviceAccountEmail } from '../../../lib/googleAuth';
import { getLocale } from '../../../lib/locale';
import { t, type StringKey } from '../../../lib/i18n';

export const dynamic = 'force-dynamic';

// Manage → Sources: the operator view of every ingested source and its freshness
// (plan §2.2). Day-to-day users never need this page; it exists so the watch list is
// inspectable and correctable — refresh, pause, or flip tracking per row.

const FROZEN_KEY: Record<string, StringKey> = {
  'resolved': 'frzResolved',
  'access-revoked': 'frzAccess',
  'deleted': 'frzDeleted',
  'auth-required': 'frzAuth',
  'user-paused': 'frzPaused',
};

const btn: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--border, #ddd)',
  borderRadius: 6,
  padding: '3px 10px',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--muted, #666)',
  cursor: 'pointer',
};

export default async function SourcesPage() {
  const locale = await getLocale();
  const sources = await prisma.contextUrl.findMany({
    select: {
      id: true, url: true, title: true, type: true, mode: true, modeSource: true,
      sourceStatus: true, lastCheckedAt: true, lastChangedAt: true, frozenReason: true,
      project: { select: { id: true, name: true } },
      partner: { select: { id: true, name: true } },
      _count: { select: { revisions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const fmt = (d: Date | null) =>
    d ? d.toLocaleDateString(locale, { month: 'short', day: 'numeric' }) : t(locale, 'neverChecked');

  return (
    <div style={{ padding: '32px 40px', maxWidth: 980 }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t(locale, 'sourcesTitle')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4, maxWidth: 720 }}>
          {t(locale, 'sourcesIntro')}
        </p>
        {driveConfigured ? (
          <p data-testid="drive-on" style={{ color: 'var(--muted, #666)', fontSize: 13, marginTop: 6, maxWidth: 720 }}>
            {t(locale, 'sourcesDriveOn', { email: serviceAccountEmail() ?? '' })}
          </p>
        ) : (
          sources.some((s) => s.type === 'Doc' && s.mode === 'watched') && (
            <p style={{ color: 'var(--muted, #666)', fontSize: 13, marginTop: 6, maxWidth: 720, fontStyle: 'italic' }}>
              {t(locale, 'sourcesDriveOff')}
            </p>
          )
        )}
      </header>

      {sources.length === 0 ? (
        <p style={{ color: 'var(--muted, #666)', fontStyle: 'italic' }}>{t(locale, 'nothingHereYet')}</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <tbody>
            {sources.map((s) => {
              const entity = s.project?.name ?? s.partner?.name ?? null;
              const frozenKey = s.frozenReason ? FROZEN_KEY[s.frozenReason] : null;
              return (
                <tr key={s.id} data-testid={`source-${s.id}`} style={{ borderBottom: '1px solid var(--border, #e5e5e5)' }}>
                  <td style={{ padding: '10px 12px 10px 0', maxWidth: 380 }}>
                    <a href={s.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontWeight: 600, color: 'var(--fg, #222)', textDecoration: 'none' }}>
                      {s.title || s.url}
                    </a>
                    <div style={{ fontSize: 11.5, color: 'var(--muted, #888)', marginTop: 2 }}>
                      {[entity, s._count.revisions > 1 ? `${s._count.revisions} rev` : null].filter(Boolean).join(' · ')}
                    </div>
                  </td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
                      border: '1px solid',
                      borderColor: s.mode === 'watched' ? 'var(--chain-soft, #c9b9e6)' : 'var(--border, #ddd)',
                      color: s.mode === 'watched' ? 'var(--chain-ink, #5a4488)' : 'var(--muted, #888)',
                    }}>
                      {t(locale, s.mode === 'watched' ? 'chipWatched' : 'chipSnapshot')}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', whiteSpace: 'nowrap', fontSize: 12, color: 'var(--muted, #666)' }}>
                    {frozenKey
                      ? t(locale, 'frozenLabel', { r: t(locale, frozenKey) })
                      : s.mode === 'watched'
                        ? t(locale, 'checkedOn', { d: fmt(s.lastCheckedAt) })
                        : '—'}
                  </td>
                  <td style={{ padding: '10px 0', whiteSpace: 'nowrap', textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: 6 }}>
                      {s.mode === 'watched' && (
                        <>
                          <form action={refreshSourceAction} style={{ display: 'inline' }}>
                            <input type="hidden" name="id" value={s.id} />
                            <button type="submit" style={btn}>{t(locale, 'refreshNow')}</button>
                          </form>
                          <form action={toggleSourcePause} style={{ display: 'inline' }}>
                            <input type="hidden" name="id" value={s.id} />
                            <button type="submit" style={btn}>
                              {s.frozenReason === 'user-paused' ? t(locale, 'resumeLabel') : t(locale, 'pauseLabel')}
                            </button>
                          </form>
                        </>
                      )}
                      <form action={toggleSourceMode} style={{ display: 'inline' }}>
                        <input type="hidden" name="id" value={s.id} />
                        <button type="submit" style={btn}>
                          {t(locale, s.mode === 'watched' ? 'chipSnapshot' : 'chipWatched')}
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
