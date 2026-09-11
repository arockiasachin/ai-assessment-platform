import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Route-level proof that the analytics APIs enforce their roles, and that a
 * rejected request never reaches the database-backed service. The service is
 * mocked so a denial cannot touch the database.
 */
const mocks = vi.hoisted(() => ({
  getTeacherAnalyticsOverview: vi.fn(),
  getAssessmentItemAnalysisForTeacher: vi.fn(),
  getAdaptiveRetakeForStudent: vi.fn(),
  getCookies: vi.fn(),
}))

vi.mock("@/lib/analytics/service", () => ({
  getTeacherAnalyticsOverview: mocks.getTeacherAnalyticsOverview,
  getAssessmentItemAnalysisForTeacher: mocks.getAssessmentItemAnalysisForTeacher,
  getAdaptiveRetakeForStudent: mocks.getAdaptiveRetakeForStudent,
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// These route tests use synthetic sessions that have no User row; the real
// database re-validation is covered by tests/session-role-revalidation.test.ts.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { GET as teacherOverviewGet } from "@/app/api/teacher/analytics/route"
import { GET as teacherItemsGet } from "@/app/api/teacher/analytics/items/route"
import { GET as studentRetakeGet } from "@/app/api/student/analytics/retake/route"
import { signSessionValue } from "@/lib/session"

const TEACHER = { id: "teacher-1", email: "teacher@test.local", role: "teacher" as const }
const STUDENT = { id: "student-1", email: "student@test.local", role: "student" as const }

function useSession(user: typeof TEACHER | typeof STUDENT | null) {
  mocks.getCookies.mockReturnValue({
    get: () => (user ? { name: "auth-user", value: signSessionValue(user) } : undefined),
  })
}

describe("teacher analytics routes", () => {
  beforeEach(() => {
    mocks.getTeacherAnalyticsOverview.mockReset()
    mocks.getAssessmentItemAnalysisForTeacher.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and student callers before the service runs", async () => {
    useSession(null)
    expect(
      (
        await teacherOverviewGet(
          new Request("https://app.test/api/teacher/analytics?offeringId=o1"),
        )
      ).status,
    ).toBe(401)
    expect(
      (
        await teacherItemsGet(
          new Request("https://app.test/api/teacher/analytics/items?assessmentId=a1"),
        )
      ).status,
    ).toBe(401)

    useSession(STUDENT)
    expect(
      (
        await teacherOverviewGet(
          new Request("https://app.test/api/teacher/analytics?offeringId=o1"),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await teacherItemsGet(
          new Request("https://app.test/api/teacher/analytics/items?assessmentId=a1"),
        )
      ).status,
    ).toBe(403)
    expect(mocks.getTeacherAnalyticsOverview).not.toHaveBeenCalled()
    expect(mocks.getAssessmentItemAnalysisForTeacher).not.toHaveBeenCalled()
  })

  it("rejects a malformed request without calling the service", async () => {
    useSession(TEACHER)
    expect(
      (await teacherOverviewGet(new Request("https://app.test/api/teacher/analytics"))).status,
    ).toBe(400)
    expect(
      (await teacherItemsGet(new Request("https://app.test/api/teacher/analytics/items"))).status,
    ).toBe(400)
    expect(
      (
        await teacherOverviewGet(
          new Request("https://app.test/api/teacher/analytics?offeringId=o1&classAverageBelow=abc"),
        )
      ).status,
    ).toBe(400)
    expect(mocks.getTeacherAnalyticsOverview).not.toHaveBeenCalled()
  })

  it("passes an authorized request through to the service", async () => {
    mocks.getTeacherAnalyticsOverview.mockResolvedValue({
      offerings: [],
      offeringId: "o1",
      assessments: [],
      alerts: [],
      thresholds: {
        classAverageBelow: 60,
        minClassSampleSize: 5,
        contributionShareAtLeast: 0.6,
        minContributionEvents: 3,
        pendingReviewsAtLeast: 1,
      },
      generatedAt: new Date().toISOString(),
    })
    mocks.getAssessmentItemAnalysisForTeacher.mockResolvedValue({
      assessment: { id: "a1", title: "Quiz", offeringId: "o1", maxMarks: 10, studentCount: 0 },
      cohort: {
        count: 0,
        average: null,
        passRate: null,
        passThreshold: 60,
        highest: null,
        lowest: null,
        buckets: [],
      },
      items: [],
      thresholds: {
        minAttemptsForDifficulty: 10,
        minAttemptsForDiscrimination: 20,
        extremeGroupFraction: 0.27,
      },
      generatedAt: new Date().toISOString(),
    })
    useSession(TEACHER)

    expect(
      (
        await teacherOverviewGet(
          new Request("https://app.test/api/teacher/analytics?offeringId=o1"),
        )
      ).status,
    ).toBe(200)
    expect(
      (
        await teacherItemsGet(
          new Request("https://app.test/api/teacher/analytics/items?assessmentId=a1"),
        )
      ).status,
    ).toBe(200)
    expect(mocks.getTeacherAnalyticsOverview).toHaveBeenCalledTimes(1)
    expect(mocks.getAssessmentItemAnalysisForTeacher).toHaveBeenCalledTimes(1)
  })
})

describe("student retake route", () => {
  beforeEach(() => {
    mocks.getAdaptiveRetakeForStudent.mockReset()
    mocks.getCookies.mockReset()
  })

  it("rejects anonymous and teacher callers before the service runs", async () => {
    useSession(null)
    expect(
      (
        await studentRetakeGet(
          new Request("https://app.test/api/student/analytics/retake?assessmentId=a1"),
        )
      ).status,
    ).toBe(401)

    useSession(TEACHER)
    expect(
      (
        await studentRetakeGet(
          new Request("https://app.test/api/student/analytics/retake?assessmentId=a1"),
        )
      ).status,
    ).toBe(403)
    expect(mocks.getAdaptiveRetakeForStudent).not.toHaveBeenCalled()
  })

  it("requires an assessment id", async () => {
    useSession(STUDENT)
    expect(
      (await studentRetakeGet(new Request("https://app.test/api/student/analytics/retake"))).status,
    ).toBe(400)
    expect(mocks.getAdaptiveRetakeForStudent).not.toHaveBeenCalled()
  })

  it("passes an authorized request through to the service", async () => {
    mocks.getAdaptiveRetakeForStudent.mockResolvedValue({
      assessment: { id: "a1", title: "Quiz", maxMarks: 10 },
      sourceAttemptId: "attempt-1",
      totalQuestions: 2,
      questionIds: ["q2"],
      failedQuestionIds: ["q2"],
      unansweredQuestionIds: [],
      includeUnanswered: true,
      questions: [],
      previousResponses: [],
      generatedAt: new Date().toISOString(),
    })
    useSession(STUDENT)
    const response = await studentRetakeGet(
      new Request("https://app.test/api/student/analytics/retake?assessmentId=a1"),
    )
    expect(response.status).toBe(200)
    expect(mocks.getAdaptiveRetakeForStudent).toHaveBeenCalledTimes(1)
  })
})
