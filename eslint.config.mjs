import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Underscore-prefixed args/vars are an intentional "unused on purpose" marker
      // (e.g. a typed-but-ignored callback parameter). Standard convention.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
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
