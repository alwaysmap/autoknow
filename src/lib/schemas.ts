import { z } from 'zod';
// Pure string helpers, no Node imports — see the client-safety note below.
import { normalizeAddress } from './auth';

// Central runtime validation for mutation boundaries — API routes and server
// actions. The Prisma schema is the LAST line of defense; these are the first:
// malformed input becomes a 400 / readable error instead of a 500, and they
// encode invariants the database can't express (trimmed non-empty notes, the
// 1..5 score range, health labels). Client-safe: zod plus lib/auth's pure string
// helpers, no Node imports.

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

/** The blank-means-nothing preprocess the numeric optionals here share: '', null and
 *  undefined all become null; anything else reaches `inner` untouched. `zTextOrNull` and
 *  `zUrlOrNull` deliberately stay out — they TRIM before deciding, which is a different
 *  question, and folding them in would make one helper answer two. */
const blankToNull = <S extends z.ZodType>(inner: S) =>
  z.preprocess((v) => (v === '' || v == null ? null : v), inner.nullable());

/** Optional id: '', null, undefined normalize to null. */
export const zIdOrNull = blankToNull(zId);

/**
 * A hill position: an integer 0..100, and the ONE place that bound is written.
 *
 * It is written once because the number is DRAWN — `progress` is the dot's x on the hill
 * curve — so a value off the scale is not a bad record, it is a chart that lies (AGENTS
 * lesson 18). Four boundaries write this column. Two used to spell the range out for
 * themselves and two hand-parsed with `parseInt`, which spells no range at all — so a
 * percentage of 150 was writable through either of the latter (autoknow-9l4). A bound
 * copied per boundary is a bound that can go missing from one of them silently; shared by
 * reference, it cannot.
 */
const zHillProgress = z.coerce.number().int().min(0).max(100);

/** `zHillProgress` where a blank field is not an answer but an ABSTENTION: it parses to
 *  null and each writer says what null means for it. The two status dialogs carry the
 *  previous position forward; the metadata dialog, whose form always posts the current
 *  value in a hidden field, treats it as zero. */
const zHillProgressOrNull = blankToNull(zHillProgress);

/** A non-negative count where blank means "not stated" — the annual-volume field. */
const zCountOrNull = blankToNull(z.coerce.number().int().min(0));

/** An HTML checkbox. Ticked posts the browser's default 'on'; unticked posts NOTHING,
 *  so absence is a real answer here (false) rather than a missing field. TOTAL by
 *  construction — the preprocess answers for every input, so the `z.boolean()` behind it
 *  rejects nothing and is there for the output type, not as a gate. */
const zCheckbox = z.preprocess((v) => v === 'on' || v === true, z.boolean());

/**
 * A required address, STORED CANONICAL — trimmed and lower-cased by `normalizeAddress`,
 * the one definition of the stored form.
 *
 * `z.email()` alone (what every `Person.email` boundary took until #127 E9) accepts
 * 'Alice@Google.com' as typed, which was harmless only for as long as equality was
 * decided in JavaScript. The unique-at-an-instant EXCLUDE constraint decides it in
 * Postgres now, where `=` does not fold case — so an address typed with a capital could
 * sit beside its own lower-cased twin and the database would see two different people.
 * The migration folded the rows that predate this; this keeps them folded.
 */
export const zEmail = z.preprocess(
  (v) => (typeof v === 'string' ? normalizeAddress(v) : v),
  z.email(),
);

/** `zEmail` where nothing is also an answer: '' and null become null, which on
 *  `PersonAffiliation.email` means "not recorded", never "no address". A field ABSENT
 *  from the body stays absent — its `.optional()` short-circuits before this runs — so
 *  the route leaves the column alone rather than clearing it. */
export const zEmailOrNull = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() !== '' ? normalizeAddress(v) : null),
  z.email().nullable(),
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

/** Update targets ONE partner and carries the same editable fields as create, so it is
 *  literally those fields plus the id — a partner has no field that only creation may
 *  set, which is what makes the `.extend` honest rather than merely short. */
export const partnerUpdateSchema = partnerFieldsSchema.extend({ partnerId: zId });

/** Delete needs only the id. The preconditions — programs still owned, people still
 *  employed — are counted by lib/partnerDeletion, which is the half a schema cannot do.
 *  Twin of `personDeleteSchema`. */
export const partnerDeleteSchema = z.object({ partnerId: zId });

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

// ---- program / partner / phase status --------------------------------------------

// Status is written at two grains from three surfaces: a program or partner (the needle
// dialog), one phase (the hill dialog), and the program again from the metadata dialog,
// which edits the header's facts and appends a status row in the same submit.

export const statusUpdateSchema = z.object({
  scope: z.enum(['project', 'partner']),
  targetId: zId,
  /** Raw label; the action still maps legacy risk values via parseHealth. */
  theNeedle: zText.max(40),
  /** Every status update carries its note (dialogs require one). */
  notes: zText.max(20_000),
  hillChartProgress: zHillProgressOrNull,
});

/** The PHASE half of the same concern (app/actions/hill.ts): move one phase's dot, with
 *  the note that explains the move. No needle — health lives on the program, and the
 *  phase's own status is derived from the position rather than picked.
 *
 *  `projectId` carries two jobs, so do not read it as decoration: it is the surface to
 *  refresh, AND the program the phase must belong to (`requirePhaseInProject` in the
 *  action). Unvalidated it did neither — a NaN made `revalidatePath('/programs/NaN')`, a
 *  purge of a path no program has, and the parentage check did not exist. */
