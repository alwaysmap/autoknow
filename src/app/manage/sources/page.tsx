import { prisma } from '../../../lib/db';
import { driveConfigured, serviceAccountEmail } from '../../../lib/googleAuth';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import SourcesClient, { type SourceRow } from './SourcesClient';
import QuickIngest from '../../../components/QuickIngest';

export const dynamic = 'force-dynamic';

// Manage → Sources: the operator view of every ingested source and its freshness
// (plan §2.2). The client component handles sorting/filtering/pagination; this page
// just loads and serializes the rows.

export default async function SourcesPage() {
  const locale = await getLocale();
  const raw = await prisma.contextUrl.findMany({
    select: {
      id: true, url: true, title: true, type: true, mode: true, sourceRef: true,
      sourceStatus: true, addedBy: true, lastCheckedAt: true, createdAt: true, frozenReason: true,
      project: { select: { id: true, name: true } },
      partner: { select: { id: true, name: true } },
      _count: { select: { revisions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  const sources: SourceRow[] = raw.map((s) => ({
    id: s.id,
    url: s.url,
    title: s.title,
    type: s.type,
    mode: s.mode,
    sourceRef: s.sourceRef,
    sourceStatus: s.sourceStatus,
    addedBy: s.addedBy,
    lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    frozenReason: s.frozenReason,
    entityName: s.project?.name ?? s.partner?.name ?? null,
    entityHref: s.project ? `/programs/${s.project.id}` : s.partner ? `/partners/${s.partner.id}` : null,
    revisions: s._count.revisions,
  }));

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1080 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t(locale, 'sourcesTitle')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4, maxWidth: 760 }}>
          {t(locale, 'sourcesIntro')}
        </p>
        {/* what each action actually does — the affordances are otherwise terse */}
        <p style={{ color: 'var(--muted, #666)', fontSize: 12.5, marginTop: 6, maxWidth: 760, lineHeight: 1.55 }}>
          {t(locale, 'sourcesLegend')}
        </p>
        {driveConfigured ? (
          <p data-testid="drive-on" style={{ color: 'var(--muted, #666)', fontSize: 13, marginTop: 6, maxWidth: 760 }}>
            {t(locale, 'sourcesDriveOn', { email: serviceAccountEmail() ?? '' })}
          </p>
        ) : (
          sources.some((s) => s.type === 'Doc' && s.mode === 'watched') && (
            <p style={{ color: 'var(--muted, #666)', fontSize: 13, marginTop: 6, maxWidth: 760, fontStyle: 'italic' }}>
              {t(locale, 'sourcesDriveOff')}
            </p>
          )
        )}
      </header>

      {/* unscoped paste — the global classifier places it (the retired /ingest page's job) */}
      <div style={{ margin: '0 0 14px' }}>
        <QuickIngest path="/manage/sources" />
      </div>

      {sources.length === 0 ? (
        <p style={{ color: 'var(--muted, #666)', fontStyle: 'italic' }}>{t(locale, 'nothingHereYet')}</p>
      ) : (
        <SourcesClient sources={sources} />
      )}
    </div>
  );
}
