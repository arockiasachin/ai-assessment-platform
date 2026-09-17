import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { getTeacherAnalyticsOverview } from "@/lib/analytics/service"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * The overview's per-assessment summary must count released `Grade` rows (TN-3 / TL-3).
 *
 * The audit's reproduction: `/teacher/analytics` reported `attemptCount: 0, average: null` for
 * every assessment while the same payload reported nine published marks and eighteen released
 * marks. A manual mark has no `QuizAttempt`, so a reader built from attempts alone cannot see it.
 * This runs the real service against a manual-marked assessment with no attempt.
 */

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

describe("teacher analytics overview counts Grade rows", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("reports the mark and the average for an assessment with no attempt", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const student = f.student.studentProfile!

    // A manual-marked assignment: nine published marks, zero `QuizAttempt` rows — the seeded
    // M.Tech shape the audit cited.
    await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Manual Assignment",
        type: "ASSIGNMENT",
        dueDate: new Date("2026-11-01T08:00:00.000Z"),
        maxMarks: 50,
        createdById: f.teacher.staffProfile!.id,
        releasedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    })
    const manual = await prisma.assessment.findFirstOrThrow({
      where: { offeringId: f.offering.id, title: "Manual Assignment" },
    })
    await prisma.grade.create({
      data: {
        assessmentId: manual.id,
        studentId: student.id,
        points: 40,
        maxPoints: 50,
        publishedAt: new Date(),
      },
    })

    const overview = await getTeacherAnalyticsOverview(actor, { offeringId: f.offering.id })
    const row = overview.assessments.find((assessment) => assessment.id === manual.id)

    expect(row).toBeDefined()
    // Before the fix: attemptCount 0 and average null, because the reader only looked at attempts.
    expect(row?.attemptCount).toBe(1)
    expect(row?.average).toBe(80)
    expect(row?.passRate).toBe(100)
  })

  it("counts a student once when they have both an attempt and a released mark", async () => {
    const f = await createSpineFixture(prisma)
    const actor = teacherSession(f.teacher)
    const student = f.student.studentProfile!

    await prisma.quizAttempt.create({
      data: {
        assessmentId: f.assessment.id,
        studentId: student.id,
        attemptNumber: 1,
        status: "SUBMITTED",
        kind: "GRADED",
        score: 5,
        maxScore: 20,
        submittedAt: new Date(),
      },
    })
    await prisma.grade.create({
      data: {
        assessmentId: f.assessment.id,
        studentId: student.id,
        points: 16,
        maxPoints: 20,
        publishedAt: new Date(),
      },
    })

    const overview = await getTeacherAnalyticsOverview(actor, { offeringId: f.offering.id })
    const row = overview.assessments.find((assessment) => assessment.id === f.assessment.id)

    expect(row?.attemptCount).toBe(1)
    // The released mark wins over the unreleased attempt percentage (5/20 = 25).
    expect(row?.average).toBe(80)
  })
})
