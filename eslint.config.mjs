import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import prettierConfig from "eslint-config-prettier"

import noUnguardedPartialWrite from "./eslint-rules/no-unguarded-partial-write.mjs"

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React Compiler rule. The legacy client components fetch on mount and store
      // the result in state, which this rule flags. Phase 2 replaces them with
      // Server Components and server actions, so it returns to "error" once the
      // fetch-on-mount pattern is gone. New code must not add new violations.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    // Structural guard for the partial-update data-loss bug class (bugfix-run-2
    // and bugfix-run-3): a Prisma write payload must not collapse an omitted
    // field (undefined) into an explicit null, and must not write the raw
    // request object. Use partialUpdate() from lib/partial-update.ts.
    // See docs/engineering/partial-update-guide.md.
    files: ["app/**/*.ts", "lib/**/*.ts"],
    plugins: {
      local: {
        rules: {
          "no-unguarded-partial-write": noUnguardedPartialWrite,
        },
      },
    },
    rules: {
      "local/no-unguarded-partial-write": "error",
    },
  },
  // Must stay last so formatting-related rules never conflict with Prettier.
  prettierConfig,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "lib/generated/**",
    ".pdf-extract/**",
    ".docx-extract/**",
    // Nested git worktrees are separate checkouts owned by other pods (and may
    // contain their own `.next` build output); the parent gate must not lint
    // them, mirroring `.prettierignore`.
    ".worktrees/**",
  ]),
])
