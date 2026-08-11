import { redirect } from 'next/navigation';
import Combobox from '../../../components/Combobox';
import { toComboboxOptions } from '../../../lib/comboboxOptions';
import { prisma } from '../../../lib/db';
import { listTemplates } from '../../../lib/programTemplates';
import { createProgramFromTemplate } from '../../../lib/createProgramFromTemplate';
import { parseSopInput } from '../../../lib/sop';
import { requireOwner } from '../../../lib/owner';
import { getCurrentUser } from '../../../lib/session';
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

  const templateId = parseInt(templateIdStr, 10);
  if (isNaN(templateId)) {
    throw new Error('Invalid template');
  }
  const partnerId = parseInt(partnerIdStr, 10);
  if (isNaN(partnerId)) {
    throw new Error('Invalid partner');
  }

  // This form's POLICY ends here (owner and SOP required, ints parsed); the mechanics —
  // template/DAG validation, role resolution, the atomic phase-graph write, search
  // indexing — live in lib/createProgramFromTemplate, so a second caller can set its
  // own policy (gh-286).
  const createdBy = (await getCurrentUser()).handle;
  const project = await createProgramFromTemplate({
    name,
    partnerId,
    templateId,
    owner,
    sopDate,
    products: { hasGas, hasGbi, hasDigitalKey, hasAap },
    createdBy,
  });

  // Redirect after createProgramFromTemplate's transaction has committed — redirect
  // throws, so it must never run inside one.
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
  // `?? ''` on the true branch as well: TypeScript cannot narrow `partnerIdParam` through
  // the `.some()` above, so without it the type stays `string | undefined` and every
  // consumer has to launder it. It is a string either way — a `String()` at the call site
  // would convert nothing and tell the next reader this is a numeric id.
  const preselectedPartnerId = partners.some((p) => String(p.id) === partnerIdParam)
    ? partnerIdParam ?? ''
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
            <label data-eyebrow htmlFor="name">{t(locale, 'projectNameHeader')}</label>
            <input
              type="text"
              id="name"
              name="name"
              required
              placeholder={t(locale, 'projectNamePlaceholder')}
            />
          </div>

          <div className={styles.field}>
            <label data-eyebrow htmlFor="partnerId">{t(locale, 'partnerOemSupplier')}</label>
            {/* Mapped inline rather than through `toComboboxOptions`: the label carries the
                partner's TYPE, which is how a reader tells two similarly named OEMs and
                suppliers apart when typing. */}
            <Combobox
              id="partnerId" name="partnerId"
              options={partners.map((p) => ({ value: String(p.id), label: `${p.name} (${p.type?.name})` }))}
              defaultValue={preselectedPartnerId}
              emptyLabel={t(locale, 'selectAPartner')}
              required
              aria-label={t(locale, 'partnerOemSupplier')}
            />
          </div>

          <div className={styles.field}>
            <label data-eyebrow htmlFor="template">{t(locale, 'projectTemplateDag')}</label>
            {/* Templates are user-authored and grow with the business, so they meet the
                same unbounded-by-construction test as the entity pickers, and that rule is
                about growth rather than today's count (docs/adr/2026-08-02-a-type-to-filter-
                picker-is-for-lists-unbounded-by-construction.md). Not in autoknow-wak's list; converted
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
            <label data-eyebrow htmlFor="owner">{t(locale, 'googlerOwner')}</label>
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
            <label data-eyebrow htmlFor="sopMonth">{t(locale, 'sopMonthLabel')}</label>
            <input type="month" id="sopMonth" name="sopMonth" required />
          </div>

          <div className={styles.field}>
            {/* The GROUP label is the eyebrow; option wording is CONTENT (§7b), so the
                option rows take the same plain treatment as this control's twin in
                ProjectMetaHeader's edit dialog — keep the two in step. */}
            <span data-eyebrow>{t(locale, 'productsLabel')}</span>
            <label style={{ display: 'block', fontSize: '0.8125rem' }}>
              <input type="checkbox" name="hasGas" /> {t(locale, 'productGas')}
            </label>
            <label style={{ display: 'block', fontSize: '0.8125rem' }}>
              <input type="checkbox" name="hasGbi" /> {t(locale, 'productGbi')}
            </label>
            <label style={{ display: 'block', fontSize: '0.8125rem' }}>
              <input type="checkbox" name="hasDigitalKey" /> {t(locale, 'productDigitalKey')}
            </label>
            <label style={{ display: 'block', fontSize: '0.8125rem' }}>
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
