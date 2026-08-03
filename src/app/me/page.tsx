import Link from 'next/link';
import { prisma } from '../../lib/db';
import PersonProfile from '../people/[id]/PersonProfile';
import { createMyProfile } from '../actions/people';
import { deriveEmail, normalizeHandle } from '../../lib/auth';
import { getCurrentUser } from '../../lib/session';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import Combobox from '../../components/Combobox';
import { toComboboxOptions } from '../../lib/comboboxOptions';

export const dynamic = 'force-dynamic';

// /me is a REAL PAGE, not a shortcut: it resolves the signed-in user (or the ?user=
// override) to their Person record and RENDERS that person's page here, at /me.
//
// It used to redirect() to /people/:id, which threw its own address away the moment you
// arrived: the link you then copied was to yourself-as-a-row, and a row id is right only
// until that row is deleted and re-created, or until somebody else signs in on this
// machine. /me is the one address that survives both (design.md §2, autoknow-6q3). There
// is still no second profile UI — PersonProfile is the SAME component /people/:id renders.

interface SearchParams {
  user?: string;
}

export default async function MePage(props: { searchParams: Promise<SearchParams> }) {
  const searchParams = await props.searchParams;
  const me = await getCurrentUser();
  const override = searchParams.user;
  const user = override || me.display;

  const userClean = normalizeHandle(user);
  // The session's own email is authoritative and used VERBATIM. Going through
  // deriveEmail() here re-derived the address from the bare handle and so forced
  // the org default domain onto it — a real login of dylan@alwaysmap.com resolved
  // as dylan@google.com and landed on a DIFFERENT person. Only the ?user=
  // override (a handle typed by a human, stub mode) needs deriving.
  const userEmail = override ? deriveEmail(override) : me.email;

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
    return <PersonProfile personId={person.id} />;
  }

  // No Person yet for this login — offer self-provisioning: the session supplies
  // name/email (Logins are identity; People are domain records); the user only
  // picks their organization. A Person without a login stays equally valid.
  // The locale and the partner list belong to THIS branch only (PersonProfile reads its
  // own locale), so they are fetched here rather than above the person lookup.
  const locale = await getLocale();
  const partners = await prisma.partner.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } });

  return (
    <div style={{ padding: '2.5rem var(--page-gutter)', fontFamily: 'var(--body-font)' }}>
      <h1 style={{ fontFamily: 'var(--head-font)', fontSize: '1.5rem', margin: '0 0 0.625rem' }}>{t(locale, 'navMe')}</h1>
      <p style={{ fontSize: '0.875rem', color: 'var(--muted)', maxWidth: '60ch', margin: '0 0 0.875rem' }}>
        {t(locale, 'noProfileForUser', { u: user })}{' '}
        <Link href="/people" style={{ color: 'var(--link)' }}>{t(locale, 'peopleLabel')} →</Link>
      </p>
      <form action={createMyProfile} style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
        {/* stub-mode override only; ignored when real auth is configured */}
        <input type="hidden" name="user" value={user} />
        {/* No className: `Combobox` already applies the shared `dash.textInput` look, so
            passing it again would render the class twice and change nothing. The picker
            therefore does NOT match this form's hand-rolled inline styles — the rest of the
            page is still inline-styled, which is pre-existing and not this change's to
            sweep. */}
        <Combobox
          id="mePartner" name="partnerId"
          options={toComboboxOptions(partners)}
          emptyLabel={t(locale, 'selectPartner')}
          required
          aria-label={t(locale, 'organizationLabel')}
        />
        <button type="submit" data-testid="create-my-profile"
          style={{ fontSize: '0.8125rem', fontWeight: 600, padding: '0.375rem 0.875rem', border: '1px solid var(--p-600)', borderRadius: '0.375rem', background: 'var(--p-600)', color: 'var(--paper)', cursor: 'pointer' }}>
          {t(locale, 'createMyProfile')}
        </button>
      </form>
    </div>
  );
}
