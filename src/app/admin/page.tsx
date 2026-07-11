import { prisma } from '../../lib/db';
import { ingestRecord } from '../../lib/vector';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import styles from './page.module.css';

export const dynamic = 'force-dynamic';

const CURL_COMMAND_1 = `curl -X POST http://localhost:3000/api/integrations/chat \\
  -H "Content-Type: application/json" \\
  -d '{
    "sender": "@dylan",
    "message": "@autoknow status update for \\"Ford Evos AAOS Bring-up\\": BSP & power-on is green. Audio HAL integration is blocked due to delayed codec samples from supplier."
  }'`;

const CURL_COMMAND_2 = `curl -X POST http://localhost:3000/api/integrations/chat \\
  -H "Content-Type: application/json" \\
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
  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1>Dev Console</h1>
        <p className={styles.subtext}>Manage test states, seed empty onboarding dashboards, and test webhook endpoints.</p>
      </header>

      <div className={styles.grid}>
        <div className={styles.card}>
          <h3>🚀 Onboarding Mode (Seed Mock Data)</h3>
          <p>Populates the database with full partner accounts, projects, templates, action items, and status feeds. Perfect for walkthroughs and E2E validation.</p>
          <form action={seedMockData}>
            <button type="submit" className={styles.primaryButton}>Seed Mock Data</button>
          </form>
        </div>

        <div className={styles.card}>
          <h3>🌱 Seed Core Data</h3>
          <p>Seeds baseline production lookup data (e.g. Regions, Partner Types, Google LLC). Use this to start with a fresh app that is ready for manual data entry.</p>
          <form action={seedCoreData}>
            <button type="submit" className={styles.secondaryButton}>Seed Core Data</button>
          </form>
        </div>

        <div className={styles.card}>
          <h3>🗑 Wipe All (Clean Slate)</h3>
          <p>Completely clears all records from the database. Zero rows across all tables. Good for validation of absolute raw empty states.</p>
          <form action={wipeAllData}>
            <button type="submit" className={styles.dangerButton}>Wipe All Data</button>
          </form>
        </div>
      </div>

      {/* Simulation & Integrations Help */}
      <section className={styles.helpSection}>
        <h2>Simulate Chat Integrations &amp; Webhooks</h2>
        <p className={styles.helpIntro}>
          Use the following <code>curl</code> commands to test or simulate incoming status updates and triggers from external applications like Google Chat (webhook receiver is at <code>/api/integrations/chat</code>).
        </p>

        <div className={styles.codeBlockContainer}>
          <div className={styles.codeHeader}>
            <span>1. Post a Status Update / Blocker trigger</span>
          </div>
          <pre className={styles.pre}>{CURL_COMMAND_1}</pre>
        </div>

        <div className={styles.codeBlockContainer}>
          <div className={styles.codeHeader}>
            <span>2. Assign Owner / Action Item update</span>
          </div>
          <pre className={styles.pre}>{CURL_COMMAND_2}</pre>
        </div>
      </section>
    </div>
  );
}
