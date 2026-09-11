import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import {
  getAdaptiveRetakeForStudent,
  getAssessmentItemAnalysisForTeacher,
  getTeacherAnalyticsOverview,
  listStudentRetakableAssessmentsForStudent,
  listTeacherOfferingsForAnalytics,
} from "@/lib/analytics/service"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import {
  analyticsStudentSession,
  analyticsTeacherSession,
  createAnalyticsFixture,
  createPendingReview,
  recordAnalyticsAttempt,
} from "./fixtures/analytics"

async function createOtherTeacher(): Promise<AuthUser> {
  const user = await prisma.user.create({
    data: {
      email: "other-analytics-teacher@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Other", empId: "EMP-ANALYTICS-OTHER" } },
    },
  })
  return { id: user.id, email: user.email, role: "teacher" }
}

describe("analytics service — item analysis from real attempts", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("computes per-question difficulty and discrimination from QuizAttempt data", async () => {
    const fixture = await createAnalyticsFixture(prisma, { studentCount: 20 })
    const teacher = analyticsTeacherSession(fixture)

    for (const [index, student] of fixture.students.entries()) {
      await recordAnalyticsAttempt(prisma, {
        assessmentId: fixture.assessment.id,
        studentId: student.profileId,
        questions: fixture.questions,
        flags: [index < 15, index < 10, index < 5, index >= 18],
      })
    }

    const analysis = await getAssessmentItemAnalysisForTeacher(teacher, {
      assessmentId: fixture.assessment.id,
    })

    expect(analysis.assessment.studentCount).toBe(20)
    expect(analysis.items).toHaveLength(4)
    expect(analysis.items.map((item) => item.questionOrder)).toEqual([1, 2, 3, 4])

    const [q1, q2, q3, q4] = analysis.items
    expect(q1.facilityIndex).toBeCloseTo(0.75, 10)
    expect(q1.difficultyIndex).toBeCloseTo(0.25, 10)
    expect(q1.discriminationIndex).toBeCloseTo(1, 10)
    expect(q2.facilityIndex).toBeCloseTo(0.5, 10)
    expect(q3.facilityIndex).toBeCloseTo(0.25, 10)
    // The last question is answered almost only by the weakest students.
    expect(q4.discriminationIndex).toBeCloseTo(-0.4, 10)

    // Cohort distribution reflects the same attempts (average score 40%).
    expect(analysis.cohort.count).toBe(20)
    expect(analysis.cohort.average).toBeCloseTo(40, 6)
    expect(analysis.cohort.passRate).toBe(25)

    // No answer key anywhere in the payload.
    const serialized = JSON.stringify(analysis)
    expect(serialized).not.toContain("correctOptionId")
    expect(serialized).not.toContain("isCorrect")
  })

  it("reports insufficient data honestly for a tiny cohort", async () => {
    const fixture = await createAnalyticsFixture(prisma, { studentCount: 2 })
    const teacher = analyticsTeacherSession(fixture)
    for (const student of fixture.students) {
      await recordAnalyticsAttempt(prisma, {
        assessmentId: fixture.assessment.id,
        studentId: student.profileId,
        questions: fixture.questions,
        flags: [true, false, true, false],
      })
    }

    const analysis = await getAssessmentItemAnalysisForTeacher(teacher, {
      assessmentId: fixture.assessment.id,
    })
    for (const item of analysis.items) {
      expect(item.difficultyIndex).toBeNull()
      expect(item.discriminationIndex).toBeNull()
      expect(item.insufficientData).toBe(true)
      expect(item.notes.length).toBeGreaterThan(0)
    }
  })
})

