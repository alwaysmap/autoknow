import { redirect } from 'next/navigation';
import Combobox from '../../../components/Combobox';
import { toComboboxOptions } from '../../../lib/comboboxOptions';
import { prisma } from '../../../lib/db';
import { listTemplates, getTemplateWithPhases } from '../../../lib/programTemplates';
import { validateTemplateDag } from '../../../lib/templateDag';
import { parseSopInput } from '../../../lib/sop';
import { requireOwner } from '../../../lib/owner';
import { getCurrentUser } from '../../../lib/session';
import { indexEntity } from '../../../lib/search';
import { hillStatus } from '../../../lib/phase';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';
import styles from './page.module.css';

// This page reads partners from the database at request time, so it must render
// dynamically rather than being statically prerendered at build (which has no DB).
export const dynamic = 'force-dynamic';

async function createProject(formData: FormData) {
  'use server';

  const name = formData.get('name') as string;
  const partnerIdStr = formData.get('partnerId') as string;
  const templateIdStr = formData.get('template') as string;
  const ownerInput = ((formData.get('owner') as string) || '').trim();
  if (!ownerInput) throw new Error('An assigned Googler (owner) is required');
  // The owner must be an existing Person (picked, not typed) — canonical email AND id.
  const owner = await requireOwner(ownerInput);
  // Every program MUST carry a target SOP (month/year; last day of month assumed).
  const sopDate = parseSopInput((formData.get('sopMonth') as string) || '');
  const hasGas = formData.get('hasGas') === 'on';
  const hasGbi = formData.get('hasGbi') === 'on';
  const hasDigitalKey = formData.get('hasDigitalKey') === 'on';
  const hasAap = formData.get('hasAap') === 'on';

  if (!name || !partnerIdStr || !templateIdStr || !sopDate) {
    throw new Error('Missing fields');
  }

  // Templates live in the database (PHASE_TEMPLATES_PLAN §7). Validate up front so an
  // unexpected value can't silently create a project with zero phases.
  const templateId = parseInt(templateIdStr, 10);
  const template = isNaN(templateId) ? null : await getTemplateWithPhases(templateId);
  if (!template || template.phases.length === 0) {
    throw new Error(`Unknown project template: ${templateIdStr}`);
  }

  // The template must still be a valid converging DAG at instantiation time.
  const validation = validateTemplateDag(
    template.phases.map((p) => ({ id: p.id, isEndPhase: p.isEndPhase, name: p.name })),
    template.phases.flatMap((p) => p.dependsOn.map((d) => ({ nodeId: p.id, dependsOnId: d.dependsOnId }))),
  );
  if (!validation.ok) {
    throw new Error(`Template “${template.name}” is invalid: ${validation.errors.map((e) => e.message).join(' ')}`);
  }

  const partnerId = parseInt(partnerIdStr, 10);
  if (isNaN(partnerId)) {
    throw new Error('Invalid partner');
  }

  // leadRole → concrete partner, only where unambiguous: "OEM" maps to the program's
  // partner when that partner IS an OEM; anything else is left for the user.
  const programPartner = await prisma.partner.findUnique({ where: { id: partnerId }, include: { type: true } });
  const leadPartnerFor = (leadRole: string | null) =>
    leadRole === 'OEM' && programPartner?.type?.name === 'OEM' ? programPartner.id : null;

  const firstPhaseName = template.phases[0]?.name;

  // Create the project and its full phase graph atomically — a failure partway
  // through must not leave a half-built project.
  const createdBy = (await getCurrentUser()).handle;

  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { name, partnerId, ...owner, sopDate, hasGas, hasGbi, hasDigitalKey, hasAap }
    });

    // Log program creation so it appears in the activity feed.
    await tx.projectState.create({
      data: { projectId: created.id, theNeedle: 'On Track', hillChartProgress: 0, notes: 'Program created', source: createdBy },
    });

    const phasesMap: Record<number, { id: number }> = {};

    for (const p of template.phases) {
      const phase = await tx.phase.create({
        data: {
          name: p.name,
          projectId: created.id,
          forecastedDuration: p.durationWeeks * 7, // templates store weeks; runtime stays days
          description: p.description,
          googleFocus: p.googleFocus,
          isEndPhase: p.isEndPhase,
          leadPartnerId: leadPartnerFor(p.leadRole),
        }
      });
      phasesMap[p.id] = phase;

      // Status is derived from the dot's position on the hill — never chosen directly.
      const initialProgress = p.name === firstPhaseName ? 10 : 0;
      await tx.phaseState.create({
        data: {
          phaseId: phase.id,
          status: hillStatus(initialProgress),
          hillChartProgress: initialProgress,
          theNeedle: 'On Track'
        }
      });

      // No `owner &&` guard: it was already dead — an empty input is rejected above and
      // requireOwner throws rather than returning nothing.
      if (p.name === firstPhaseName) {
        await tx.actionItem.create({
          data: {
            phaseId: phase.id,
            description: `Initial bring-up action for ${p.name}`,
            // The assignee columns are the same pair as the owner's, so fill BOTH —
            // this path had been writing the text alone, which is the defect #127 E6
            // is closing one model over (AGENTS lesson 7).
            assignedTo: owner.ownerName,
            assignedToPersonId: owner.ownerPersonId,
            status: 'Pending'
          }
        });
      }
    }

    for (const p of template.phases) {
      const phase = phasesMap[p.id];
      for (const dep of p.dependsOn) {
        const depPhase = phasesMap[dep.dependsOnId];
        if (depPhase) {
          await tx.phaseDependency.create({
            data: {
              phaseId: phase.id,
              dependsOnPhaseId: depPhase.id
            }
          });
        }
      }
    }

    return created;
  });

  await indexEntity('program', project.id);

  // Redirect to project details page (outside the transaction).
  redirect(`/programs/${project.id}`);
}