export const phaseHillSchema = z.object({
  phaseId: zId,
  projectId: zId,
  /** Required: a position change without words is unreadable later, and the AI brief
   *  digests the words. Both hill dialogs enforce it client-side too. */
  notes: zText.max(20_000),
  hillChartProgress: zHillProgressOrNull,
});

/** The program metadata dialog. Twin of `projectLifecycleSchema`, its neighbour in the
 *  same action file, and it appends the same ProjectState row `statusUpdateSchema` does. */
export const projectMetricsSchema = z.object({
  projectId: zId,
  /** Raw label; the action maps legacy risk values via parseHealth, as above. */
  theNeedle: zText.max(40),
  /** The assigned Googler — required, because every program must have one: it is the
   *  resource half of CCPM and the "who do I ask" answer. That it is SOMEBODY is all a
   *  schema can say; `requireOwner` resolves the pick to an existing Person. */
  ownerName: zText.max(200),
  /** yyyy-MM from a month picker; `parseSopInput` turns it into that month's last day. */
  sopDate: zTextOrNull,
  /** Units in the first year. Blank is "not stated", which the action stores as 0 — the
   *  header renders 0 as "Not set", so the two agree without a nullable column. */
  volumeFirstYear: zCountOrNull,
  /** Optional here, unlike the needle dialog's — editing metadata is not itself news. */
  notes: zTextOrNull,
  hillChartProgress: zHillProgressOrNull,
  /** Lead partner (OEM), editable post-creation. Null — no pick, or no picker rendered
   *  at all — means "leave it alone", never "clear it". */
  partnerId: zIdOrNull,
  hasGas: zCheckbox,
  hasGbi: zCheckbox,
  hasDigitalKey: zCheckbox,
  hasAap: zCheckbox,
});

// ---- person maintenance (server actions) ----------------------------------------

export const personMoveSchema = z.object({
  personId: zId,
  newPartnerId: zId,
  newRole: zText.max(100),
  startDate: z.coerce.date(),
});

export const personDeleteSchema = z.object({
  personId: zId,
});

/** Edit the CURRENT record: corrections, never history — see `updatePerson` for why
 *  employer and role are not here. Notes are free prose about the human, not a timeline. */
export const personUpdateSchema = z.object({
  personId: zId,
  name: zText.max(200),
  email: zEmail,
  notes: zTextOrNull,
});

// ---- person creation & assignment ------------------------------------------------

/** Person records are creatable by any login; a Person needs no Login (partner-side
 *  contacts), and a Login needs no Person until they claim one (/me). */
export const personCreateSchema = z.object({
  name: zText.max(200),
  email: zEmail,
  partnerId: zId,
  role: zTextOrNull,
});

/**
 * Self-provisioning from /me. The caller picks only the ORGANIZATION.
 *
 * THE CANONICAL ACCOUNT of why this is not simply `personCreateSchema` above, since the
 * asymmetry is exactly what a later reader will try to tidy away: name and address are
 * absent because a form that could supply them would be a form that could spoof them. The
 * login is the identity (AGENTS lesson 13, ADR
 * 2026-07-21-session-is-the-only-source-of-who-i-am), so completing the symmetry here
 * would be the bug, not the fix. `createMyProfile` and tests/createMyProfile.test.ts point
 * back here rather than restating it.
 */
export const myProfileSchema = z.object({
  partnerId: zId,
  /** Stub-mode identity override (`?user=`), ignored whenever real auth is configured. */
  user: zTextOrNull,
});

// ---- phase involvement -----------------------------------------------------------

// Two symmetric forms, differing in one id. Shape is all a schema can settle here:
// whether the phase really sits in the program the form names, and whether the person
// or partner exists, is resolved against the database by lib/phaseInvolvement.

/** Self/any assignment of a PERSON onto a phase (program derives from the phase). */
export const phasePersonAssignSchema = z.object({
  personId: zId,
  projectId: zId,
  phaseId: zId,
  role: zTextOrNull,
});

/** The same, for a PARTNER involved in one phase rather than owning the program. */
export const phasePartnerAssignSchema = z.object({
  partnerId: zId,
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

// `currentPartnerId` keeps its name — it is the published request contract — but since
// #127 E5 it means "the partner they START at", and the route opens the employment
// period to say so. `role`/`startDate` describe that opening period; omitting them means
// "Member, from today", which is all a caller who only knows the company can honestly
// say. A caller who knows the real career supplies them here rather than creating the
// person and then posting a SECOND period that overlaps the default.
export const personApiSchema = z.object({
  name: zText.max(200),
  email: zEmail,
  currentPartnerId: zId,
  notes: zTextOrNull.optional(),
  role: zText.max(100).optional(),
  startDate: z.coerce.date().optional(),
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
  /** `zHillProgress`, not `zHillProgressOrNull`: the empty case here is UNDEFINED, because
   *  a field absent from a PATCH body means "don't touch it" — which is a different
   *  sentence from the forms' "leave the dot where it is", even though both end up
   *  preserving the stored value. The BOUND is the same object either way. */
  hillChartProgress: z.preprocess(
    (v) => (v === '' || v == null ? undefined : v),
    zHillProgress.optional(),
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
  // The address held during THIS period (#127 E8). Optional because most periods predate
  // the column and nothing knows what address they used — a null means "not recorded",
  // never "no address". Both address columns share `zEmail`'s canonicalization since
  // #127 E9, which is what lets the unique-at-an-instant constraint compare them.
  email: zEmailOrNull.optional(),
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
