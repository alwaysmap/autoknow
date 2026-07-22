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

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "no-restricted-syntax": ["error", ...noSessionFieldReads],
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
    // Exempting by name (not all of src/lib) keeps the exemption a decision.
    files: ["src/lib/session.ts", "src/lib/routeAuth.ts"],
    rules: { "no-restricted-syntax": "off" },
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
  ]),
]);

export default eslintConfig;
