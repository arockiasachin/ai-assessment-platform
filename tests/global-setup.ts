import "dotenv/config"

import { assertTestDatabaseUrl, explicitTestDatabaseUrl } from "./helpers/env"
import { provisionTestDatabase } from "./helpers/provision"

/**
 * Applied once before the suite. Provisioning only ever runs against an
 * explicitly configured `TEST_DATABASE_URL`, never the ambient `DATABASE_URL`,
 * and only after the database name is validated as a test database.
 *
 * When `TEST_DATABASE_URL` is absent we skip provisioning and let
 * database-backed tests fail with a clear message, so offline unit tests still
 * run without Postgres.
 */
export default async function globalSetup(): Promise<void> {
  const explicit = explicitTestDatabaseUrl()
  if (!explicit) {
    console.warn(
      "[tests] TEST_DATABASE_URL is not set; skipping test database setup. " +
        "Database-backed tests will fail. See tests/README.md.",
    )
    return
  }

  const url = assertTestDatabaseUrl(explicit)
  console.info("[tests] Provisioning the test database from prisma/schema.prisma...")
  await provisionTestDatabase(url)
  console.info("[tests] Test database ready.")
}
