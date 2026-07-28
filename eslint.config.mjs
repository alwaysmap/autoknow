import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// ADR session-is-the-only-source-of-who-i-am, enforced rather than asked for. Identity is read through
// getCurrentUser() (src/lib/session.ts), whose CurrentUser carries every field the UI
// displays. Reaching for a FIELD of session.user at a call site is how the nav came to
// render '@dylan' — the call site invents its own fallback, and it disagrees with the
// accessor's. `session.user` ITSELF stays legal: that is the existence check
// (`!!session?.user` for signedIn), which the ADR explicitly permits. The fix when this
// fires is to widen CurrentUser, never to work around the selector.
const IDENTITY_MESSAGE =
  "Read identity through getCurrentUser() — CurrentUser carries every displayed field. " +
  "Add the field there instead of reading session.user.* here (docs/adr/2026-07-21-session-is-the-only-source-of-who-i-am.md).";

// Anchored on ".user" rather than on the identifier `session`, because the shapes a
// caller can spell are open-ended — `session.user.x`, `session?.user?.x`,
// `(await auth()).user.x`, `s!.user.x` all differ in the AST, and a selector matching
// only the first leaves the rest as silent bypasses. A false positive here is loud and
// costs one justified eslint-disable; a false negative is the bug that shipped.
const noSessionFieldReads = [
  {
    // Any field read off a `.user` — but NOT `.user` itself, which stays legal.
    selector: "MemberExpression[object.property.name='user']",
    message: IDENTITY_MESSAGE,
  },
  {
    // The same, when a TS non-null assertion (`s!.user!.x`) wraps the `.user` node.
    selector:
      "MemberExpression[object.type='TSNonNullExpression'][object.expression.property.name='user']",
    message: IDENTITY_MESSAGE,
  },
];

// ADR currentpartnerid-is-a-cache-affiliations-are-the-truth, same shape and for the
// same reason as the identity rule above: a question with ONE right way to ask it, and
// three spellings in the tree that each look plausible at the call site. WHY the other
// two are wrong is the ADR's job; the message below carries the part a developer who
// trips this needs. Rediscovered by hand three times (E2, E2a, E5) before it became a
// rule — AGENTS lesson 2.
const AS_OF_MESSAGE =
  "Ask which company a person is at AS OF A DAY, never off the `currentPartnerId` cache " +
  "or an `endDate: null` where-clause. Two sanctioned answers: `lib/profiles` " +
  "(profileAsOf / profilesAsOf / partnerRosterAsOf / rostersByPartnerAsOf, and " +
  "personIsAtPartnerAsOfSql for hand-written SQL) when the rows are still in the " +
  "database, `lib/people`'s coversDay when you already hold them " +
  "(docs/adr/2026-07-26-currentpartnerid-is-a-cache-affiliations-are-the-truth.md).";

// TWO FAMILIES, because the exemptions differ. Naming the cache is allowed in the few
// files that have to; asking "is the period open?" where "is it current?" was meant is
// allowed only in the module that defines the predicate. They are separate arrays rather
// than one array the overrides filter, so "which rules does this file keep?" is answered
// by a spread below rather than by a string search over a selector — a fifth rule that
// happened to mention `endDate` would have silently changed the answer.
//
// Both are broad on purpose and exempted BY FILE — the same trade the identity rule
// makes. The narrower, context-sensitive selector is a rejected alternative in the ADR.
const noCachedAffiliationReads = [
  {
    // `person.currentPartner`, `p.currentPartnerId`, `partner.currentEmployees`.
    selector:
      "MemberExpression[property.name=/^(currentPartner|currentPartnerId|currentEmployees)$/]",
    message: AS_OF_MESSAGE,
  },
  {
    // The Prisma shapes: an `include`/`select`/`where`/`data` key, a destructure, and a
    // shorthand all land here as a Property key.
    selector:
      "Property[key.name=/^(currentPartner|currentPartnerId|currentEmployees)$/]",
    message: AS_OF_MESSAGE,
  },
  {
    // Raw SQL — `Prisma.sql\`pe."currentPartnerId" = ...\`` is a STRING, invisible to
    // every selector above, and `lib/search.ts` scoped the people results that way.
    // Without this the guard would have a hole exactly where the query is hand-written.
    selector: "TemplateElement[value.raw=/currentPartnerId|currentEmployees/]",
    message: AS_OF_MESSAGE,
  },
];

