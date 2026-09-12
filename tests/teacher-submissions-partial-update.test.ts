import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for bug-fix run 3, S-1.
 *
 * `PUT /api/teacher/assessments/submissions` was a full-replace: a body that
 * omitted `score` was treated as `score: null`, which reverted a `GRADED`
 * submission to `SUBMITTED`, cleared `gradedAt`/`gradedById` and wiped the
 * feedback. A feedback-only request therefore destroyed a published mark.
 *
 * The route is now a partial update: a field is only written when the request
 * actually carries its key, while an explicit `score: null` (the client's
 * "clear the score" action) still deliberately un-grades. The grade itself is
 * the modern, published, audited `Grade` — `AssessmentGrade` was retired.
 */
const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { PUT } from "@/app/api/teacher/assessments/submissions/route"
import { signSessionValue } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

function setTeacherSession(userId: string, email: string) {
  mocks.getCookies.mockResolvedValue({
    get: (name: string) => ({
      name,
      value: signSessionValue({ id: userId, email, role: "teacher" }),
    }),
  })
}

function put(body: Record<string, unknown>) {
  return PUT(
    new Request("https://app.test/api/teacher/assessments/submissions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  )
}

const GRADED_AT = new Date("2026-09-01T10:00:00.000Z")

describe("PUT /api/teacher/assessments/submissions partial update", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function seedGradedSubmission() {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    const submission = await prisma.submission.create({
      data: {
        assessmentId: f.assessment.id,
        studentId,
        status: "GRADED",
        contentText: "submitted work",
        submittedAt: new Date("2026-08-30T10:00:00.000Z"),
        gradedAt: GRADED_AT,
        gradedById: f.teacher.staffProfile!.id,
        feedback: "Well done",
      },
    })
    await prisma.grade.create({
      data: {
        assessmentId: f.assessment.id,
        studentId,
        points: 15,
        maxPoints: f.assessment.maxMarks,
        percentage: (15 / f.assessment.maxMarks) * 100,
        source: "TEACHER_OVERRIDE",
        approvedById: f.teacher.staffProfile!.id,
        publishedAt: GRADED_AT,
      },
    })
    setTeacherSession(f.teacher.id, f.teacher.email)
    return { f, studentId, submission }
  }

  async function loadState(assessmentId: string, studentId: string) {
    const submission = await prisma.submission.findFirstOrThrow({
      where: { assessmentId, studentId },
    })
    const grade = await prisma.grade.findUniqueOrThrow({
      where: { assessmentId_studentId: { assessmentId, studentId } },
    })
    return { submission, grade }
  }

  it("leaves the grade, status and gradedAt intact when score is omitted", async () => {
    const { f, studentId, submission } = await seedGradedSubmission()

    // The request carries `feedback` but never mentions `score`. Before the fix
    // this reverted the submission to SUBMITTED and cleared gradedAt/gradedById.
    const response = await put({ submissionId: submission.id, feedback: "" })
    expect(response.status).toBe(200)

    const { submission: after, grade } = await loadState(f.assessment.id, studentId)
    expect(after.status).toBe("GRADED")
    expect(after.gradedAt?.toISOString()).toBe(GRADED_AT.toISOString())
    expect(after.gradedById).toBe(f.teacher.staffProfile!.id)
    expect(after.feedback).toBeNull()
    expect(Number(grade.points)).toBe(15)
    expect(grade.publishedAt?.toISOString()).toBe(GRADED_AT.toISOString())
  })

  it("treats a feedback-only request as a partial update", async () => {
    const { f, studentId, submission } = await seedGradedSubmission()

    const response = await put({ submissionId: submission.id, feedback: "Great improvement" })
    expect(response.status).toBe(200)

    const { submission: after, grade } = await loadState(f.assessment.id, studentId)
    expect(after.status).toBe("GRADED")
    expect(after.gradedAt?.toISOString()).toBe(GRADED_AT.toISOString())
    expect(after.feedback).toBe("Great improvement")
    expect(Number(grade.points)).toBe(15)
  })

  it("preserves feedback when only the score is updated", async () => {
    const { f, studentId, submission } = await seedGradedSubmission()

    const response = await put({ submissionId: submission.id, score: 18 })
    expect(response.status).toBe(200)

    const { submission: after, grade } = await loadState(f.assessment.id, studentId)
    expect(after.status).toBe("GRADED")
    expect(after.feedback).toBe("Well done")
    expect(Number(grade.points)).toBe(18)
    expect(grade.publishedAt).not.toBeNull()
  })

  it("still un-grades deliberately when score is explicitly null", async () => {
    const { f, studentId, submission } = await seedGradedSubmission()

    const response = await put({ submissionId: submission.id, score: null, feedback: "" })
    expect(response.status).toBe(200)

    const after = await prisma.submission.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(after.status).toBe("SUBMITTED")
    expect(after.gradedAt).toBeNull()
    expect(after.gradedById).toBeNull()
    expect(after.feedback).toBeNull()

    // Clearing removes the modern grade and is audited, never silently dropped.
    await expect(
      prisma.grade.count({ where: { assessmentId: f.assessment.id, studentId } }),
    ).resolves.toBe(0)
    await expect(
      prisma.auditLog.count({ where: { action: "grade.manual_mark_cleared" } }),
    ).resolves.toBe(1)
  })

  it("rejects a body that carries neither score nor feedback", async () => {
    const { f, studentId, submission } = await seedGradedSubmission()

    const response = await put({ submissionId: submission.id })
    // The seed helper sets the session; a request with nothing to update is a
    // client error, not a silent full replace.
    expect(response.status).toBe(400)

    const { submission: after, grade } = await loadState(f.assessment.id, studentId)
    expect(after.status).toBe("GRADED")
    expect(Number(grade.points)).toBe(15)
  })

  it("rejects malformed JSON with 400 instead of throwing", async () => {
    await seedGradedSubmission()

    const response = await PUT(
      new Request("https://app.test/api/teacher/assessments/submissions", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{not-json",
      }),
    )
    expect(response.status).toBe(400)
  })

  it("rejects an out-of-range score without changing anything", async () => {
    const { f, studentId, submission } = await seedGradedSubmission()

    const response = await put({ submissionId: submission.id, score: 9999 })
    expect(response.status).toBe(400)

    const { submission: after, grade } = await loadState(f.assessment.id, studentId)
    expect(after.status).toBe("GRADED")
    expect(Number(grade.points)).toBe(15)
  })
})
