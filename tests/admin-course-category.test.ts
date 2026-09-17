import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  categorySettingResolvesFallback,
  listCourseGradingForAdmin,
} from "@/lib/analytics/course-category"
import { resolveRegimeForCourse } from "@/lib/analytics/grading-bands"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The admin course-category surface's two non-route rules:
 *
 * 1. **Which fallback a category can fix.** Only `category-unset` is a fact about the
 *    course's record. `small-class` and `awaiting-base-metrics` are correct behaviour that a
 *    category cannot change, and the UI must say so rather than let an admin read a correct
 *    result as a failed action. `non-theory-course` is permanent for the course's kind.
 * 2. **The list the admin page renders.** It resolves the regime per offering, so one
 *    category can produce a fixable fallback on one offering and an unfixable one on another.
 */

describe("which fallback setting a category can fix", () => {
  it("treats only category-unset as fixable", () => {
    expect(categorySettingResolvesFallback("category-unset")).toBe(true)
    expect(categorySettingResolvesFallback("small-class")).toBe(false)
    expect(categorySettingResolvesFallback("non-theory-course")).toBe(false)
    expect(categorySettingResolvesFallback("awaiting-base-metrics")).toBe(false)
  })

  it("produces the other reasons from real inputs, so the distinction is not hypothetical", () => {
    const spread = Array.from({ length: 12 }, (_, index) => 50 + index)

    // A theory course of 10 is absolute by headcount, and no category can change that.
    expect(
      resolveRegimeForCourse({ category: "THEORY", enrolledCount: 10, publishedTotals: spread }),
    ).toMatchObject({ regime: "absolute", reason: "small-class" })

    // A large theory course with too few published totals waits for the base metrics.
    expect(
      resolveRegimeForCourse({
        category: "THEORY",
        enrolledCount: 30,
        publishedTotals: spread.slice(0, 4),
      }),
    ).toMatchObject({ regime: "absolute", reason: "awaiting-base-metrics" })

    // The same inputs with enough totals are relative — the fallback was the data, not the
    // record, so it clears on its own.
    expect(
      resolveRegimeForCourse({ category: "THEORY", enrolledCount: 30, publishedTotals: spread })
        .regime,
    ).toBe("relative")

    // A lab is absolute at any size, so a category is the wrong lever entirely.
    expect(
      resolveRegimeForCourse({
        category: "LABORATORY",
        enrolledCount: 40,
        publishedTotals: spread,
      }),
    ).toMatchObject({ regime: "absolute", reason: "non-theory-course" })

    // An unset category is the one reason a category write fixes.
    expect(
      resolveRegimeForCourse({ category: null, enrolledCount: 40, publishedTotals: spread }),
    ).toMatchObject({ regime: "absolute", reason: "category-unset" })
  })
})

describe("listCourseGradingForAdmin", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function enrol(count: number, offeringId: string) {
    for (let index = 0; index < count; index += 1) {
      const user = await prisma.user.create({
        data: {
          email: `admin-category-${index}@spine.test`,
          passwordHash: "test-only-not-a-real-hash",
          role: "STUDENT",
          studentProfile: {
            create: { fullName: `Category Student ${index}`, registerNumber: `REG-CAT-${index}` },
          },
        },
        include: { studentProfile: true },
      })
      await prisma.enrollment.create({
        data: { studentId: user.studentProfile!.id, offeringId, status: "active" },
      })
    }
  }

  it("reports an unset category as the fixable fallback", async () => {
    const f = await createSpineFixture(prisma)

    const row = (await listCourseGradingForAdmin()).find((entry) => entry.courseId === f.course.id)
    expect(row?.category).toBeNull()
    expect(row?.offerings[0]).toMatchObject({
      regime: "absolute",
      reason: "category-unset",
      categoryFixable: true,
    })
  })

  it("reports a small theory class as a fallback a category cannot change", async () => {
    const f = await createSpineFixture(prisma)
    await prisma.course.update({ where: { id: f.course.id }, data: { category: "THEORY" } })
    await enrol(5, f.offering.id)

    const row = (await listCourseGradingForAdmin()).find((entry) => entry.courseId === f.course.id)
    expect(row?.category).toBe("THEORY")
    expect(row?.offerings[0]).toMatchObject({
      regime: "absolute",
      reason: "small-class",
      categoryFixable: false,
    })
  })
})