// `endDate: null` — "is this period open?", asked where "is it current?" was meant.
//
// NOT anchored under a `where` key, though that is the only place it does damage: an
// anchored selector is defeated by hoisting the object one line up
// (`const w = { personId, endDate: null }`), and a guard a reformat can disable is not a
// guard. Unanchored, the DATA side stays legal anyway by node shape rather than by
// position — closing a period writes a DATE (`endDate: startDate`), and the nullable
// forms already in the tree are `endDate ?? null` and `x ? y : null`, whose values are
// Logical/Conditional expressions, not the `null` Literal this matches as a direct child.
const noOpenPeriodAsCurrent = [
  {
    selector: "Property[key.name='endDate'] > Literal[raw='null']",
    message: AS_OF_MESSAGE,
  },
];

// `Project.ownerName` — the program owner asked as a STRING, where the FK was meant.
//
// #124 Class 4 in one line: `ownerName` is a bare `String?` holding an address, and an
// address belongs to a JOB. Every surface that matched it therefore lost a person's
// programs the moment they changed company — /people/:id resolved the owner by stripping
// an email to its local part and comparing three spellings, and a colliding handle
// matched the WRONG human. #127 E6 added `ownerPersonId` + FK and made every write path
// fill both; E7 moved every reader across. The column survives as legacy text (the
// dual-write continues, and the backfill still reasons about it) — so a rule, not a
// deletion, is what keeps a new reader from appearing.
//
// Fourth family here, same shape and same trade as the three above: broad selectors,
// exempted BY FILE, because the spellings a call site can reach for are open-ended
// (`p.ownerName`, a Prisma `where`/`select` key, a destructure, a raw-SQL column) and a
// narrow selector leaves the rest as silent bypasses.
const OWNER_MESSAGE =
  "Ask WHO owns a program through `Project.ownerPersonId` / the `ownerPerson` relation, " +
  "never the `ownerName` text. The string is legacy: it holds an ADDRESS, and an address " +
  "belongs to a job, so matching it loses every program its owner recorded under a " +
  "previous one and can match a different human with the same handle (#124 Class 4, " +
  "#127 E7). Writing it is fine and stays dual-written — `requireOwner` in lib/owner " +
  "hands back the {ownerName, ownerPersonId} pair and nothing hands back the email alone.";

const noOwnerNameReads = [
  {
    // `project.ownerName`, `p.ownerName`, `owner.ownerName`.
    selector: "MemberExpression[property.name='ownerName']",
    message: OWNER_MESSAGE,
  },
  {
    // The Prisma shapes: an `include`/`select`/`where`/`data` key, a destructure, and a
    // shorthand all land here as a Property key.
    selector: "Property[key.name='ownerName']",
    message: OWNER_MESSAGE,
  },
  {
    // The quoted-key spelling — `{ "ownerName": v }` — which the selector above misses
    // because a string key is `key.value`, not `key.name`.
    selector: "Property[key.value='ownerName']",
    message: OWNER_MESSAGE,
  },
  {
    // Raw SQL: inside `Prisma.sql` a column name is just text. `lib/search.ts` lexically
    // matched `pr."ownerName"` exactly that way, invisible to every selector above —
    // the same hole the cache family's TemplateElement rule exists to close.
    selector: "TemplateElement[value.raw=/ownerName/]",
    message: OWNER_MESSAGE,
  },
];

