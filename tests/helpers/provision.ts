import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

import { Client } from "pg"

import { assertTestDatabaseUrl } from "./env"

/**
 * Builds the test database from `prisma/schema.prisma`.
 *
 * Why not `prisma migrate deploy`? The committed migration history is
 * incomplete: `20260807071217_init` only creates the `User` table and the next
 * migration alters `Course`/`CourseOffering`, which no migration ever creates.
 * Migrations therefore cannot build a database from scratch. Applying the
 * datamodel directly keeps the test harness honest and reproducible without
 * rewriting another owner's migration history or resetting a developer's
 * database. Re-baselining the migrations is tracked as a follow-up.
 *
 * The script drops and recreates the `public` schema (test DB only), which also
 * clears the pgvector extension, then recreates the extension and the HNSW
 * index that Prisma cannot model on an `Unsupported` column.
 */

const SCHEMA_PATH = fileURLToPath(new URL("../../prisma/schema.prisma", import.meta.url))

const PGVECTOR_INDEX_SQL = `CREATE INDEX "MaterialChunk_embedding_hnsw_idx"
  ON "MaterialChunk" USING hnsw ("embedding" vector_cosine_ops);`

function generateSchemaSql(url: string): string {
  return execFileSync(
    "npx",
    ["prisma", "migrate", "diff", "--from-empty", "--to-schema", SCHEMA_PATH, "--script"],
    {
      encoding: "utf8",
      env: { ...process.env, DATABASE_URL: url, TEST_DATABASE_URL: url },
    },
  )
}

export async function provisionTestDatabase(url: string): Promise<void> {
  assertTestDatabaseUrl(url)

  const script = [
    "DROP SCHEMA IF EXISTS public CASCADE;",
    "CREATE SCHEMA public;",
    "CREATE EXTENSION IF NOT EXISTS vector;",
    generateSchemaSql(url),
    PGVECTOR_INDEX_SQL,
  ].join("\n")

  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    // node-postgres runs multiple statements in a single simple query.
    await client.query(script)
  } finally {
    await client.end()
  }
}
