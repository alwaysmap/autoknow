import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '../../lib/db';
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

  // Honest empty state: no Person record matches this identity yet.
  return (
    <div style={{ padding: '40px', fontFamily: 'var(--body-font)' }}>
      <h1 style={{ fontFamily: 'var(--head-font)', fontSize: '1.5rem', margin: '0 0 10px' }}>{t(locale, 'navMe')}</h1>
      <p style={{ fontSize: 14, color: 'var(--muted)', maxWidth: '60ch' }}>
        {t(locale, 'noProfileForUser', { u: user })}{' '}
        <Link href="/people" style={{ color: 'var(--p-600)' }}>{t(locale, 'peopleLabel')} →</Link>
      </p>
    </div>
  );
}
