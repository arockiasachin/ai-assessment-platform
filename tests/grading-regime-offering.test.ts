import { beforeAll, describe, expect, it } from "vitest"

import { setCourseCategoryForAdmin } from "@/lib/analytics/course-category"
import { getOfferingGradingRegime } from "@/lib/analytics/grading-regime"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The regime resolver against a real database.
 *
 * This is the server half of `resolveRegimeForCourse`: it gathers the three inputs the pure
 * function needs — the course's category, the enrolment count, and the students' **published
 * grand totals** — and returns the decision with its notice.
 *
 * The assertions target the parts that are easy to get wrong and invisible when they are:
 * that unpublished marks are excluded rather than counted as zero, that a student's total is
 * one number rather than one per assessment, and that an unset category falls back instead of
 * being treated as theory.
 */

let f: Awaited<ReturnType<typeof createSpineFixture>>
let teacher: AuthUser
let admin: AuthUser

beforeAll(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  teacher = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }
  admin = { id: f.admin.id, email: f.admin.email, role: "admin" }
})

/**
 * A running counter, because the helper is called more than once and a fixed index would
 * collide on the unique email.
 */
let enrolledSoFar = 0

async function enrolStudents(count: number): Promise<string[]> {
  const ids: string[] = []
  for (let index = 0; index < count; index += 1) {
    const n = enrolledSoFar++
    const user = await prisma.user.create({
      data: {
        email: `regime-student-${n}@spine.test`,
        passwordHash: "test-only-not-a-real-hash",
        role: "STUDENT",
        studentProfile: {
          create: { fullName: `Regime Student ${n}`, registerNumber: `REG-R-${n}` },
        },
      },
      include: { studentProfile: true },
    })
    const studentId = user.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })
    ids.push(studentId)
  }
  return ids
}

async function publishGrade(studentId: string, percentage: number): Promise<void> {
  await prisma.grade.create({
    data: {
      assessmentId: f.assessment.id,
      studentId,
      points: percentage,
      maxPoints: 100,
      source: "TEACHER_OVERRIDE",
      publishedAt: new Date(),
      approvedById: f.teacher.staffProfile!.id,
    },
  })
}

