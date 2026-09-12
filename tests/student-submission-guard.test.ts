import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the legacy submission route.
 *
 * A `GRADED` submission is the teacher's record of work that has already been
 * assessed. Before this guard, a student could POST `action: "submit"` (which
 * overwrote `GRADED` with `LATE`/`SUBMITTED`) and then `action: "saveDraft"`
 * (which set the status back to `DRAFT` and cleared `submittedAt`) while the
 * attached grade, feedback and `gradedAt` stayed in place.
 */
const mocks = vi.hoisted(() => ({ getCookies: vi.fn() }))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

import { POST } from "@/app/api/student/assessments/[assessmentId]/submission/route"
import { signSessionValue } from "@/lib/session"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

function setSessionCookie(value: string | null) {
  mocks.getCookies.mockResolvedValue({
    get: (name: string) => (value ? { name, value } : undefined),
  })
}

function submissionRequest(assessmentId: string, body: Record<string, unknown>) {
  return {
    request: new Request(`https://app.test/api/student/assessments/${assessmentId}/submission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    context: { params: Promise.resolve({ assessmentId }) },
  }
}

describe("student submission state guard", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function seedAssignment() {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    const assignment = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Legacy Assignment",
        type: "ASSIGNMENT",
        dueDate: new Date("2027-01-01T08:00:00.000Z"),
        maxMarks: 20,
        createdById: f.teacher.staffProfile!.id,
      },
    })
    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })
    setSessionCookie(
      signSessionValue({ id: f.student.id, email: f.student.email, role: "student" }),
    )
    return { f, studentId, assignment }
  }

  it("refuses to overwrite a graded submission and leaves it intact", async () => {
    const { assignment, studentId } = await seedAssignment()
    const gradedAt = new Date("2026-09-01T10:00:00.000Z")
    await prisma.submission.create({
      data: {
        assessmentId: assignment.id,
        studentId,
        status: "GRADED",
        contentText: "graded work",
        submittedAt: new Date("2026-08-30T10:00:00.000Z"),
        gradedAt,
      },
    })

    const submit = submissionRequest(assignment.id, { contentText: "new text", action: "submit" })
    const submitResponse = await POST(submit.request, submit.context)
    expect(submitResponse.status).toBe(409)

    const draft = submissionRequest(assignment.id, { contentText: "new text", action: "saveDraft" })
    const draftResponse = await POST(draft.request, draft.context)
    expect(draftResponse.status).toBe(409)

    const after = await prisma.submission.findFirstOrThrow({
      where: { assessmentId: assignment.id, studentId },
    })
    expect(after.status).toBe("GRADED")
    expect(after.contentText).toBe("graded work")
    expect(after.submittedAt?.toISOString()).toBe("2026-08-30T10:00:00.000Z")
  })

  it("rejects reverting a submitted assignment to a draft", async () => {
    const { assignment, studentId } = await seedAssignment()

    const submit = submissionRequest(assignment.id, {
      contentText: "submitted work",
      action: "submit",
    })
    const submitResponse = await POST(submit.request, submit.context)
    expect(submitResponse.status).toBe(200)

    const draft = submissionRequest(assignment.id, {
      contentText: "submitted work",
      action: "saveDraft",
    })
    const draftResponse = await POST(draft.request, draft.context)
    expect(draftResponse.status).toBe(409)

    const after = await prisma.submission.findFirstOrThrow({
      where: { assessmentId: assignment.id, studentId },
    })
    expect(after.status).toBe("SUBMITTED")
    expect(after.submittedAt).not.toBeNull()
  })

  it("still allows a genuine draft to be saved", async () => {
    const { assignment, studentId } = await seedAssignment()

    const draft = submissionRequest(assignment.id, { contentText: "wip", action: "saveDraft" })
    const response = await POST(draft.request, draft.context)
    expect(response.status).toBe(200)

    const after = await prisma.submission.findFirstOrThrow({
      where: { assessmentId: assignment.id, studentId },
    })
    expect(after.status).toBe("DRAFT")
    expect(after.submittedAt).toBeNull()
  })
})
