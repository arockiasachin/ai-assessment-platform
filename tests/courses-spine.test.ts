import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { resolveRegimeForCourse } from "@/lib/analytics/grading-bands"
import { gatherRegimeInputs } from "@/lib/analytics/grading-regime"
import { evaluateFatGateForStudent } from "@/lib/grading/offering-config-service"
import { COURSES_IDS, seedCourses, type CoursesSeedSummary } from "@/prisma/seed-courses"

import { disconnectTestDatabase, prisma as db, truncateAll } from "./helpers/db"

/**
 * The MCSE501 / MCSE502 spine proof.
 *
 * The point of the course seed is **grading-regime coverage**, so that is what this file asserts —
 * and it asserts it through `gatherRegimeInputs` and `resolveRegimeForCourse`, the production
 * path, rather than by re-deriving the rule here. A test that recomputed `enrolledCount` and
 * `publishedTotals` itself would pass while the real reader was broken, which is exactly the
 * failure this dataset exists to catch.
 *
 * `resolveRegimeForCourse` checks, in order: `category === null`, `isCategoricallyAbsolute`,
 * `enrolledCount < 11`, `publishedTotals.length < 11`, `sigma === 0`, else relative. The seeded
 * data is arranged to land on **four** of those branches, and `enrolledCount` and
 * `publishedTotals.length` test different things — active enrolments versus students with at
 * least one published grade — so both are asserted separately.
 */

const OFFERINGS = COURSES_IDS.offeringIds

function assessmentIdFor(offeringId: string, suffix: string): string {
  return `${offeringId}-${suffix}`
}

let firstSummary: CoursesSeedSummary

