import { prisma } from '../../lib/db';
import { ingestRecord } from '../../lib/vector';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocale } from '../../lib/locale';
import { t } from '../../lib/i18n';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const CURL_COMMAND_1 = `curl -X POST http://localhost:3000/api/integrations/chat \\
  -H "Content-Type: application/json" \\
  -H "x-admin-token: $ADMIN_TOKEN" \\
  -d '{
    "sender": "@dylan",
    "message": "@autoknow status update for \\"Ford Evos AAOS Bring-up\\": BSP & power-on is green. Audio HAL integration is blocked due to delayed codec samples from supplier."
  }'`;

const CURL_COMMAND_2 = `curl -X POST http://localhost:3000/api/integrations/chat \\
  -H "Content-Type: application/json" \\
  -H "x-admin-token: $ADMIN_TOKEN" \\
  -d '{
    "sender": "@dylan",
    "message": "@autoknow assign @unassigned to check cause for VHAL wait time on Ford Evos AAOS Bring-up"
  }'`;

import { wipeAllData as libWipeAllData, seedCoreData as libSeedCoreData, seedMockData as libSeedMockData } from '../../lib/seed';

async function seedMockData() {
  'use server';
  await libSeedMockData();
  revalidatePath('/');
  redirect('/');
}

async function seedCoreData() {
  'use server';
  await libSeedCoreData();
  revalidatePath('/');
  redirect('/');
}

async function wipeAllData() {
  'use server';
  await libWipeAllData();
  revalidatePath('/');
  redirect('/');
}

export default async function AdminPage() {
  const locale = await getLocale();
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>{t(locale, 'navDevConsole')}</h1>
        <p className={styles.subtext}>{t(locale, 'adminSubtext')}</p>
      </header>

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
        <h2>{t(locale, 'simulateChatHeading')}</h2>
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
    </div>
  );
}
