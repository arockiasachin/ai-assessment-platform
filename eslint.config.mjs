import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import prettierConfig from "eslint-config-prettier"

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
