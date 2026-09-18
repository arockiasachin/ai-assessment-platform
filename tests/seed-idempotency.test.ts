import { afterAll, describe, expect, it } from "vitest"

import { DEMO_IDS, seedDemo } from "@/prisma/seed-demo"

import { disconnectTestDatabase, prisma as db, truncateAll } from "./helpers/db"

/**
 * A second demo seed run must be a **true no-op**, not merely a run with the same
 * row counts.
 *
 * ## The defect this pins
 *
 * The seed used to tear its graph down and rebuild it on every run. Counts stayed
 * equal, so the old `secondSummary == firstSummary` assertion passed — but
 * fixed-id rows got fresh `createdAt`/`updatedAt`, and every row the attempt
 * pipeline, the grading services and the code-eval spine create with a cuid
 * (`QuizAttempt`, `QuizResponse`, `Grade`, `GradeReview`, `AIGradeSuggestion`,
 * `Submission`, `TestRun`, `PeerEvaluation`, …) came back with a new id. That made
 * a re-seed destructive to anything captured before it — including before/after
 * evidence — while looking idempotent.
 *
 * The fix is `demoGraphIsIntact`: an intact graph is returned as-is, so the second
 * run issues no write at all. This file is the guard. It fingerprints **every**
 * public table (all columns, including ids and timestamps) and requires the two
 * runs to be byte-identical; a per-table row count could not see the regression.
 *
 * A partial graph must still converge rather than be treated as intact, so the
 * second case deletes one stage's rows and asserts the seed rebuilds them.
 */

/**
 * One `<rows>:<md5>` fingerprint per public table.
 *
 * `string_agg(t::text, '|' ORDER BY t::text)` serialises every column of every
 * row, sorted so the aggregate is independent of physical row order; `md5` keeps
 * it compact. Zero rows hash the empty string, so an empty table has a stable,
 * non-null fingerprint equal only to another empty table.
 */
async function fingerprints(): Promise<Record<string, string>> {
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT "tablename" FROM "pg_tables"
    WHERE "schemaname" = 'public' AND "tablename" <> '_prisma_migrations'
    ORDER BY "tablename"
  `

  const result: Record<string, string> = {}
  for (const { tablename } of tables) {
    const rows = await db.$queryRawUnsafe<{ count: bigint; hash: string }[]>(
      `SELECT count(*)::bigint AS "count",
              md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), '')) AS "hash"
       FROM "${tablename}" t`,
    )
    result[tablename] = `${rows[0].count}:${rows[0].hash}`
  }
  return result
}

describe("the demo seed is a no-op on a second run", () => {
  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("leaves every table fingerprint byte-identical", async () => {
    await truncateAll()
    await seedDemo()

    const before = await fingerprints()
    // Sanity: the walk really covered the schema, so the assertion cannot pass
    // vacuously by comparing two empty maps.
    expect(Object.keys(before).length).toBeGreaterThan(30)
    expect(Object.values(before).some((value) => !value.startsWith("0:"))).toBe(true)

    await seedDemo()

    expect(await fingerprints()).toEqual(before)
  })

  it("rebuilds a partial graph rather than treating it as intact", async () => {
    // Drop a stage the intactness check names, so a run must converge by rebuilding
    // (not by returning a half-populated graph and calling it a no-op).
    await db.peerEvaluation.deleteMany({ where: { groupId: DEMO_IDS.groupId } })
    expect(await db.peerEvaluation.count({ where: { groupId: DEMO_IDS.groupId } })).toBe(0)

    await seedDemo()

    expect(await db.peerEvaluation.count({ where: { groupId: DEMO_IDS.groupId } })).toBeGreaterThan(
      0,
    )
    expect(await db.group.count({ where: { id: DEMO_IDS.groupId } })).toBe(1)
  })
})