// The five waterfall predicates — "did this schedule row move the buffer, and how?"
//
// `lib/chainLedger` answers that with exactly five tests over a ScheduleRow's
// `varianceDays`/`gapBeforeDays`, and every chart surface asks the same five questions.
// Twenty hand-rolled comparisons across five files had grown from it — 7 in lib/chainLedger
// itself, 4 in lib/bufferSeries, 4 in ChainSchedule.tsx, 3 in ChainLedger.tsx, 2 in
// lib/chainDay — AGENTS lesson 7 in its literal form, and only ONE pair of them had a test
// that would notice a disagreement (the flow-vs-waterfall balance gate). autoknow-4dr.1
// converged them onto the five exported predicates; this family is what stops the next
// copy being written, because the next chart author reaches for a comparison, not for a
// name (AGENTS lesson 2).
//
// Fifth family, and the FIRST anchored on the COMPARISON rather than on a name. Both fields
// are numbers a chart legitimately DISPLAYS (`{ d: r.gapBeforeDays }`) and legitimately
// picks grammar from (`r.varianceDays === 1 ? 'clRowSpentOne' : …`), so a name-shaped
// selector like the four above would be wrong here. What the five predicates uniquely are
// is ORDERING comparisons against these two fields — so that is the anchor, and `===`/`!==`
// stay legal by node shape rather than by an exemption anyone has to maintain.
const CHAIN_PREDICATE_MESSAGE =
  "Choose from the five exported chain predicates — hasIdleGapBefore / isRealizedOverrun / " +
  "isRealizedUnderrun / isForecastOver / isForecastUnder (src/lib/chainLedger.ts) — never a " +
  "fresh comparison against varianceDays or gapBeforeDays. They are one taxonomy with a " +
  "deliberate asymmetry (realized variances count from 1 day, forecast ones from " +
  "FORECAST_NOISE_DAYS), and a hand-rolled copy is how a bar came to draw red beside a row " +
  "card reading 'on plan'. Reading the value to display it, or to pick singular/plural " +
  "copy, is fine — this only blocks re-deciding WHICH rows count.";

const noHandRolledChainPredicates = [
  {
    // `r.varianceDays >= 1`, `row.gapBeforeDays >= 1`, and the mirrored operand order.
    selector:
      "BinaryExpression[operator=/^(<|>|<=|>=)$/] > MemberExpression[property.name=/^(varianceDays|gapBeforeDays)$/]",
    message: CHAIN_PREDICATE_MESSAGE,
  },
  {
    // The destructured spelling — `const { varianceDays } = r; if (varianceDays >= 1)` —
    // which the selector above misses because the operand is a bare Identifier, not a
    // MemberExpression.
    selector:
      "BinaryExpression[operator=/^(<|>|<=|>=)$/] > Identifier[name=/^(varianceDays|gapBeforeDays)$/]",
    message: CHAIN_PREDICATE_MESSAGE,
  },
];

// The cache is still a column with a public name, so some files have to SAY it — which
// is not the same as reading it for display, and mostly not even the same as writing it.
// Only the first entry writes; the rest carry the name because the request contract does.
// Listed individually so each exemption stays a decision, and each keeps the OTHER
// families (they are re-listed below, not switched off).
const MAY_NAME_THE_CACHE = [
  "src/app/actions/people.ts", // reads the cache field name off the revise form contract
  "src/app/api/people/route.ts", // destructures the request field of that name
];

