import InitiativesClient from './InitiativesClient';
import { getInitiativesList } from '../../lib/initiativeQueries';
import { getLocale } from '../../lib/locale';

export const dynamic = 'force-dynamic';

export default async function InitiativesPage() {
  const locale = await getLocale();
  // Async Server Component: Date.now() runs once per request on the server — the
  // react-hooks purity rule assumes client re-render (same pattern as src/app/page.tsx).
  // eslint-disable-next-line react-hooks/purity
  const rows = await getInitiativesList(Date.now());
  return <InitiativesClient rows={rows} locale={locale} />;
}
