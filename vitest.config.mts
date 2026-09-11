import { fileURLToPath } from "node:url"

import { defineConfig } from "vitest/config"

/**
 * Vitest setup for the Phase 1 spine.
 *
 * - Node environment, no jsdom: these are unit and data-layer tests.
 * - `@/*` mirrors the tsconfig path alias so tests import the same modules the
 *   app does.
 * - Database tests share one Postgres database, so files run serially.
 * - `tests/setup.ts` points `DATABASE_URL` at the guarded test database.
 * - `tests/global-setup.ts` applies Prisma migrations before the suite runs.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // Next aliases this sentinel to an empty module during a server build;
      // mirror that here so data-layer tests can import server-only modules.
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // One shared database: never run test files in parallel.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
})
