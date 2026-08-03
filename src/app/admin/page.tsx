import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import PageShell from '../../components/PageShell';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

// One origin line, then the same command everywhere: these used to hard-code
// http://localhost:3000, which is the one environment where the endpoint's auth is a
// no-op — so the copy-pasted command was never exercised where it could fail (#157).
const ORIGIN_LINE = `ORIGIN=https://autoknow.alwaysmap.com   # local dev: http://localhost:3000`;

const CURL_COMMAND_1 = `${ORIGIN_LINE}
curl -X POST "$ORIGIN/api/integrations/chat" \\
  -H "Content-Type: application/json" \\
  -H "x-admin-token: $ADMIN_TOKEN" \\
  -d '{
    "sender": "@dylan",
    "message": "@autoknow status update for \\"Ford Evos AAOS Bring-up\\": BSP & power-on is green. Audio HAL integration is blocked due to delayed codec samples from supplier."
  }'`;

const CURL_COMMAND_2 = `${ORIGIN_LINE}
curl -X POST "$ORIGIN/api/integrations/chat" \\
  -H "Content-Type: application/json" \\
  -H "x-admin-token: $ADMIN_TOKEN" \\
  -d '{
    "sender": "@dylan",
    "message": "@autoknow assign @unassigned to check cause for VHAL wait time on Ford Evos AAOS Bring-up"
  }'`;

import { wipeAllData as libWipeAllData, seedCoreData as libSeedCoreData, seedMockData as libSeedMockData } from '../../lib/seed';
import AnchorHeading from '../../components/AnchorHeading';

async function seedMockData() {
  'use server';
  await libSeedMockData();
  revalidatePath('/');
  revalidatePath('/ecosystem');
  redirect('/ecosystem');
}

async function seedCoreData() {
  'use server';
  await libSeedCoreData();
  revalidatePath('/');
  revalidatePath('/ecosystem');
  redirect('/ecosystem');
}

async function wipeAllData() {
  'use server';
  await libWipeAllData();
  revalidatePath('/');
  revalidatePath('/ecosystem');
  redirect('/ecosystem');
}

export default async function AdminPage() {
  const locale = await getLocale();
  return (
    <PageShell
      title={t(locale, 'navDevConsole')}
      maxWidth="75rem"
      subtitle={t(locale, 'adminSubtext')}
    >
      <div className={styles.grid}>
        <div className={styles.card}>
          <h3>{t(locale, 'onboardingMode')}</h3>
          <p>{t(locale, 'seedMockDesc')}</p>
          <form action={seedMockData}>
            <button type="submit" className={styles.primaryButton}>{t(locale, 'seedMockData')}</button>
          </form>
        </div>

        <div className={styles.card}>
          <h3>{t(locale, 'seedCoreHeading')}</h3>
          <p>{t(locale, 'seedCoreDesc')}</p>
          <form action={seedCoreData}>
            <button type="submit" className={styles.secondaryButton}>{t(locale, 'seedCoreData')}</button>
          </form>
        </div>

        <div className={styles.card}>
          <h3>{t(locale, 'wipeAllHeading')}</h3>
          <p>{t(locale, 'wipeAllDesc')}</p>
          <form action={wipeAllData}>
            <button type="submit" className={styles.dangerButton}>{t(locale, 'wipeAllData')}</button>
          </form>
        </div>
      </div>

      {/* Simulation & Integrations Help */}
      <section className={styles.helpSection}>
        <AnchorHeading id="simulate-chat">
          {t(locale, 'simulateChatHeading')}
        </AnchorHeading>
        <p className={styles.helpIntro}>
          {t(locale, 'adminHelpIntro1')} <code>curl</code> {t(locale, 'adminHelpIntro2')} <code>/api/integrations/chat</code>).
        </p>

        <div className={styles.codeBlockContainer}>
          <div className={styles.codeHeader}>
            <span>{t(locale, 'curlExample1')}</span>
          </div>
          <pre className={styles.pre}>{CURL_COMMAND_1}</pre>
        </div>

        <div className={styles.codeBlockContainer}>
          <div className={styles.codeHeader}>
            <span>{t(locale, 'curlExample2')}</span>
          </div>
          <pre className={styles.pre}>{CURL_COMMAND_2}</pre>
        </div>
      </section>
    </PageShell>
  );
}
