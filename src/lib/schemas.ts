import { z } from 'zod';

// Central runtime validation for mutation boundaries — API routes and server
// actions. The Prisma schema is the LAST line of defense; these are the first:
// malformed input becomes a 400 / readable error instead of a 500, and they
// encode invariants the database can't express (trimmed non-empty notes, the
// 1..5 score range, health labels). Client-safe: zod only, no Node imports.

// ---- primitives -----------------------------------------------------------------

/** Positive integer id; accepts numeric strings (form fields, JSON). */
export const zId = z.coerce.number().int().positive();

/** Required trimmed text. */
export const zText = z.string().trim().min(1);

/** Optional text: '', null, undefined all normalize to null. */
export const zTextOrNull = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().max(20_000).nullish().transform((v) => v ?? null),
);

/** Optional http(s) URL: '', null, undefined normalize to null. */
export const zUrlOrNull = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.url({ protocol: /^https?$/ }).nullish().transform((v) => v ?? null),
);

/** Optional id: '', null, undefined normalize to null. */
export const zIdOrNull = z.preprocess(
  (v) => (v === '' || v == null ? null : v),
  zId.nullable(),
);

// ---- partner --------------------------------------------------------------------

/** Partner create/update via the in-app form (server action). Region is part of a
 *  partner's identity — required here AND at the database (Partner.regionId). */
export const partnerFieldsSchema = z.object({
  name: zText.max(200),
  typeId: zIdOrNull,
  regionId: zId, // required
  website: zUrlOrNull,
  internalDetailsUrl: zUrlOrNull,
  summary: zTextOrNull,
});

/** Partner create via the JSON API: type/region arrive as NAMES and are resolved
 *  to ids by the route (unknown names are a 400, never a silent null). */
export const partnerApiSchema = z.object({
  name: zText.max(200),
  type: zText.max(100),
  region: zText.max(100),
  website: zUrlOrNull.optional(),
  internalDetailsUrl: zUrlOrNull.optional(),
  summary: zTextOrNull.optional(),
});

// ---- relationship ---------------------------------------------------------------

/** A relationship update is a 1..5 score plus its written note — both required
 *  (PartnerState.notes is non-null in the database too). */
export const relationshipUpdateSchema = z.object({
  partnerId: zId,
  score: z.coerce.number().int().min(1).max(5),
  notes: zText.max(20_000),
});

// ---- program / partner status (the needle dialog) -------------------------------

export const statusUpdateSchema = z.object({
  scope: z.enum(['project', 'partner']),
  targetId: zId,
  /** Raw label; the action still maps legacy risk values via parseHealth. */
  theNeedle: zText.max(40),
  /** Every status update carries its note (dialogs require one). */
  notes: zText.max(20_000),
  hillChartProgress: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.number().int().min(0).max(100).nullable(),
  ),
});

// ---- person maintenance (server actions) ----------------------------------------

export const personMoveSchema = z.object({
  personId: zId,
  newPartnerId: zId,
  newRole: zText.max(100),
  startDate: z.coerce.date(),
});

export const personCopySchema = z.object({
  personId: zId,
  copyEmail: z.email(),
});

export const personDeleteSchema = z.object({
  personId: zId,
});

// ---- person creation & assignment ------------------------------------------------

/** Person records are creatable by any login; a Person needs no Login (partner-side
 *  contacts), and a Login needs no Person until they claim one (/me). */
export const personCreateSchema = z.object({
  name: zText.max(200),
  email: z.email(),
  partnerId: zId,
  role: zTextOrNull,
});

/** Self/any assignment onto a phase (program derives from the phase). */
export const phaseAssignSchema = z.object({
  personId: zId,
  projectId: zId,
  phaseId: zId,
  role: zTextOrNull,
});

// ---- program lifecycle ----------------------------------------------------------

export const projectLifecycleSchema = z.object({
  projectId: zId,
  lifecycle: z.enum(['active', 'complete', 'cancelled']),
});

// ---- people / projects (JSON API) -----------------------------------------------

export const personApiSchema = z.object({
  name: zText.max(200),
  email: z.email(),
  currentPartnerId: zId,
  notes: zTextOrNull.optional(),
});

export const projectApiSchema = z.object({
  name: zText.max(300),
  partnerId: zId,
  ownerName: zTextOrNull.optional(),
  sopDate: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.date().nullable(),
  ).optional(),
  volumeFirstYear: z.coerce.number().int().min(0).optional(),
});

// ---- nested phase routes (JSON API) ---------------------------------------------

/** Seed/test-only backdate for history-writing routes: '', null, undefined all mean
 *  "stamp at write time". Routes that honor it MUST refuse unless the target DB
 *  passes lib/dbSafety's destructive-allowed check — dated history is a seeding
 *  affordance (docs/CRITICAL_CHAIN_VIEW_PLAN.md §6), never a live-data feature. */
const zSeedTimestamp = z.preprocess(
  (v) => (v === '' || v == null ? undefined : v),
  z.coerce.date().optional(),
);

export const phaseCreateApiSchema = z.object({
  name: zText.max(200),
  forecastedDuration: z.coerce.number().int().positive().max(3650).optional(),
  /** Backdates the phase's auto-created initial "Not Started" state (guarded). */
  stateTimestamp: zSeedTimestamp,
});

/** Progress/needle/notes update; every field optional — the route preserves the
 *  latest recorded progress when the dot isn't being moved. */
export const phaseStateApiSchema = z.object({
  theNeedle: zTextOrNull.optional(),
  hillChartProgress: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    z.coerce.number().int().min(0).max(100).optional(),
  ),
  notes: zTextOrNull.optional(),
  source: zTextOrNull.optional(),
  sourceUrl: zUrlOrNull.optional(),
  /** Backdates the created state row (guarded; shared by the phase-state and
   *  needle routes, which both append history through this schema). */
  timestamp: zSeedTimestamp,
});

/** status/nextStep are closed enums: summaries filter on exactly 'Pending', so a
 *  free-text 'pending'/'Open' would create items invisible to every AI summary. */
export const actionItemApiSchema = z.object({
  description: zText.max(2_000),
  assignedTo: zTextOrNull.optional(),
  status: z.enum(['Pending', 'Completed']),
  nextStep: z.enum(['Undecided', 'Resolved', 'Partner', 'Googler']).optional(),
  linkUrl: zUrlOrNull.optional(),
  source: zTextOrNull.optional(),
  sourceUrl: zUrlOrNull.optional(),
});

export const affiliationApiSchema = z.object({
  partnerId: zId,
  role: zText.max(100),
  startDate: z.coerce.date(),
  endDate: z.preprocess(
    (v) => (v === '' || v == null ? null : v),
    z.coerce.date().nullable(),
  ).optional(),
});

// ---- helpers --------------------------------------------------------------------

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message))
    .join('; ');
}

/** Parse a server-action FormData; throws a readable Error on invalid input. */
export function parseForm<S extends z.ZodType>(schema: S, formData: FormData): z.infer<S> {
  const obj: Record<string, unknown> = {};
  for (const [k, v] of formData.entries()) {
    if (typeof v === 'string') obj[k] = v;
  }
  const result = schema.safeParse(obj);
  if (!result.success) throw new Error(`Invalid input — ${formatIssues(result.error)}`);
  return result.data;
}

/** Parse a JSON API body; returns data or the message for a 400. */
export function parseBody<S extends z.ZodType>(
  schema: S,
  body: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; error: string } {
  const result = schema.safeParse(body);
  if (!result.success) return { ok: false, error: `Invalid input — ${formatIssues(result.error)}` };
  return { ok: true, data: result.data };
}
