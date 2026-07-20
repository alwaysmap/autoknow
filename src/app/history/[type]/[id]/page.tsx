import { notFound } from 'next/navigation';
import { getStatusHistory, getHillHistory, type HistoryType } from '../../../../lib/history';
import HillHistoryList from '../../../../components/HillHistoryList';
import BackLink from '../../../../components/BackLink';
import { phaseColor } from '../../../../lib/phase';
import { getLocale } from '../../../../lib/locale';
import { t } from '../../../../lib/i18n';

export const dynamic = 'force-dynamic';

// The hill-update LOG for a PHASE, newest first, as list cards. Programs and
// partners no longer have a page here (2026-07-20): their needle history is the
// detail popup on the entity's own page, reachable at
// /programs/:id#status-history — one place to read the words and add an update.

const VALID: HistoryType[] = ['phase'];
const fallbackHref = (_type: HistoryType, _id: number): string => '/'; // phases have no standalone page

export default async function HistoryPage(props: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await props.params;
  if (!(VALID as string[]).includes(type)) return notFound();
  const ht = type as HistoryType;
  const nid = parseInt(id, 10);
  if (Number.isNaN(nid)) return notFound();
  const locale = await getLocale();

  // Phases are tracked with the hill chart; programs with the needle; partners with
  // the 1..7 relationship scale (same state rows, different rendering).
  const [history, hill] = await Promise.all([getStatusHistory(ht, nid), getHillHistory(nid)]);
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
          {t(locale, 'historyHillIntro')}
        </p>
      </header>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>{t(locale, 'statusUpdates')}</h2>
      <HillHistoryList changes={hill?.changes ?? []} color={phaseColor(nid)} emptyLabel={t(locale, 'noChangesRecorded')} locale={locale} />
    </div>
  );
}