// Same idea for the owner TEXT: writing it, and the tooling that reads it precisely
// BECAUSE it is the legacy column, are not the defect the rule is about.
//
// SPLIT IN TWO on purpose. Two files name the cache AND the owner text, and a flat-config
// block REPLACES `no-restricted-syntax` rather than merging into it — so folding these
// into one list placed after MAY_NAME_THE_CACHE would silently hand `schemas.ts` and
// `seed.ts` back the cache family the block above just took away. The overlap is the
// whole reason for the split; it is written down here so nobody "simplifies" it back.
const MAY_NAME_THE_OWNER_TEXT = [
  "src/lib/owner.ts", // DEFINES the pair — requireOwner is the only source of it
  "src/lib/ownerBackfill.ts", // reads the text to fill the FK from it (#127 E6)
  "src/lib/ownerRemediation.ts", // repoints the rows whose text names nobody
  "src/app/api/projects/route.ts", // destructures the request field of that name
  // Same, for the program-settings form action. The brackets are ESCAPED: a `files`
  // entry is a glob, so the literal `[id]` of a Next dynamic segment otherwise reads as
  // a character class matching one `i` or `d` — the path never matches, and the
  // exemption silently does nothing. It fails loudly here (the file trips the rule), but
  // an exemption that quietly widens a rule instead would not.
  "src/app/programs/\\[id\\]/actions.ts",
  "src/app/programs/new/page.tsx", // reads it back off requireOwner's returned pair
  // DEAD CODE, exempted only so `npm run lint` is not red while it awaits deletion:
  // referenced by nothing since the initial commit, and its Partner trigger still reads
  // `NEW.type`/`NEW.region`, columns the schema replaced with `typeId`/`regionId`.
  "prisma/seed-triggers.ts",
];

/** In BOTH exemption lists above — see the split note on MAY_NAME_THE_OWNER_TEXT. */
const MAY_NAME_CACHE_AND_OWNER_TEXT = [
  "src/lib/schemas.ts", // the zod contract both request shapes are parsed against
  "src/lib/seed.ts", // puts both in the POST bodies it sends to those routes
];

/**
 * The five families, and the one way a block names the ones it KEEPS.
 *
 * Every override below is an exemption, and every exemption's comment says which family
 * it DROPS — so let the code say the same thing. Listing the kept families by hand meant
 * four families times six blocks maintained by subtraction, and a fifth family would have
 * had to be added to each of them: miss one and that file quietly stops being policed,
 * which is the exact failure these guards exist to prevent. Here a new family is added in
 * ONE place and is on everywhere until a block explicitly drops it.
 *
 * This does NOT flatten the exemption FILE lists — MAY_NAME_THE_CACHE /
 * MAY_NAME_THE_OWNER_TEXT / MAY_NAME_CACHE_AND_OWNER_TEXT stay separate for the
 * flat-config reason spelled out above them, which is a different problem.
 */
const FAMILIES = {
  session: noSessionFieldReads,
  cache: noCachedAffiliationReads,
  openPeriod: noOpenPeriodAsCurrent,
  ownerText: noOwnerNameReads,
  chainPredicates: noHandRolledChainPredicates,
};