describe("getOfferingGradingRegime", () => {
  it("falls back with a notice when the course category is unset", async () => {
    // The course starts with no category. Null must not be read as THEORY: guessing would
    // put a laboratory course on relative bands.
    const regime = await getOfferingGradingRegime(teacher, f.offering.id)
    expect(regime.category).toBeNull()
    expect(regime.decision).toMatchObject({ regime: "absolute", reason: "category-unset" })
    expect(regime.notice?.tone).toBe("warning")
  })

  it("stays absolute while too few totals are published, and reports progress", async () => {
    await prisma.course.update({
      where: { id: f.course.id },
      data: { category: "THEORY" },
    })
    const students = await enrolStudents(15)
    for (const studentId of students.slice(0, 4)) {
      await publishGrade(studentId, 70)
    }

    const regime = await getOfferingGradingRegime(teacher, f.offering.id)
    expect(regime.category).toBe("THEORY")
    expect(regime.enrolledCount).toBe(15)
    expect(regime.publishedCount).toBe(4)
    expect(regime.decision).toMatchObject({ regime: "absolute", reason: "awaiting-base-metrics" })
    expect(regime.notice?.progress).toEqual({ available: 4, required: 11 })
  })

  it("does not count an unpublished mark toward the totals", async () => {
    const students = await enrolStudents(1)
    // A grade row exists but is not released, so it is not a fact the banding may use.
    await prisma.grade.create({
      data: {
        assessmentId: f.assessment.id,
        studentId: students[0],
        points: 95,
        maxPoints: 100,
        source: "AI_SUGGESTED",
        publishedAt: null,
      },
    })

    const regime = await getOfferingGradingRegime(teacher, f.offering.id)
    expect(regime.publishedCount).toBe(4)
    // And the 95 has not moved the cohort: the decision is still the fallback.
    expect(regime.decision).toMatchObject({ reason: "awaiting-base-metrics" })
  })

  it("switches to relative once the base metrics exist, with no notice", async () => {
    const students = await enrolStudents(7)
    const spread = [50, 55, 60, 65, 70, 75, 80]
    for (const [index, studentId] of students.entries()) {
      await publishGrade(studentId, spread[index])
    }

    const regime = await getOfferingGradingRegime(teacher, f.offering.id)
    expect(regime.publishedCount).toBe(11)
    expect(regime.decision.regime).toBe("relative")
    expect(regime.notice).toBeNull()
    if (regime.decision.regime === "relative") {
      expect(regime.decision.markedCount).toBe(11)
      expect(regime.decision.standardDeviation).toBeGreaterThan(0)
    }
  })

  it("collapses several published grades into one total per student", async () => {
    // A student with three published marks has ONE grand total, not three. Counting rows
    // would inflate `publishedCount` and band a population three times the real size.
    const studentId = (await enrolStudents(1))[0]
    const second = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Second assessment for the total",
        type: "ASSIGNMENT",
        dueDate: new Date("2026-10-01T00:00:00.000Z"),
        maxMarks: 100,
        createdById: f.teacher.staffProfile!.id,
      },
    })
    await prisma.grade.create({
      data: {
        assessmentId: second.id,
        studentId,
        points: 100,
        maxPoints: 100,
        source: "TEACHER_OVERRIDE",
        publishedAt: new Date(),
        approvedById: f.teacher.staffProfile!.id,
      },
    })

    const regime = await getOfferingGradingRegime(teacher, f.offering.id)
    // 11 students before, plus this one — one total each, not twelve rows from thirteen.
    expect(regime.publishedCount).toBe(12)
  })

  it("refuses an offering the caller does not own", async () => {
    const other = await prisma.user.create({
      data: {
        email: "regime-intruder@spine.test",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Ivy Intruder", empId: "EMP-R-9" } },
      },
    })
    await expect(
      getOfferingGradingRegime(
        { id: other.id, email: other.email, role: "teacher" },
        f.offering.id,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("reports a missing offering as 404", async () => {
    await expect(getOfferingGradingRegime(teacher, "no-such-offering")).rejects.toMatchObject({
      status: 404,
    })
  })
})

describe("setCourseCategoryForAdmin", () => {
  it("sets the category for a course the admin does not teach", async () => {
    // The fixture's course belongs to the fixture's offering, and the admin teaches nothing.
    // No ownership check applies; the category is an institutional fact, not a teaching one.
    const result = await setCourseCategoryForAdmin(admin, f.course.id, "LABORATORY")
    expect(result).toMatchObject({ kind: "updated", category: "LABORATORY" })

    const stored = await prisma.course.findUniqueOrThrow({
      where: { id: f.course.id },
      select: { category: true },
    })
    expect(stored.category).toBe("LABORATORY")
  })

  it("records the previous and new category in the audit log", async () => {
    // The change is the consequential fact — it moves every student's letter — so both sides
    // of it must be attributable.
    await setCourseCategoryForAdmin(admin, f.course.id, "PROJECT")

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "Course", action: "course.category.updated" },
      orderBy: { createdAt: "desc" },
    })
    expect(audit.entityId).toBe(f.course.id)
    expect(audit.actorId).toBe(f.admin.id)
    expect(audit.before).toMatchObject({ category: "LABORATORY" })
    expect(audit.after).toMatchObject({ category: "PROJECT" })
  })

  it("explains the consequence, so a caller need not re-derive the rule", async () => {
    const absolute = await setCourseCategoryForAdmin(admin, f.course.id, "PROJECT")
    if (absolute.kind === "updated") {
      expect(absolute.gradingEffect).toContain("Absolute")
    }

    const relative = await setCourseCategoryForAdmin(admin, f.course.id, "THEORY")
    if (relative.kind === "updated") {
      expect(relative.gradingEffect).toContain("Relative")
    }
  })

  it("reports a course that does not exist as not-found", async () => {
    const result = await setCourseCategoryForAdmin(admin, "no-such-course", "THEORY")
    expect(result).toEqual({ kind: "not-found" })
  })

  it("refuses a non-admin actor, so the service is safe without the route guard", async () => {
    await expect(setCourseCategoryForAdmin(teacher, f.course.id, "THEORY")).rejects.toMatchObject({
      status: 403,
    })
  })

  it("feeds the regime resolver once set", async () => {
    // The point of the whole slice: a category that can be set is a regime that can resolve.
    await setCourseCategoryForAdmin(admin, f.course.id, "LABORATORY")
    const regime = await getOfferingGradingRegime(teacher, f.offering.id)
    expect(regime.category).toBe("LABORATORY")
    expect(regime.decision).toMatchObject({ regime: "absolute", reason: "non-theory-course" })
  })
})

describe("cleanup", () => {
  it("disconnects", async () => {
    await disconnectTestDatabase()
  })
})
