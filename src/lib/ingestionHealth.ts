import 'server-only';
import { prisma } from './db';
import type { DriveSyncReport } from './driveSync';
import type { CycleReport } from './refresh';
import { getIngestionSettings } from './ingestionSettings';
import { budgetGauge, type BudgetGauge } from './ingestBudget';

// Ingestion health (#38, [ADR: Ingestion health is a serverless signal, not a growing
// table]). Two halves of ONE decision:
//
//  1. `recordCycle` emits the cron's reports as a STRUCTURED LOG (the canonical, serverless
//     telemetry store — Cloud Logging, no DB history table) AND upserts a single bounded
//     latest-cycle summary the in-app health card reads. The log carries backlog at a
//     stable jsonPayload path so the Cloud Monitoring log-based metric + drain alarm read
//     it without any database growth.
//  2. `getIngestionHealth` reads that bounded state — the one summary row + the live
//     "shared but not ingested" set — for Manage → Sources. O(1) and O(corpus), never
//     O(time).

const SUMMARY_KEY = 'latest';

/** Emit the structured telemetry log and upsert the bounded latest-cycle summary. */
export async function recordCycle(drive: DriveSyncReport, web: CycleReport): Promise<void> {
  const backlog = drive.backlog + web.backlog;
  const quotaStopped = drive.quotaStopped || web.quotaStopped;

  // Structured log → Cloud Logging jsonPayload. `ingestionCycle.backlog` is the stable
  // field the log-based metric + drain alarm filter on; `severity` colours the entry so a
  // sustained backlog is visible in the console too. This is the whole time-series — the
  // DB keeps only the latest row.
  console.log(
    JSON.stringify({
      message: 'ingestion.cycle',
      severity: quotaStopped ? 'ERROR' : backlog > 0 ? 'WARNING' : 'INFO',
      ingestionCycle: { backlog, quotaStopped, drive, web },
    }),
  );

  await prisma.ingestionCycleSummary.upsert({
    where: { key: SUMMARY_KEY },
    update: {
      ranAt: new Date(),
      driveConfigured: drive.configured,
      sharedSeen: drive.sharedSeen,
      discovered: drive.discovered,
      refreshed: drive.refreshed,
      skippedOtherTypes: drive.skippedOtherTypes,
      skippedTooDeep: drive.skippedTooDeep,
      driveErrors: drive.errors,
      due: web.due,
      checked: web.checked,
      changed: web.changed,
      frozen: web.frozen,
      errors: web.errors,
      skippedDrive: web.skippedDrive,
      backlog,
      quotaStopped,
    },
    create: {
      key: SUMMARY_KEY,
      driveConfigured: drive.configured,
      sharedSeen: drive.sharedSeen,
      discovered: drive.discovered,
      refreshed: drive.refreshed,
      skippedOtherTypes: drive.skippedOtherTypes,
      skippedTooDeep: drive.skippedTooDeep,
      driveErrors: drive.errors,
      due: web.due,
      checked: web.checked,
      changed: web.changed,
      frozen: web.frozen,
      errors: web.errors,
      skippedDrive: web.skippedDrive,
      backlog,
      quotaStopped,
    },
  });
}

export interface SkippedSourceView {
  fileId: string;
  name: string;
  mimeType: string;
  reason: string;
  sharedBy: string | null;
  folderDepth: number | null;
  firstSeenAt: Date;
}

export interface IngestionHealth {
  summary: {
    ranAt: Date;
    driveConfigured: boolean;
    discovered: number;
    refreshed: number;
    skippedOtherTypes: number;
    skippedTooDeep: number;
    checked: number;
    changed: number;
    frozen: number;
    errors: number;
    driveErrors: number;
    backlog: number;
    quotaStopped: boolean;
  } | null;
  skipped: SkippedSourceView[];
  budget: { dailyReingestBudgetDocs: number; freeTierRequestsPerDay: number };
  gauge: BudgetGauge;
}

/** Everything Manage → Sources needs to render the health card, skip list, and budget
 *  slider — bounded reads only (one summary row + the currently-skipped set). */
export async function getIngestionHealth(): Promise<IngestionHealth> {
  const [summary, skippedRows, settings] = await Promise.all([
    prisma.ingestionCycleSummary.findUnique({ where: { key: SUMMARY_KEY } }),
    prisma.skippedSource.findMany({ orderBy: [{ reason: 'asc' }, { name: 'asc' }] }),
    getIngestionSettings(),
  ]);

  return {
    summary: summary
      ? {
          ranAt: summary.ranAt,
          driveConfigured: summary.driveConfigured,
          discovered: summary.discovered,
          refreshed: summary.refreshed,
          skippedOtherTypes: summary.skippedOtherTypes,
          skippedTooDeep: summary.skippedTooDeep,
          checked: summary.checked,
          changed: summary.changed,
          frozen: summary.frozen,
          errors: summary.errors,
          driveErrors: summary.driveErrors,
          backlog: summary.backlog,
          quotaStopped: summary.quotaStopped,
        }
      : null,
    skipped: skippedRows.map((r) => ({
      fileId: r.fileId,
      name: r.name,
      mimeType: r.mimeType,
      reason: r.reason,
      sharedBy: r.sharedBy,
      folderDepth: r.folderDepth,
      firstSeenAt: r.firstSeenAt,
    })),
    budget: settings,
    gauge: budgetGauge(settings.dailyReingestBudgetDocs, settings.freeTierRequestsPerDay),
  };
}
