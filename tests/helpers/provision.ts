import { execFileSync } from "node:child_process"

import { Client } from "pg"

import { assertTestDatabaseUrl } from "./env"

/**
 * Builds the test database by applying the committed migration history with
 * `prisma migrate deploy` — the same path a deployment uses. Applying the real
 * migrations (rather than diffing the datamodel) means CI fails if the
 * migration history can no longer build the current schema from empty, so the
 * harness actively guards the migration chain.
 *
 * The `public` schema is dropped and recreated first (test database only), so
 * every run starts from an empty database. Dropping the schema also drops the
 * `vector` extension; the baseline migration recreates it along with the
 * `MaterialChunk` HNSW index.
 *
 * The reset only ever runs against a URL validated by `assertTestDatabaseUrl`,
 * so it can never touch a developer's primary database.
 */
export async function provisionTestDatabase(url: string): Promise<void> {
  assertTestDatabaseUrl(url)

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;")
  } finally {
    await client.end()
  }

  deployMigrations(url)
}

function deployMigrations(url: string): void {
  try {
    execFileSync("npx", ["prisma", "migrate", "deploy"], {
      encoding: "utf8",
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url },
    })
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string }
    const detail = [output.stdout, output.stderr].filter(Boolean).join("\n").trim()
    throw new Error(`prisma migrate deploy failed against the test database:\n${detail}`)
  }
}
