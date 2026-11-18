import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Third-party bundles copied in verbatim for the standalone chrome
    // viewer. They are minified vendor code, not ours to lint or fix.
    "public/vendor/**",
  ]),
  {
    /* server.js is loaded by Passenger on the production host, which requires
     * it as CommonJS — it is named in .htaccess as PassengerStartupFile and is
     * not part of any bundle, so it cannot be ESM. The require() calls in it
     * are correct; the rule simply does not apply to this one file.
     *
     * Scoped to the single rule rather than switching linting off for the
     * file, so anything else wrong in it still gets reported. */
    files: ["server.js"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
]);

export default eslintConfig;
