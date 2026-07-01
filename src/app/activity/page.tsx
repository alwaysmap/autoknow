import ActivityFeed from '../../components/ActivityFeed';
import UnifiedSearch from '../../components/UnifiedSearch';
import { getActivity } from '../../lib/activity';

export const dynamic = 'force-dynamic';

export default async function ActivityPage() {
  // Ecosystem-wide activity: ingested context + program/needle/hill/phase changes,
  // merged chronologically. This is where cross-program updates land by default.
  const events = await getActivity({ kind: 'ecosystem' });

  return (
    <div style={{ padding: '32px 40px', maxWidth: 900 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Ecosystem activity</h1>
        <p style={{ color: 'var(--muted, #666)', fontSize: 14, marginTop: 4 }}>
          Everything happening across the ecosystem — new programs, needle and progress
          changes, phase updates, and ingested context. Search to scope it.
        </p>
      </header>

      <section style={{ marginBottom: 28 }}>
        <UnifiedSearch placeholder="Search all of AutoKnow — partners, programs, people, context…" />
      </section>

      <h2 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: 8 }}>Recent activity</h2>
      <ActivityFeed items={events} deletable revalidate="/activity" />
    </div>
  );
}