export default async function NewProjectPage(props: {
  // ?partnerId= pre-selects the partner — set when the flow is entered from a
  // partner's own page (its Programs section), so the OEM is already filled in.
  searchParams: Promise<{ partnerId?: string }>;
}) {
  const locale = await getLocale();
  const { partnerId: partnerIdParam } = await props.searchParams;
  const partners = await prisma.partner.findMany({
    orderBy: { name: 'asc' },
    include: { type: true }
  });
  // Only honour the deep link when it names a real partner; anything else falls
  // back to the "Select a partner…" placeholder rather than a dangling value.
  const preselectedPartnerId = partners.some((p) => String(p.id) === partnerIdParam)
    ? partnerIdParam
    : '';
  // Owner is picked from existing people, never typed freeform.
  const people = await prisma.person.findMany({
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' }
  });
  const templates = await listTemplates(); // seeds built-ins on first touch

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.brand}>AutoKnow</div>
        <h1>{t(locale, 'createNewProject')}</h1>
      </header>

      <main className={styles.main}>
        <form action={createProject} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="name">{t(locale, 'projectNameHeader')}</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              placeholder={t(locale, 'projectNamePlaceholder')}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="partnerId">{t(locale, 'partnerOemSupplier')}</label>
            {/* Mapped inline rather than through `toComboboxOptions`: the label carries the
                partner's TYPE, which is how a reader tells two similarly named OEMs and
                suppliers apart when typing. */}
            <Combobox
              id="partnerId" name="partnerId"
              options={partners.map((p) => ({ value: String(p.id), label: `${p.name} (${p.type?.name})` }))}
              defaultValue={preselectedPartnerId ? String(preselectedPartnerId) : ''}
              emptyLabel={t(locale, 'selectAPartner')}
              required
              aria-label={t(locale, 'partnerOemSupplier')}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="template">{t(locale, 'projectTemplateDag')}</label>
            {/* Templates are user-authored and grow with the business, so they meet the
                same unbounded-by-construction test as the entity pickers — the ADR's rule
                is about growth, not today's count. Not in autoknow-wak's list; converted
                here rather than left as a sixth instance for a third pass (lesson 7). */}
            <Combobox
              id="template" name="template"
              options={toComboboxOptions(templates)}
              emptyLabel={t(locale, 'selectATemplate')}
              required
              aria-label={t(locale, 'projectTemplateDag')}
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="owner">{t(locale, 'googlerOwner')}</label>
            {/* The committed value is the ADDRESS, not the row id — the same write contract
                as `ProjectMetaHeader`'s owner picker (`requireOwner` resolves the address),
                which is why this maps inline instead of through `toComboboxOptions`. */}
            <Combobox
              id="owner" name="owner"
              options={people.map((p) => ({ value: p.email, label: `${p.name} (${p.email})` }))}
              emptyLabel={t(locale, 'selectAPerson')}
              required
              aria-label={t(locale, 'googlerOwner')}
            />
          </div>

          {/* the SOP target is REQUIRED — it is the on-track yardstick and places the
              program on the ecosystem capacity timeline (month-end assumed) */}
          <div className={styles.field}>
            <label htmlFor="sopMonth">{t(locale, 'sopMonthLabel')}</label>
            <input type="month" id="sopMonth" name="sopMonth" required />
          </div>

          <div className={styles.field}>
            <label>{t(locale, 'productsLabel')}</label>
            <label style={{ display: 'block', fontWeight: 400 }}>
              <input type="checkbox" name="hasGas" /> {t(locale, 'productGas')}
            </label>
            <label style={{ display: 'block', fontWeight: 400 }}>
              <input type="checkbox" name="hasGbi" /> {t(locale, 'productGbi')}
            </label>
            <label style={{ display: 'block', fontWeight: 400 }}>
              <input type="checkbox" name="hasDigitalKey" /> {t(locale, 'productDigitalKey')}
            </label>
            <label style={{ display: 'block', fontWeight: 400 }}>
              <input type="checkbox" name="hasAap" /> {t(locale, 'productAap')}
            </label>
          </div>

          <div className={styles.actions}>
            <button type="submit" className={styles.submitBtn}>
              {t(locale, 'createProject')}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
