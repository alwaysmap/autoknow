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
// three spellings in the tree that each look plausible at the call site.
//
// "Which company is this person at?" is a question about a DAY, answered by the
// PersonAffiliation period that CONTAINS that day. `Person.currentPartnerId` is a
// denormalized cache of the answer for TODAY, advanced by `movePersonCompany` only once
// a move's date arrives — so it is stale by construction between the two, and it cannot
// answer about any other day at all. `where: { endDate: null }` is the other wrong
// spelling: it asks "is this period OPEN?", which coincides with "is it CURRENT?" only
// while nobody has a move recorded.
//
// This rule has now been rediscovered three times by hand (E2, E2a, E5). The migration
// fixes today's readers; this is what stops tomorrow's — AGENTS lesson 2.
const AS_OF_MESSAGE =
  "Ask which company a person is at AS OF A DAY, never off the `currentPartnerId` cache " +
  "or an `endDate: null` where-clause. Two sanctioned answers: `lib/profiles` " +
  "(profileAsOf / profilesAsOf / partnerRosterAsOf) when the rows are still in the " +
  "database, `lib/people`'s coversDay when you already hold them " +
  "(docs/adr/2026-07-26-currentpartnerid-is-a-cache-affiliations-are-the-truth.md).";

// TWO FAMILIES, because the exemptions differ. Naming the cache is allowed in the files
// that maintain it; asking "is the period open?" where "is it current?" was meant is
// allowed nowhere. They are separate arrays rather than one array the override filters,
// so that "which rules does a cache-writer keep?" is answered by the spread below rather
// than by a string search over a selector — a fifth rule that happened to mention
// `endDate` would have silently changed the answer.
//
// Both are broad on purpose and exempted BY FILE — the same trade the identity rule
// makes. Narrowing by context (allow it under `data:`, forbid it under `select:`) is
// exactly the kind of selector a fourth spelling walks around, because the wrong read is
// not a syntax the AST distinguishes: `currentPartner` in an `include` and in a `select`
// are the same node.
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

// The cache is still a column, so something has to name it. These are the files whose
// JOB that is; each is listed individually so the exemption stays a decision, and each
// keeps the OTHER families (they are re-listed below, not switched off).
const CACHE_WRITERS = [
  "src/app/actions/people.ts", // movePersonCompany advances the cache on the effective day
  "src/app/api/people/route.ts", // destructures the request field, which keeps the name
  "src/lib/schemas.ts", // the zod contract that request is parsed against
  "src/lib/seed.ts", // seeds the column alongside the affiliation rows
];

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Every family. The two overrides below re-list a SUBSET, so a new family added
      // here must be added there too — that is the cost of exemptions that stay
      // decisions, and it is why each override says which families it drops and why.
      "no-restricted-syntax": [
        "error",
        ...noSessionFieldReads,
        ...noCachedAffiliationReads,
        ...noOpenPeriodAsCurrent,
      ],
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
    rules: {
      "no-restricted-syntax": ["error", ...noCachedAffiliationReads, ...noOpenPeriodAsCurrent],
    },
  },
  {
    // The cache's own maintainers — see CACHE_WRITERS. Drops the CACHE family only.
    // `noOpenPeriodAsCurrent` deliberately stays: being allowed to write
    // `currentPartnerId` says nothing about being allowed to ask an affiliation question
    // the wrong way, and `movePersonCompany` does exactly that — it trips this selector
    // and carries a justified disable naming the bead that fixes it.
    files: CACHE_WRITERS,
    rules: {
      "no-restricted-syntax": ["error", ...noSessionFieldReads, ...noOpenPeriodAsCurrent],
    },
  },
  {
    // The module that DEFINES the as-of predicate has to write it down once, and
    // `asOfWhere`'s `OR: [{ endDate: null }, { endDate: { gt: at } }]` is that once —
    // the correct use of the literal, which is why the rule points every other file
    // here. Drops the open-period family only; the cache write inside `createPersonAt`
    // still trips the cache family and carries its own inline disable, because one
    // sanctioned write is worth naming at the line rather than at the file.
    files: ["src/lib/profiles.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...noSessionFieldReads, ...noCachedAffiliationReads],
    },
  },
  {
    // Tests are FIXTURE authors, and both families are unavoidable there:
    // `currentPartnerId` is a REQUIRED FK so no test can build a Person without naming
    // it, and `endDate: null` is how you write down an open period you are about to
    // assert on (tests/coversDay.test.ts does exactly that). Fifteen identical disable
    // comments would teach nobody anything. What a test reads is also usually the
    // POINT — tests/scheduledMove.test.ts asserts the cache does NOT advance early.
    // Listed after CACHE_WRITERS so this wins for any file matching both.
    files: ["tests/**"],
    rules: { "no-restricted-syntax": ["error", ...noSessionFieldReads] },
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
