import EcosystemStats from './EcosystemStats';
import InitiativesStat from './InitiativesStat';
import SopRiskStat from './SopRiskStat';
import RelationshipMix from './RelationshipMix';
import EscalationsStat from './EscalationsStat';
import type { DashboardProject } from '../lib/dashboardData';
import styles from './EcosystemStatStrip.module.css';

// The leadership strip, in reading order: how much work is in flight (programs, then —
// gh-286 part h — the cross-partner initiatives beside them), how much of it is slipping
// its SOP, how many escalations are open (#245 section C), and last — always last, a
// user call (2026-08-10) — how healthy the partner book carrying it is. The counts lead;
// the relationship chart is the one non-numeral tile, and trailing it also lets the
// phone layout give it the wide slot (see the module CSS).
//
// A COMPONENT rather than a copied block (#133): it renders on `/` and `/ecosystem`,
// and the tiles have to agree about what "active" and "at risk" mean. Two hand-rolled
// strips is how the same word ends up reporting two counts. That is also why the open-
// escalation count is a PROP here rather than derived from `programs` the way
// `activeCount` is — an escalation is not a property of any program in this list (it
// may be partner-only), so there is nothing in `programs` to derive it from; the caller
// fetches it from `lib/escalationQueries.getOpenEscalationsCount` alongside the rest.
// The initiative count is a prop for the same reason again: initiative copies are
// excluded from `programs` by construction (gh-286 decision 5), so the caller fetches
// `lib/initiativeQueries.countActiveInitiatives` alongside the rest.
//
// It derives `activeCount` itself for the same reason: `!isArchived && progress < 100`
// IS the definition of the number EcosystemStats renders, so it belongs with the tile
// rather than at whichever page happens to call it.

export default function EcosystemStatStrip({
  programs,
  relationshipScores,
  now,
  openEscalationCount,
  activeInitiativeCount,
}: {
  programs: DashboardProject[];
  relationshipScores: (number | null)[];
  /** Snapshotted by the caller's Server Component so SSR and hydration agree. */
  now: number;
  openEscalationCount: number;
  activeInitiativeCount: number;
}) {
  const activeCount = programs.filter((p) => !p.isArchived && p.hillChartProgress < 100).length;

  return (
    <section className={styles.strip}>
      <EcosystemStats activeCount={activeCount} allTimeCount={programs.length} />
      <InitiativesStat count={activeInitiativeCount} />
      <SopRiskStat now={now} programs={programs} />
      <EscalationsStat count={openEscalationCount} />
      <RelationshipMix scores={relationshipScores} />
    </section>
  );
}
