import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getStatusHistory, getNeedleHistory, getHillHistory, type HistoryType } from '../../../../lib/history';
import StatusHistoryChart from '../../../../components/StatusHistoryChart';
import NeedleHistoryList from '../../../../components/NeedleHistoryList';
import HillHistoryList from '../../../../components/HillHistoryList';
import { phaseColor } from '../../../../lib/phase';

export const dynamic = 'force-dynamic';

const VALID: HistoryType[] = ['project', 'phase', 'partner'];
const backHref = (type: HistoryType, id: number): string | null => {
  if (type === 'project') return `/projects/${id}`;
  if (type === 'partner') return `/partners/${id}`;
  return null; // phases have no standalone page
};

export default async function HistoryPage(props: { params: Promise<{ type: string; id: string }> }) {
  const { type, id } = await props.params;
  if (!(VALID as string[]).includes(type)) return notFound();
  const t = type as HistoryType;
  const nid = parseInt(id, 10);
  if (Number.isNaN(nid)) return notFound();

  // Phases are tracked with the hill chart; programs and partners with the needle.
  const [history, needle, hill] = await Promise.all([
    getStatusHistory(t, nid),
    t === 'phase' ? Promise.resolve(null) : getNeedleHistory(t, nid),
    t === 'phase' ? getHillHistory(nid) : Promise.resolve(null),
  ]);
  if (!history) return notFound();

  const back = backHref(t, nid);

  return (
    <div style={{ padding: '32px 40px', maxWidth: 840 }}>
      <header style={{ marginBottom: 16 }}>
        {back && (
          <div style={{ marginBottom: 8, fontSize: 13 }}>
            <Link href={back}>&larr; Back</Link>
          </div>
        )}
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>{history.title}</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4 }}>
          {t === 'phase' ? 'Progress over time.' : 'Progress & health over time.'}
        </p>
      </header>

      <section style={{ marginBottom: 28 }}>
        <StatusHistoryChart points={history.points} showNeedle={t !== 'phase'} />
      </section>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 12 }}>Changes</h2>
      {t === 'phase' ? (
        <HillHistoryList changes={hill?.changes ?? []} color={phaseColor(nid)} emptyLabel="No changes recorded." />
      ) : (
        <NeedleHistoryList changes={needle?.changes ?? []} emptyLabel="No changes recorded." />
      )}
    </div>
  );
}
