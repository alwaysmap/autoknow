import EcosystemStats from './EcosystemStats';
import SopRiskStat from './SopRiskStat';
import RelationshipMix from './RelationshipMix';
import type { DashboardProject } from '../lib/dashboardData';
import styles from './EcosystemStatStrip.module.css';

// The leadership strip, in reading order: how much work is in flight, how much of it
// is slipping its SOP, and how healthy the partner book carrying it is.
//
// A COMPONENT rather than a copied block (#133): it renders on `/` and `/ecosystem`,
// and the three tiles have to agree about what "active" and "at risk" mean. Two
// hand-rolled strips is how the same word ends up reporting two counts.
//
// It derives `activeCount` itself for the same reason — that predicate belongs with
// the tile that shows it, not repeated at each call site.

export default function EcosystemStatStrip({
  programs,
  relationshipScores,
  now,
}: {
  programs: DashboardProject[];
  relationshipScores: (number | null)[];
  /** Snapshotted by the caller's Server Component so SSR and hydration agree. */
  now: number;
}) {
  const activeCount = programs.filter((p) => !p.isArchived && p.hillChartProgress < 100).length;

  return (
    <section className={styles.strip}>
      <EcosystemStats activeCount={activeCount} allTimeCount={programs.length} />
      <SopRiskStat now={now} programs={programs} />
      <RelationshipMix scores={relationshipScores} />
    </section>
  );
}
