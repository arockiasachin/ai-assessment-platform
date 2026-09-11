import { PrismaPg } from "@prisma/adapter-pg"

import { PrismaClient } from "@/lib/generated/prisma/client"
import { resolveTestDatabaseUrl } from "./env"

/**
 * Prisma client bound to the dedicated test database. Constructing this module
 * validates the connection target, so importing it in a test file is itself a
 * guarantee that no developer database can be touched by accident.
 */
const testDatabaseUrl = resolveTestDatabaseUrl()

const globalForTest = globalThis as unknown as { __spineTestPrisma?: PrismaClient }

export const prisma =
  globalForTest.__spineTestPrisma ??
  new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
  })

globalForTest.__spineTestPrisma = prisma

/**
 * Truncate every application table, leaving `_prisma_migrations` untouched.
 * `CASCADE` resolves foreign keys, and `RESTART IDENTITY` keeps sequences
 * stable across test cases. Only ever called against the validated test DB.
 */
export async function truncateAll(): Promise<void> {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT "tablename"
    FROM "pg_tables"
    WHERE "schemaname" = 'public' AND "tablename" <> '_prisma_migrations'
  `
  if (tables.length === 0) return

  const list = tables.map((table) => `"${table.tablename}"`).join(", ")
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`)
}

export async function disconnectTestDatabase(): Promise<void> {
  await prisma.$disconnect()
}