describe("seeded MCSE501 / MCSE502 courses", () => {
  beforeAll(async () => {
    await truncateAll()
    firstSummary = await seedCourses()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("creates the four handbook course codes with their categories and credits", async () => {
    const courses = await db.course.findMany({
      where: {
        code: { in: ["MCSE501L", "MCSE501P", "MCSE502L", "MCSE502P"] },
      },
      orderBy: { code: "asc" },
    })

    expect(courses.map((course) => course.code)).toEqual([
      "MCSE501L",
      "MCSE501P",
      "MCSE502L",
      "MCSE502P",
    ])

    const byCode = new Map(courses.map((course) => [course.code, course]))
    // The category is load-bearing, not cosmetic: it is what puts the labs on absolute bands.
    expect(byCode.get("MCSE501L")?.category).toBe("THEORY")
    expect(byCode.get("MCSE502L")?.category).toBe("THEORY")
    expect(byCode.get("MCSE501P")?.category).toBe("LABORATORY")
    expect(byCode.get("MCSE502P")?.category).toBe("LABORATORY")
    expect(byCode.get("MCSE501L")?.credits).toBe(3)
    expect(byCode.get("MCSE502L")?.credits).toBe(3)
    expect(byCode.get("MCSE501P")?.credits).toBe(1)
    expect(byCode.get("MCSE502P")?.credits).toBe(1)
    // The objectives/outcomes text has no other home in the model.
    expect(byCode.get("MCSE501L")?.description).toContain("Course outcomes")
    expect(byCode.get("MCSE502P")?.description).toContain("indicative")
  })

  it("creates six offerings with the intended active enrolment counts", async () => {
    const expected: Record<string, number> = {
      [OFFERINGS.dsaTheoryA]: 9,
      [OFFERINGS.dsaTheoryB]: 15,
      [OFFERINGS.dsaLabA]: 9,
      [OFFERINGS.dsaLabB]: 15,
      [OFFERINGS.daaTheoryA]: 12,
      [OFFERINGS.daaLabA]: 12,
    }

    for (const [offeringId, count] of Object.entries(expected)) {
      const active = await db.enrollment.count({ where: { offeringId, status: "active" } })
      expect(active, `active enrolments in ${offeringId}`).toBe(count)
    }

    // The lab shares its theory cohort exactly, which is what "same students" means.
    for (const [theoryId, labId] of [
      [OFFERINGS.dsaTheoryA, OFFERINGS.dsaLabA],
      [OFFERINGS.dsaTheoryB, OFFERINGS.dsaLabB],
      [OFFERINGS.daaTheoryA, OFFERINGS.daaLabA],
    ] as const) {
      const theory = await db.enrollment.findMany({
        where: { offeringId: theoryId, status: "active" },
        select: { studentId: true },
      })
      const lab = await db.enrollment.findMany({
        where: { offeringId: labId, status: "active" },
        select: { studentId: true },
      })
      expect(new Set(lab.map((row) => row.studentId))).toEqual(
        new Set(theory.map((row) => row.studentId)),
      )
    }

    // Inactive enrolments exist and must not be counted by the regime reader.
    expect(
      await db.enrollment.count({
        where: { offeringId: OFFERINGS.dsaTheoryB, status: { not: "active" } },
      }),
    ).toBe(1)
    expect(
      await db.enrollment.count({
        where: { offeringId: OFFERINGS.daaTheoryA, status: { not: "active" } },
      }),
    ).toBe(1)
  })

  it("has the published-total counts the regime targets need", async () => {
    // A published total is `gatherRegimeInputs`' unit: one value per student who has at least one
    // published grade in the offering — not a count of grades.
    const expected: Record<string, number> = {
      [OFFERINGS.dsaTheoryA]: 9,
      [OFFERINGS.dsaTheoryB]: 13,
      [OFFERINGS.daaTheoryA]: 6,
      [OFFERINGS.dsaLabA]: 5,
      [OFFERINGS.dsaLabB]: 6,
      [OFFERINGS.daaLabA]: 5,
    }

    for (const [offeringId, count] of Object.entries(expected)) {
      const inputs = await gatherRegimeInputs(offeringId)
      expect(inputs.publishedTotals.length, `published totals in ${offeringId}`).toBe(count)
    }

    // Every published grade has an audit row from the real publish path. Scoped to the seeded
    // grades, because a `Grade` audit row's `entityId` is the grade id.
    const publishedGrades = await db.grade.findMany({
      where: {
        assessmentId: { in: COURSES_IDS.assessmentIds },
        publishedAt: { not: null },
      },
      select: { id: true },
    })
    expect(publishedGrades.length).toBeGreaterThan(0)
    const publishAudits = await db.auditLog.findMany({
      where: {
        entityType: "Grade",
        entityId: { in: publishedGrades.map((grade) => grade.id) },
        action: { in: ["grade.published", "grade.manual_mark_published"] },
      },
    })
    expect(publishAudits).toHaveLength(publishedGrades.length)
  })

  it("resolves each offering to its intended grading regime", async () => {
    // DSA section A: 9 enrolled, so `enrolledCount < 11` returns `small-class` before the metrics
    // check is reached — it never looks at the 9 published totals.
    const dsaA = await gatherRegimeInputs(OFFERINGS.dsaTheoryA)
    expect(dsaA.category).toBe("THEORY")
    expect(dsaA.enrolledCount).toBe(9)
    expect(dsaA.publishedTotals).toHaveLength(9)
    const dsaADecision = resolveRegimeForCourse(dsaA)
    expect(dsaADecision.regime).toBe("absolute")
    if (dsaADecision.regime !== "absolute") throw new Error("unreachable")
    expect(dsaADecision.reason).toBe("small-class")
    expect(dsaADecision.notice.tone).toBe("info")
    expect(dsaADecision.notice.title).toContain("class of 9")

    // DSA section B: 15 enrolled and 13 published totals with a real spread, so it is the one
    // offering that actually reaches relative grading.
    const dsaB = await gatherRegimeInputs(OFFERINGS.dsaTheoryB)
    expect(dsaB.enrolledCount).toBe(15)
    expect(dsaB.publishedTotals).toHaveLength(13)
    const dsaBDecision = resolveRegimeForCourse(dsaB)
    expect(dsaBDecision.regime).toBe("relative")
    if (dsaBDecision.regime !== "relative") throw new Error("unreachable")
    expect(dsaBDecision.markedCount).toBe(13)
    expect(dsaBDecision.standardDeviation).toBeGreaterThan(0)
    expect(dsaBDecision.mean).toBeGreaterThan(0)

    // DAA section A: 12 enrolled (enough for relative) but only 6 published totals, so it is
    // absolute with a **warning** notice and a progress indicator.
    const daaA = await gatherRegimeInputs(OFFERINGS.daaTheoryA)
    expect(daaA.enrolledCount).toBe(12)
    expect(daaA.publishedTotals).toHaveLength(6)
    const daaADecision = resolveRegimeForCourse(daaA)
    expect(daaADecision.regime).toBe("absolute")
    if (daaADecision.regime !== "absolute") throw new Error("unreachable")
    expect(daaADecision.reason).toBe("awaiting-base-metrics")
    expect(daaADecision.notice.tone).toBe("warning")
    expect(daaADecision.notice.progress).toEqual({ available: 6, required: 11 })

    // The three labs: `LABORATORY` is absolute at any size, whatever their headcounts are.
    const labCases = [
      { offeringId: OFFERINGS.dsaLabA, enrolled: 9 },
      { offeringId: OFFERINGS.dsaLabB, enrolled: 15 },
      { offeringId: OFFERINGS.daaLabA, enrolled: 12 },
    ] as const
    for (const lab of labCases) {
      const inputs = await gatherRegimeInputs(lab.offeringId)
      expect(inputs.category).toBe("LABORATORY")
      expect(inputs.enrolledCount).toBe(lab.enrolled)
      const decision = resolveRegimeForCourse(inputs)
      expect(decision.regime).toBe("absolute")
      if (decision.regime !== "absolute") throw new Error("unreachable")
      expect(decision.reason).toBe("non-theory-course")
      expect(decision.notice.tone).toBe("info")
    }
  })

  it("exercises the FAT gate with real CAT standings", async () => {
    const fatAssessmentId = assessmentIdFor(OFFERINGS.dsaTheoryB, "fat")

    // Student 21 is deliberately below the 30% CAT minimum, so the gate refuses the FAT.
    const below = await evaluateFatGateForStudent({
      offeringId: OFFERINGS.dsaTheoryB,
      assessmentId: fatAssessmentId,
      studentId: COURSES_IDS.studentProfileIds[21],
    })
    expect(below.allowed).toBe(false)
    if (below.allowed) throw new Error("unreachable")
    expect(below.reason).toBe("below-cat-minimum")

    // A student with marks above the minimum is allowed through.
    const above = await evaluateFatGateForStudent({
      offeringId: OFFERINGS.dsaTheoryB,
      assessmentId: fatAssessmentId,
      studentId: COURSES_IDS.studentProfileIds[13],
    })
    expect(above.allowed).toBe(true)

    // An unmarked student gets `insufficient-cat-work`, which must **not** refuse: the marking is
    // unfinished, not the student at fault.
    const unmarked = await evaluateFatGateForStudent({
      offeringId: OFFERINGS.dsaTheoryB,
      assessmentId: fatAssessmentId,
      studentId: COURSES_IDS.studentProfileIds[22],
    })
    expect(unmarked.allowed).toBe(true)
  })

  it("seeds course-wide material, code tasks, release state and is idempotent", async () => {
    const materials = await db.material.findMany({
      where: { id: { in: COURSES_IDS.materialIds } },
      select: { offeringId: true, contentText: true },
    })
    expect(materials).toHaveLength(40)
    expect(materials.every((material) => material.offeringId === null)).toBe(true)
    expect(materials.every((material) => (material.contentText ?? "").length > 0)).toBe(true)

    // Course-wide syllabus materials are indexed through lib/vector, embeddings included. The
    // test database is truncated at the start, so every chunk here belongs to this seed.
    const embedded = await db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS "count" FROM "MaterialChunk" WHERE "embedding" IS NOT NULL
    `
    expect(Number(embedded[0].count)).toBe(firstSummary.materialChunks)
    expect(
      await db.materialChunk.count({ where: { materialId: { in: COURSES_IDS.materialIds } } }),
    ).toBe(firstSummary.materialChunks)

    expect(await db.codeTask.count({ where: { id: { in: COURSES_IDS.codeTaskIds } } })).toBe(3)
    expect(
      await db.testCase.count({ where: { codeTaskId: { in: COURSES_IDS.codeTaskIds } } }),
    ).toBe(9)
    expect(await db.testRun.count({ where: { codeTaskId: { in: COURSES_IDS.codeTaskIds } } })).toBe(
      1,
    )

    // Some assessments are released, and at least one is not, so a visibility filter is testable.
    const assessments = await db.assessment.findMany({
      where: { id: { in: COURSES_IDS.assessmentIds } },
      select: { releasedAt: true, dueDate: true },
    })
    expect(assessments.some((assessment) => assessment.releasedAt !== null)).toBe(true)
    expect(assessments.some((assessment) => assessment.releasedAt === null)).toBe(true)
    // A release instant in the future would be a contradiction, not a fixture.
    const now = Date.now()
    for (const assessment of assessments) {
      if (assessment.releasedAt) expect(assessment.releasedAt.getTime()).toBeLessThanOrEqual(now)
    }

    // Re-running replaces rather than duplicating, and produces the same counts.
    const secondSummary = await seedCourses()
    expect(secondSummary).toEqual(firstSummary)
  })
})