describe("analytics service — intervention alerts", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("fires class-average, contribution-imbalance and pending-review alerts", async () => {
    const fixture = await createAnalyticsFixture(prisma, { studentCount: 20 })
    const teacher = analyticsTeacherSession(fixture)

    for (const student of fixture.students) {
      await recordAnalyticsAttempt(prisma, {
        assessmentId: fixture.assessment.id,
        studentId: student.profileId,
        questions: fixture.questions,
        flags: fixture.questions.map(() => false),
      })
    }

    await createPendingReview(prisma, {
      assessmentId: fixture.assessment.id,
      studentId: fixture.students[0].profileId,
    })

    const group = await prisma.group.create({
      data: {
        offeringId: fixture.offering.id,
        name: "Alpha",
        members: {
          create: fixture.students.slice(0, 3).map((student) => ({ studentId: student.profileId })),
        },
      },
    })
    await prisma.contributionEvent.createMany({
      data: Array.from({ length: 4 }).map(() => ({
        groupId: group.id,
        studentId: fixture.students[0].profileId,
        type: "COMMIT" as const,
        weight: 3,
        occurredAt: new Date(),
      })),
    })

    const overview = await getTeacherAnalyticsOverview(teacher, {
      offeringId: fixture.offering.id,
    })

    expect(overview.offeringId).toBe(fixture.offering.id)
    expect(overview.assessments[0].average).toBe(0)
    expect(overview.assessments[0].attemptCount).toBe(20)

    const types = overview.alerts.map((alert) => alert.type).sort()
    expect(types).toContain("class-average-below-threshold")
    expect(types).toContain("contribution-imbalance")
    expect(types).toContain("pending-reviews")

    // Raising the other thresholds independently suppresses those alerts.
    const quiet = await getTeacherAnalyticsOverview(teacher, {
      offeringId: fixture.offering.id,
      thresholds: { pendingReviewsAtLeast: 99, minContributionEvents: 99 },
    })
    expect(quiet.alerts.some((alert) => alert.type === "pending-reviews")).toBe(false)
    expect(quiet.alerts.some((alert) => alert.type === "contribution-imbalance")).toBe(false)
  })
})

describe("analytics service — adaptive retake scoping", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("targets the signed-in student's own failed questions only", async () => {
    const fixture = await createAnalyticsFixture(prisma, { studentCount: 2 })
    const [studentA, studentB] = fixture.students

    const attemptA = await recordAnalyticsAttempt(prisma, {
      assessmentId: fixture.assessment.id,
      studentId: studentA.profileId,
      questions: fixture.questions,
      flags: [true, false, null, null],
    })
    await recordAnalyticsAttempt(prisma, {
      assessmentId: fixture.assessment.id,
      studentId: studentB.profileId,
      questions: fixture.questions,
      flags: [false, false, true, true],
    })

    const [q1, q2, q3, q4] = fixture.questions
    const retake = await getAdaptiveRetakeForStudent(analyticsStudentSession(studentA), {
      assessmentId: fixture.assessment.id,
    })

    expect(retake.sourceAttemptId).toBe(attemptA.id)
    expect(retake.failedQuestionIds).toEqual([q2.id])
    expect(retake.unansweredQuestionIds).toEqual([q3.id, q4.id])
    expect(retake.questionIds).toEqual([q2.id, q3.id, q4.id])
    expect(retake.questions.map((question) => question.id)).toEqual([q2.id, q3.id, q4.id])
    // Student B's wrong answers never appear in A's retake.
    expect(retake.questionIds).not.toContain(q1.id)

    // The question payload carries no answer key.
    const serializedQuestions = JSON.stringify(retake.questions)
    expect(serializedQuestions).not.toContain("correctOptionId")
    expect(serializedQuestions).not.toContain("isCorrect")

    const wrongOnly = await getAdaptiveRetakeForStudent(analyticsStudentSession(studentA), {
      assessmentId: fixture.assessment.id,
      includeUnanswered: false,
    })
    expect(wrongOnly.questionIds).toEqual([q2.id])

    const retakable = await listStudentRetakableAssessmentsForStudent(
      analyticsStudentSession(studentA),
    )
    expect(retakable.map((entry) => entry.id)).toEqual([fixture.assessment.id])
    expect(retakable[0].failedCount).toBe(1)
    expect(retakable[0].unansweredCount).toBe(2)
  })

  it("denies a student who is not enrolled in the offering", async () => {
    const fixture = await createAnalyticsFixture(prisma, { studentCount: 1 })
    const outsider: AuthUser = {
      id: fixture.student.id,
      email: fixture.student.email,
      role: "student",
    }
    await expect(
      getAdaptiveRetakeForStudent(outsider, { assessmentId: fixture.assessment.id }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe("analytics service — teacher scoping", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("denies cross-teacher access to another teacher's offering and assessment", async () => {
    const fixture = await createAnalyticsFixture(prisma, { studentCount: 1 })
    const otherTeacher = await createOtherTeacher()

    await expect(
      getTeacherAnalyticsOverview(otherTeacher, { offeringId: fixture.offering.id }),
    ).rejects.toMatchObject({ status: 403 })
    await expect(
      getAssessmentItemAnalysisForTeacher(otherTeacher, {
        assessmentId: fixture.assessment.id,
      }),
    ).rejects.toMatchObject({ status: 403 })

    // The other teacher's own offering list never contains the fixture offering.
    const theirOfferings = await listTeacherOfferingsForAnalytics(otherTeacher)
    expect(theirOfferings).toEqual([])

    // A student is refused the teacher surface entirely.
    await expect(
      getAssessmentItemAnalysisForTeacher(analyticsStudentSession(fixture.students[0]), {
        assessmentId: fixture.assessment.id,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})
