import "dotenv/config"

/**
 * Resolving the test database is a safety-critical operation: a mistake here
 * could point migrations or truncation at a developer's primary database.
 *
 * Rules:
 * - `TEST_DATABASE_URL` wins; `DATABASE_URL` is the fallback.
 * - The database name must contain "test" (case-insensitive), otherwise we
 *   refuse to run rather than risk touching real data.
 */

const HINT =
  'Set TEST_DATABASE_URL to a dedicated test database (name must contain "test"), e.g. ' +
  "postgresql://postgres:postgres@localhost:5433/assessment_test. See tests/README.md."

/** The explicitly-set test URL, or null when the developer has not configured one. */
export function explicitTestDatabaseUrl(): string | null {
  const raw = (process.env.TEST_DATABASE_URL ?? "").trim()
  return raw.length > 0 ? raw : null
}

function databaseName(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`TEST_DATABASE_URL/DATABASE_URL is not a valid connection URL. ${HINT}`)
  }
  const name = parsed.pathname.replace(/^\//, "")
  if (!name) {
    throw new Error(`Connection URL has no database name. ${HINT}`)
  }
  return name
}

/** Validate that a connection string targets a test database, then return it. */
export function assertTestDatabaseUrl(url: string): string {
  const name = databaseName(url)
  if (!/test/i.test(name)) {
    throw new Error(
      `Refusing to run database tests against "${name}": the database name must contain "test". ${HINT}`,
    )
  }
  return url
}

/** The connection string database tests must use. */
export function resolveTestDatabaseUrl(): string {
  const raw = (process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? "").trim()
  if (!raw) {
    throw new Error(`No TEST_DATABASE_URL or DATABASE_URL is set. ${HINT}`)
  }
  return assertTestDatabaseUrl(raw)
}
