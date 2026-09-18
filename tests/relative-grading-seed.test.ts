import { afterAll, describe, expect, it } from "vitest"

import { resolveRegimeForCourse } from "@/lib/analytics/grading-bands"
import { gatherRegimeInputs } from "@/lib/analytics/grading-regime"
import { getStudentAnalytics } from "@/lib/student-analytics"
import { COURSES_ACCOUNTS, COURSES_IDS, seedCourses } from "@/prisma/seed-courses"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"

/**
 * The relative grading branch must have a **seeded, rendered example**, not only a
 * unit test.
 *
 * `lib/analytics/grading-bands.ts` withholds relative grading until 11 totals are
 * published, and the student analytics page only states a course letter once a grand
 * total exists — which needs a published FAT. Every current-term offering keeps its FAT
 * unreleased, so without a completed offering that clears the floor the whole relative
 * path (regime note **and** `positionLetter`'s relative branch) is exercised only by
 * hand-built fixtures.
 *
 * This reads through the production path — `gatherRegimeInputs` +
 * `resolveRegimeForCourse` + `getStudentAnalytics` — so it fails if the seed stops
 * producing the example, rather than re-deriving the rule itself.
 */
describe("a seeded offering renders relative grading for a real student", () => {
  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("resolves the completed offering to relative and gives a student a relative letter", async () => {
    await truncateAll()
    await seedCourses()

    const offeringId = COURSES_IDS.offeringIds.pastDsaTheoryA

    const inputs = await gatherRegimeInputs(offeringId)
    expect(inputs.category).toBe("THEORY")
    expect(inputs.publishedTotals.length).toBeGreaterThanOrEqual(11)

    const decision = resolveRegimeForCourse(inputs)
    expect(decision.regime).toBe("relative")
    if (decision.regime !== "relative") throw new Error("unreachable")
    expect(decision.markedCount).toBe(inputs.publishedTotals.length)
    // A top boundary above 100 would switch to the rank rule and withhold the bands.
    expect(decision.mean + 1.5 * decision.standardDeviation).toBeLessThanOrEqual(100)

    const student = {
      id: COURSES_IDS.studentUserIds[0],
      email: COURSES_ACCOUNTS.students[0].email,
      role: "student" as const,
    }
    const analytics = await getStudentAnalytics(student)
    expect(analytics).not.toBeNull()

    const course = analytics!.courses.find((entry) => entry.offeringId === offeringId)
    expect(course, "the student is enrolled in the relative offering").toBeDefined()
    expect(course!.regime.regime).toBe("relative")
    expect(course!.regimeNote.regime).toBe("relative")
    // The letter is the point: it only exists because this offering's FAT is published.
    expect(course!.grandTotalLetter).not.toBeNull()
    expect(course!.grandTotalLetter).toMatch(/^[SABCDEF]$/)

    // And the offering really is in the database, not only in the decision objects.
    expect(
      await prisma.enrollment.count({
        where: { offeringId, studentId: COURSES_IDS.studentProfileIds[0], status: "active" },
      }),
    ).toBe(1)
  })
})
