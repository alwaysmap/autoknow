import { notFound } from 'next/navigation';
import PageShell from '../../../components/PageShell';
import AnchorHeading from '../../../components/AnchorHeading';
import DateCell from '../../../components/DateCell';
import EscalationRows from '../../../components/EscalationRows';
import { getInitiativeDetail, getAddablePartners } from '../../../lib/initiativeQueries';
import { getInitiativeEscalations } from '../../../lib/escalationQueries';
import { removePartner, linkDevice, unlinkDevice } from '../../actions/initiatives';
import InitiativeMembersTable from './InitiativeMembersTable';
import InitiativeAdminControls from './InitiativeAdminControls';
import AddPartnersTable from './AddPartnersTable';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// One initiative's page (gh-286 part e; owner calls 2026-08-08): the members as the
// shared DataTable — needle + little hill per partner, the same instruments every other
// surface uses — plus the edit kebab, add/remove membership, and the escalations raised
// about any member's copy (scoped in the model layer, rendered by the one condensed
// component). The initiative-scope AI summary is a named follow-up (autoknow-hcz.10);
// no placeholder pretends otherwise (lesson 5's honesty rule).
export default async function InitiativePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  const initiativeId = parseInt(id, 10);
  if (isNaN(initiativeId)) return notFound();
  const locale = await getLocale();
  // eslint-disable-next-line react-hooks/purity -- server request time, page.tsx pattern
  const now = Date.now();
  const initiative = await getInitiativeDetail(initiativeId, now);
  if (!initiative) return notFound();

  // Void wrapper for the row remove forms — `removePartner` returns an ActionResult
  // for dialog wiring, which a bare <form action> has no slot for. A refusal here is
  // logged by `guarded`; the row simply stays, which is the honest render of it.
  async function removePartnerAction(formData: FormData): Promise<void> {
    'use server';
    await removePartner(formData);
  }

  // Same void-wrapper shape for the Devices column's two forms (autoknow-hcz.14): a
  // refusal is logged by `guarded`, and the cell simply re-renders unchanged.
  async function linkDeviceAction(formData: FormData): Promise<void> {
    'use server';
    await linkDevice(formData);
  }
  async function unlinkDeviceAction(formData: FormData): Promise<void> {
    'use server';
    await unlinkDevice(formData);
  }

  // Candidates for the bulk-add table (part f): partners not already active members,
  // with type/region and the derived Products union (canonical rows — AGENTS lesson 3;
  // the action re-validates ids at the boundary).
  const addable = await getAddablePartners(initiative.id);

  const escalations = await getInitiativeEscalations(initiative.id);

  // The month-input shape for the edit dialog, from the stored date.
  const targetMonth = initiative.targetDate ? initiative.targetDate.slice(0, 7) : '';

  return (
    <PageShell
      title={initiative.name}
      maxWidth="70rem"
      actions={
        <InitiativeAdminControls
          initiativeId={initiative.id}
          templateId={initiative.templateId}
          name={initiative.name}
          description={initiative.description}
          targetMonth={targetMonth}
          locale={locale}
        />
      }
    >
      {initiative.description && <p className={styles.description}>{initiative.description}</p>}
      {/* One-line facts (design.md §7): label · value. */}
      <p className={styles.facts}>
        <span className={styles.factLabel}>{t(locale, 'initiativeTargetLabel')}</span>{' '}
        <DateCell value={initiative.targetDate} />
        <span className={styles.factSep} aria-hidden>·</span>
        <span className={styles.factLabel}>{t(locale, 'initiativeColPartners')}</span>{' '}
        {initiative.rollup.total}
      </p>

      <section className={styles.section}>
        <AnchorHeading id="partners">{t(locale, 'initiativeMembersHeading')}</AnchorHeading>
        <InitiativeMembersTable
          initiativeId={initiative.id}
          members={initiative.members}
          locale={locale}
          removeAction={removePartnerAction}
          linkAction={linkDeviceAction}
          unlinkAction={unlinkDeviceAction}
        />
      </section>

      {/* Bulk add via filters (part f). The section only exists while there is
          somebody left to add — a heading over an empty table is noise (§7). */}
      {addable.length > 0 && (
        <section className={styles.section}>
          <AnchorHeading id="add-partners">{t(locale, 'initiativeAddPartnersHeading')}</AnchorHeading>
          <AddPartnersTable initiativeId={initiative.id} partners={addable} locale={locale} />
        </section>
      )}

      <section className={styles.section}>
        <AnchorHeading id="escalations">{t(locale, 'escalationsLabel')}</AnchorHeading>
        <EscalationRows escalations={escalations} locale={locale} />
      </section>
    </PageShell>
  );
}
