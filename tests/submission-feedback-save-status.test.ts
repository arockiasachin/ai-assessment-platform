import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for TN-45.
 *
 * `components/teacher-submissions-manager.tsx` used to send `score` on every save, and an
 * empty score input validated to `score: null`. The route derives `status`/`gradedAt` from
 * `score`, so a feedback-only save was read as a deliberate un-grade: a `LATE` submission
 * became `SUBMITTED` with its flag destroyed, and a `DRAFT` became `SUBMITTED` with
 * `submittedAt` still null.
 *
 * The client now omits an untouched score (`buildSubmissionSaveBody`). This test drives the
 * real route with that body to prove a feedback-only save leaves the status alone, and that
 * an explicit `score: null` still deliberately clears a mark.
 */
const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { PUT } from "@/app/api/teacher/assessments/submissions/route"
import type { SubmissionStatus } from "@/lib/generated/prisma/enums"
import { signSessionValue } from "@/lib/session"
import { buildSubmissionSaveBody, type SubmissionEditorItem } from "@/lib/teacher-submissions-view"

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

const SUBMITTED_AT = new Date("2026-09-05T10:00:00.000Z")

describe("feedback-only save leaves the submission status alone (TN-45)", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function seedSubmission(status: SubmissionStatus, submittedAt: Date | null) {
    const f = await createSpineFixture(prisma)
    const submission = await prisma.submission.create({
      data: {
        assessmentId: f.assessment.id,
        studentId: f.student.studentProfile!.id,
        status,
        contentText: "work",
        submittedAt,
      },
    })
    setTeacherSession(f.teacher.id, f.teacher.email)

    const item: SubmissionEditorItem = {
      id: submission.id,
      status,
      contentText: submission.contentText,
      submittedAt: submittedAt?.toISOString() ?? null,
      gradedAt: null,
      feedback: null,
      student: {
        id: f.student.studentProfile!.id,
        fullName: "Sam Student",
        registerNumber: "REG-TEST-STUDENT",
        email: f.student.email,
      },
      assessment: {
        id: f.assessment.id,
        title: f.assessment.title,
        type: f.assessment.type,
        dueDate: f.assessment.dueDate.toISOString(),
        maxMarks: f.assessment.maxMarks,
        courseCode: f.course.code,
        courseName: f.course.name,
        className: "Spine Test Class",
      },
      score: null,
      published: false,
    }
    return { f, submission, item }
  }

  it("keeps a LATE submission LATE when only feedback is edited", async () => {
    const { submission, item } = await seedSubmission("LATE", SUBMITTED_AT)

    const built = buildSubmissionSaveBody({
      submissionId: submission.id,
      scoreDraft: undefined,
      feedbackDraft: "Returned late, but the method is right.",
      item,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const response = await put(built.body)
    expect(response.status).toBe(200)

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })
    expect(after.status).toBe("LATE")
    expect(after.submittedAt?.toISOString()).toBe(SUBMITTED_AT.toISOString())
    expect(after.feedback).toBe("Returned late, but the method is right.")
  })

  it("keeps a DRAFT a DRAFT with submittedAt still null", async () => {
    const { submission, item } = await seedSubmission("DRAFT", null)

    const built = buildSubmissionSaveBody({
      submissionId: submission.id,
      scoreDraft: undefined,
      feedbackDraft: "A note on the draft.",
      item,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const response = await put(built.body)
    expect(response.status).toBe(200)

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })
    expect(after.status).toBe("DRAFT")
    expect(after.submittedAt).toBeNull()
  })

  it("still un-grades when the teacher empties the score field", async () => {
    const { submission, item } = await seedSubmission("LATE", SUBMITTED_AT)

    // An empty string is a real edit — "clear this mark" — and must reach the route as an
    // explicit null rather than being omitted.
    const built = buildSubmissionSaveBody({
      submissionId: submission.id,
      scoreDraft: "",
      feedbackDraft: undefined,
      item,
    })
    expect(built.ok).toBe(true)
    if (!built.ok) return

    const response = await put(built.body)
    expect(response.status).toBe(200)

    const after = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })
    expect(after.status).toBe("SUBMITTED")
    expect(after.gradedAt).toBeNull()
  })
})
