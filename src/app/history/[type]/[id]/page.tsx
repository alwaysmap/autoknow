import { notFound } from 'next/navigation';
import { getStatusHistory, getNeedleHistory, getHillHistory, type HistoryType } from '../../../../lib/history';
import NeedleHistoryList from '../../../../components/NeedleHistoryList';
import HillHistoryList from '../../../../components/HillHistoryList';
import BackLink from '../../../../components/BackLink';
import { phaseColor } from '../../../../lib/phase';
import { getLocale } from '../../../../lib/locale';
import { t } from '../../../../lib/i18n';

export const dynamic = 'force-dynamic';

// A status-update LOG, nothing more: every needle update (programs/partners) or
// hill update (phases), newest first, as list cards. No chart — the gauges on the
// entity's own page carry the visual; this page is for reading the words.

const VALID: HistoryType[] = ['project', 'phase', 'partner'];
const fallbackHref = (type: HistoryType, id: number): string => {
  if (type === 'project') return `/programs/${id}`;
  if (type === 'partner') return `/partners/${id}`;
  return '/'; // phases have no standalone page
};

export default async function HistoryPage(props: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await props.params;
  if (!(VALID as string[]).includes(type)) return notFound();
  const ht = type as HistoryType;
  const nid = parseInt(id, 10);
  if (Number.isNaN(nid)) return notFound();
  const locale = await getLocale();

  // Phases are tracked with the hill chart; programs with the needle; partners with
  // the 1..7 relationship scale (same state rows, different rendering).
  const [history, needle, hill] = await Promise.all([
    getStatusHistory(ht, nid),
    ht === 'phase' ? Promise.resolve(null) : getNeedleHistory(ht, nid),
    ht === 'phase' ? getHillHistory(nid) : Promise.resolve(null),
  ]);
  if (!history) return notFound();

  return (
    <div style={{ padding: '32px 40px', maxWidth: 840 }}>
      <header style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 8 }}>
          {/* honest back: browser history, not a hardcoded destination */}
          <BackLink fallbackHref={fallbackHref(ht, nid)} />
        </div>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{history.title}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4 }}>
          {ht === 'phase' ? t(locale, 'historyHillIntro') : ht === 'partner' ? t(locale, 'historyRelIntro') : t(locale, 'historyNeedleIntro')}
        </p>
      </header>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>{t(locale, 'statusUpdates')}</h2>
      {ht === 'phase' ? (
        <HillHistoryList changes={hill?.changes ?? []} color={phaseColor(nid)} emptyLabel={t(locale, 'noChangesRecorded')} locale={locale} />
      ) : (
        <NeedleHistoryList changes={needle?.changes ?? []} relationship={ht === 'partner'} emptyLabel={t(locale, 'noChangesRecorded')} locale={locale} />
      )}
    </div>
  );
}
