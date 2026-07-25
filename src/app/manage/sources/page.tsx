import { prisma } from '../../../lib/db';
import { driveConfigured, serviceAccountEmail } from '../../../lib/googleAuth';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import { getIngestionHealth } from '../../../lib/ingestionHealth';
import { resolvePeople } from '../../../lib/personDirectory';
import { parseFilterParams, parseSortParams } from '../../../lib/tableUrlState';
import SourcesClient, { type SourceRow } from './SourcesClient';
import QuickIngest from '../../../components/QuickIngest';
import IngestionHealthCard from '../../../components/IngestionHealthCard';

export const dynamic = 'force-dynamic';

// Manage → Sources: the operator view of every ingested source and its freshness
// (plan §2.2). The client component handles sorting/filtering/pagination; this page
// loads/serializes the rows and parses the shareable table state from the URL (§6).

export default async function SourcesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await getLocale();
  const sp = await props.searchParams;
  const health = await getIngestionHealth();
  const raw = await prisma.contextUrl.findMany({
    select: {
      id: true, url: true, title: true, type: true, mode: true, sourceRef: true,
      sourceStatus: true, addedBy: true, lastCheckedAt: true, createdAt: true, frozenReason: true,
      truncated: true,
      project: { select: { id: true, name: true } },
      partner: { select: { id: true, name: true } },
      _count: { select: { revisions: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // `addedBy` is a bare string (schema: no Person relation), so the join happens here
  // and the row carries the resolved person alongside the raw token (#153). Unmatched
  // values — a departed employee, or the literal 'drive-share' — resolve to nothing and
  // render as plain text.
  const addedByPeople = await resolvePeople(raw.map((s) => s.addedBy));

  const sources: SourceRow[] = raw.map((s) => ({
    id: s.id,
    url: s.url,
    title: s.title,
    type: s.type,
    mode: s.mode,
    sourceRef: s.sourceRef,
    sourceStatus: s.sourceStatus,
    addedBy: s.addedBy,
    addedByPerson: (s.addedBy && addedByPeople[s.addedBy]) || null,
    lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    frozenReason: s.frozenReason,
    truncated: s.truncated,
    entityName: s.project?.name ?? s.partner?.name ?? null,
    entityHref: s.project ? `/programs/${s.project.id}` : s.partner ? `/partners/${s.partner.id}` : null,
    revisions: s._count.revisions,
  }));

  // Shareable table state (design.md §6): funnel columns + sort/dir + q, same as the
  // other listings. The funnel param names are the column keys.
  const initialFilters = parseFilterParams(sp, ['kind', 'state', 'addedBy']);
  const initialSort = parseSortParams(sp);
  const initialQ = typeof sp.q === 'string' ? sp.q : '';

  return (
    <div style={{ padding: '2rem var(--page-gutter)', maxWidth: '67.5rem' }}>
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
        <SourcesClient
          // Remount when the URL's params change so the client re-seeds from initial*
          // once (same rule as programs/partners/page.tsx).
          key={JSON.stringify(sp, Object.keys(sp).sort())}
          sources={sources}
          initialFilters={initialFilters}
          initialSort={initialSort}
          initialQ={initialQ}
        />
      )}
    </div>
  );
}
