import { prisma } from '../../../lib/db';
import { driveConfigured, serviceAccountEmail } from '../../../lib/googleAuth';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import { getIngestionHealth } from '../../../lib/ingestionHealth';
import SourcesClient, { type SourceRow } from './SourcesClient';
import QuickIngest from '../../../components/QuickIngest';
import IngestionHealthCard from '../../../components/IngestionHealthCard';

export const dynamic = 'force-dynamic';

// Manage → Sources: the operator view of every ingested source and its freshness
// (plan §2.2). The client component handles sorting/filtering/pagination; this page
// just loads and serializes the rows.

export default async function SourcesPage() {
  const locale = await getLocale();
  const health = await getIngestionHealth();
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
    <div style={{ padding: '2rem 2.5rem', maxWidth: '67.5rem' }}>
      <header style={{ marginBottom: '1rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{t(locale, 'sourcesTitle')}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: '0.875rem', marginTop: '0.25rem', maxWidth: '47.5rem' }}>
          {t(locale, 'sourcesIntro')}
        </p>
        {/* what each action actually does — the affordances are otherwise terse */}
        <p style={{ color: 'var(--muted, #666)', fontSize: '0.75rem', marginTop: '0.375rem', maxWidth: '47.5rem', lineHeight: '1.25rem' }}>
          {t(locale, 'sourcesLegend')}
        </p>
        {driveConfigured ? (
          <p data-testid="drive-on" style={{ color: 'var(--muted, #666)', fontSize: '0.8125rem', marginTop: '0.375rem', maxWidth: '47.5rem' }}>
            {t(locale, 'sourcesDriveOn', { email: serviceAccountEmail() ?? '' })}
          </p>
        ) : (
          sources.some((s) => s.type === 'Doc' && s.mode === 'watched') && (
            <p style={{ color: 'var(--muted, #666)', fontSize: '0.8125rem', marginTop: '0.375rem', maxWidth: '47.5rem', fontStyle: 'italic' }}>
              {t(locale, 'sourcesDriveOff')}
            </p>
          )
        )}
      </header>

      {/* #38: ingestion health — backlog, the free-tier budget knob, the standing limits,
          and every shared-but-not-indexed file. */}
      <IngestionHealthCard locale={locale} health={health} />

      {/* unscoped paste — the global classifier places it (the retired /ingest page's job) */}
      <div style={{ margin: '0 0 0.875rem' }}>
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