const allFamiliesExcept = (...dropped) => [
  "error",
  ...Object.entries(FAMILIES)
    .filter(([name]) => !dropped.includes(name))
    .flatMap(([, selectors]) => selectors),
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Every family. Each override below names only what it drops, and why.
      "no-restricted-syntax": allFamiliesExcept(),
      // Underscore-prefixed args/vars are an intentional "unused on purpose" marker
      // (e.g. a typed-but-ignored callback parameter). Standard convention.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The auth layer itself — the two files whose JOB is to turn a session into
    // something the rest of the app may read. session.ts builds CurrentUser;
    // routeAuth.ts checks an email exists to admit a request, and never displays it.
    // Exempting by name (not all of src/lib) keeps the exemption a decision. Drops the
    // SESSION family only — neither file touches affiliations, but spelling that out
    // beats `"off"`, which would silently absorb every family added later.
    files: ["src/lib/session.ts", "src/lib/routeAuth.ts"],
    rules: { "no-restricted-syntax": allFamiliesExcept("session") },
  },
  {
    // See MAY_NAME_THE_CACHE. Drops the CACHE family only. `noOpenPeriodAsCurrent`
    // deliberately stays: being allowed to name `currentPartnerId` says nothing about
    // being allowed to ask an affiliation question the wrong way. Since #127 E14 the
    // cache is advanced in lib/profiles (`recordPersonChange`, `correctPersonRecord`),
    // where the justified disables live beside the writes.
    files: MAY_NAME_THE_CACHE,
    rules: { "no-restricted-syntax": allFamiliesExcept("cache") },
  },
  {
    // See MAY_NAME_THE_OWNER_TEXT. Drops the OWNER-TEXT family only — naming the legacy
    // column says nothing about being allowed to read the affiliation cache, and
    // `lib/ownerBackfill` and `lib/ownerRemediation` both build people directories that
    // the as-of families are exactly right to keep policing.
    files: MAY_NAME_THE_OWNER_TEXT,
    rules: { "no-restricted-syntax": allFamiliesExcept("ownerText") },
  },
  {
    // The two files in both lists. Drops the CACHE and OWNER-TEXT families together —
    // they are the request contract and the seed that fills it, and both name every
    // column those requests carry. Spelled as its own block rather than as a later,
    // broader list, because a flat-config block replaces the rule wholesale.
    files: MAY_NAME_CACHE_AND_OWNER_TEXT,
    rules: { "no-restricted-syntax": allFamiliesExcept("cache", "ownerText") },
  },
  {
    // The module that DEFINES the as-of predicate has to write it down once, and
    // `asOfWhere`'s `OR: [{ endDate: null }, { endDate: { gt: at } }]` is that once —
    // the correct use of the literal, which is why the rule points every other file
    // here. Drops the open-period family only; the cache write inside `createPersonAt`
    // still trips the cache family and carries its own inline disable, because one
    // sanctioned write is worth naming at the line rather than at the file.
    files: ["src/lib/profiles.ts"],
    rules: { "no-restricted-syntax": allFamiliesExcept("openPeriod") },
  },
  {
    // Same shape as the profiles.ts block above: the module that DEFINES the five chain
    // predicates has to write each comparison down once, and those five one-line bodies
    // are that once — the correct use of the threshold, which is why the rule points
    // every other file here. Drops the chain-predicate family only; chainLedger builds
    // people-shaped resource rows too, and the as-of families are exactly right to keep
    // policing them. ONE file, not `src/lib/**`: bufferSeries and chainDay are the two
    // call sites this convergence exists for, so they stay policed.
    files: ["src/lib/chainLedger.ts"],
    rules: { "no-restricted-syntax": allFamiliesExcept("chainPredicates") },
  },
  {
    // Tests are FIXTURE authors, and all three data families are unavoidable there:
    // `currentPartnerId` is a REQUIRED FK so no test can build a Person without naming
    // it, `endDate: null` is how you write down an open period you are about to assert on
    // (tests/coversDay.test.ts does exactly that), and a fixture must write `ownerName`
    // to build a Project at all. Fifteen identical disable comments would teach nobody
    // anything. What a test reads is also usually the POINT —
    // tests/scheduledMove.test.ts asserts the cache does NOT advance early, and
    // tests/ownerBackfill + tests/ownerRemediation exist to assert on the legacy column.
    // The chain-predicate family stays ON here: a test asserting on a fixture's
    // varianceDays does it through `expect(...)`, never through a comparison, and a test
    // that DID re-implement a predicate would be asserting its own copy is consistent
    // with itself — the one place a hand-rolled copy is worst, not most excusable.
    files: ["tests/**"],
    rules: { "no-restricted-syntax": allFamiliesExcept("cache", "openPeriod", "ownerText") },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Alternate build dirs this project uses (demo/test/screenshot servers) and other
    // generated output — build artifacts must never be linted; without these the
    // signal is 40k+ noise lines from compiled bundles.
    ".next-*/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    // Standalone Node/CommonJS deploy scripts — their own runtime, not the app's
    // TS/ESM build, so the Next TypeScript ruleset doesn't apply.
    "infra/**",
    "scripts/**",
    // Claude Code agent worktrees: FULL copies of this repo, so linting walked them and
    // reported 344,487 problems from paths outside the checkout being linted. Flat
    // config ignores only node_modules and .git by default, which is why this needs
    // saying — `tsc` skips dot-directories on its own, and jest.config.ts already
    // ignores `.claude/` for the same root cause. Absent in CI, so only the local gate
    // breaks, and only while an agent is working — when it matters most.
    ".claude/**",
  ]),
]);

export default eslintConfig;
