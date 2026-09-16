import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { seedDemo } from "@/prisma/seed-demo"

import { disconnectTestDatabase, prisma as db, truncateAll } from "./helpers/db"

/**
 * Seed shape: **legibility, not existence.**
 *
 * This file exists because of Wave 1's three seed bugs. Every one of them passed
 * its own test, because the assertions only counted rows: "the page is not empty"
 * is satisfied by two near-identical rows that demo as broken. So nothing here
 * asserts a row count. Each assertion names a *branch of a real page* and requires
 * the seed to reach it.
 *
 * The rule this encodes: if a page can render a state, the seed should produce it.
 * Otherwise the state is only ever exercised by a unit test with a hand-built row,
 * and the demo silently shows one shape of data.
 *
 * Wave 2 covers materials here. The calendar block arrives with S6, which is the
 * other half of the same seed work.
 */

describe("demo seed — shape and legibility", () => {
  beforeAll(async () => {
    await truncateAll()
    await seedDemo()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  describe("materials", () => {
    it("covers every MaterialKind the resources page renders", async () => {
      const rows = await db.material.findMany({ select: { kind: true } })
      const kinds = new Set(rows.map((row) => row.kind))

      // `OTHER` is deliberately absent: it has no sensible demo meaning, and a row
      // invented to fill it would be the kind of padding this file guards against.
      for (const kind of ["DOCUMENT", "SLIDE_DECK", "VIDEO", "TRANSCRIPT", "LINK"]) {
        expect(kinds, `no material of kind ${kind}`).toContain(kind)
      }
      expect([...kinds].sort()).toEqual(["DOCUMENT", "LINK", "SLIDE_DECK", "TRANSCRIPT", "VIDEO"])
    })

    it("has both a course-wide material and an offering-scoped one", async () => {
      // These are the two tiers of the reader's scope. With only one tier the
      // other branch is unreachable from the UI and only a DB test would cover it.
      const courseWide = await db.material.count({ where: { offeringId: null } })
      const offeringScoped = await db.material.count({ where: { offeringId: { not: null } } })
      expect(courseWide).toBeGreaterThan(0)
      expect(offeringScoped).toBeGreaterThan(0)
    })

    it("has both a linked material and one with no file at all", async () => {
      // Drives the "no file attached" branch and the external-link branch.
      expect(await db.material.count({ where: { sourceUrl: null } })).toBeGreaterThan(0)
      expect(await db.material.count({ where: { sourceUrl: { not: null } } })).toBeGreaterThan(0)
    })

    it("has both an indexed material and an unindexed one", async () => {
      // "Not searchable yet" is a state the page renders differently, so it must
      // be reachable from seeded data rather than only from a mapper test.
      const indexed = await db.material.count({ where: { chunks: { some: {} } } })
      const unindexed = await db.material.count({ where: { chunks: { none: {} } } })
      expect(indexed).toBeGreaterThan(0)
      expect(unindexed).toBeGreaterThan(0)
    })

    it("produces chunks the real way, so indexed materials are actually embedded", async () => {
      // If someone sets `chunks` by hand instead of calling `indexMaterial`, the
      // page says "Indexed" while quiz retrieval finds nothing. Assert the
      // embeddings, because retrieval is what "indexed" is supposed to mean.
      const embedded = await db.$queryRaw<{ count: number }[]>`
        SELECT COUNT(*)::int AS "count"
        FROM "MaterialChunk"
        WHERE "embedding" IS NOT NULL
      `
      const chunks = await db.materialChunk.count()
      expect(chunks).toBeGreaterThan(0)
      expect(Number(embedded[0].count)).toBe(chunks)
    })

    it("puts a material in the past offering so cross-offering isolation is demonstrable", async () => {
      const pastOfferingMaterials = await db.material.count({
        where: { offering: { endsOn: { lt: new Date() } } },
      })
      expect(pastOfferingMaterials).toBeGreaterThan(0)
    })

    it("leaves a student enrolled in the active offering but not the past one", async () => {
      // This is what makes the row above *demonstrable* rather than merely present.
      // With every student in both offerings, the past offering's material would
      // appear for everyone and a broken scope filter would be invisible -- the
      // exact failure mode this file exists to prevent.
      const students = await db.studentProfile.findMany({
        select: { id: true, enrollments: { select: { offering: { select: { endsOn: true } } } } },
      })

      // An offering with no end date has not ended, so it is not "past".
      const hasEnded = (endsOn: Date | null) => endsOn !== null && endsOn < new Date()
      const activeOnly = students.filter((student) => {
        const offerings = student.enrollments.map((enrollment) => enrollment.offering)
        return offerings.length > 0 && offerings.every((offering) => !hasEnded(offering.endsOn))
      })

      expect(activeOnly.length).toBeGreaterThan(0)
    })
  })

  describe("assessment release", () => {
    it("has both a released assessment and an unreleased one", async () => {
      // The two branches of assessment visibility. With every assessment released
      // the branches render identically, so a broken visibility filter would demo
      // as working -- and the teacher's view would have nothing to distinguish.
      const released = await db.assessment.count({ where: { releasedAt: { not: null } } })
      const unreleased = await db.assessment.count({ where: { releasedAt: null } })

      expect(released).toBeGreaterThan(0)
      expect(unreleased).toBeGreaterThan(0)
    })

    it("does not set releasedAt from CourseOffering.resultsPublishedAt", async () => {
      // The two are different facts with different granularity, and the naming
      // exists to keep them apart. Assert the seed does not conflate them: the
      // release instant is per assessment, so the four do not share one value.
      const rows = await db.assessment.findMany({
        where: { releasedAt: { not: null } },
        select: { releasedAt: true },
      })
      const distinct = new Set(rows.map((row) => row.releasedAt?.toISOString()))

      expect(rows.length).toBeGreaterThan(1)
      expect(distinct.size).toBe(rows.length)
    })

    it("releases each assessment before its due date", async () => {
      // A release after the deadline would be a different, and wrong, story.
      const rows = await db.assessment.findMany({
        where: { releasedAt: { not: null } },
        select: { dueDate: true, releasedAt: true },
      })

      for (const row of rows) {
        expect(row.releasedAt!.getTime()).toBeLessThan(row.dueDate.getTime())
      }
    })
  })
})
