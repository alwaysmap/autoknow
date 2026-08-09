import PageShell from '../../../components/PageShell';
import { toComboboxOptions } from '../../../lib/comboboxOptions';
import { listTemplates } from '../../../lib/programTemplates';
import { prisma } from '../../../lib/db';
import CreateInitiativeForm from './CreateInitiativeForm';
import { getLocale } from '../../../lib/locale';
import { t } from '../../../lib/i18n';

export const dynamic = 'force-dynamic';

// Create an initiative (gh-286 part d), mirroring /programs/new. Target month is
// optional (decision 4) and month-end like the program SOP field; per-partner dates are
// set (or defaulted) when partners are added, not here.
export default async function NewInitiativePage() {
  const locale = await getLocale();
  const templates = await listTemplates(); // seeds built-ins; snapshots already hidden
  const partners = await prisma.partner.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } });

  return (
    <PageShell title={t(locale, 'newInitiativeTitle')} maxWidth="40rem">
      <CreateInitiativeForm templates={toComboboxOptions(templates)} partners={toComboboxOptions(partners)} locale={locale} />
    </PageShell>
  );
}
