import "dotenv/config"

import { explicitTestDatabaseUrl } from "./helpers/env"

/**
 * Runs before every test file. It points the process at the test database so
 * that `lib/prisma.ts` and any module reading `DATABASE_URL` connect to the
 * guarded test database, and keeps the LLM provider offline.
 *
 * It intentionally does not construct a Prisma client or throw when no test
 * database is configured, so pure unit tests can run without Postgres.
 */
const testUrl = explicitTestDatabaseUrl()
if (testUrl) {
  process.env.TEST_DATABASE_URL = testUrl
  process.env.DATABASE_URL = testUrl
}

process.env.LLM_PROVIDER = "mock"
