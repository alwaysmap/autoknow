import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
import { createMyProfile } from '../actions/people';
import { deriveEmail, normalizeHandle } from '../../lib/auth';
import { getCurrentUser } from '../../lib/session';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';

export const dynamic = 'force-dynamic';

// /me is a SHORTCUT: resolve the signed-in user (or the ?user= override) to their
// Person record and land on the one canonical person page. No second profile UI.

interface SearchParams {
  user?: string;
}

export default async function MePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const user = searchParams.user || (await getCurrentUser()).display;
  const locale = await getLocale();

  const userClean = normalizeHandle(user);
  const userEmail = deriveEmail(user);

  const person = await prisma.person.findFirst({
    where: {
      OR: [
        { email: { equals: userEmail, mode: 'insensitive' } },
        { name: { contains: userClean, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });

  if (person) {
    redirect(`/people/${person.id}`);
  }

  // No Person yet for this login — offer self-provisioning: the session supplies
  // name/email (Logins are identity; People are domain records); the user only
  // picks their organization. A Person without a login stays equally valid.
  const partners = await prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });

  return (
    <div style={{ padding: '40px', fontFamily: 'var(--body-font)' }}>
      <h1 style={{ fontFamily: 'var(--head-font)', fontSize: '1.5rem', margin: '0 0 10px' }}>{t(locale, 'navMe')}</h1>
      <p style={{ fontSize: 14, color: 'var(--muted)', maxWidth: '60ch', margin: '0 0 14px' }}>
        {t(locale, 'noProfileForUser', { u: user })}{' '}
        <Link href="/people" style={{ color: 'var(--p-600)' }}>{t(locale, 'peopleLabel')} →</Link>
      </p>
      <form action={createMyProfile} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {/* stub-mode override only; ignored when real auth is configured */}
        <input type="hidden" name="user" value={user} />
        <select name="partnerId" required defaultValue=""
          style={{ fontSize: 13, padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--paper)' }}>
          <option value="">{t(locale, 'selectPartner')}</option>
          {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button type="submit" data-testid="create-my-profile"
          style={{ fontSize: 13, fontWeight: 600, padding: '6px 14px', border: '1px solid var(--p-600)', borderRadius: 6, background: 'var(--p-600)', color: 'var(--paper)', cursor: 'pointer' }}>
          {t(locale, 'createMyProfile')}
        </button>
      </form>
    </div>
  );
}
