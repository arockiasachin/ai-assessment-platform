import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Regression coverage for the legacy submission route.
 *
 * A `GRADED` submission is the teacher's record of work that has already been
 * assessed. Before this guard, a student could POST `action: "submit"` (which
 * overwrote `GRADED` with `LATE`/`SUBMITTED`) and then `action: "saveDraft"`
 * (which set the status back to `DRAFT` and cleared `submittedAt`) while the
 * attached grade, feedback and `gradedAt` stayed in place.
 *
 * The route also carries the **server half of SN-5**: release governs use, not
 * only visibility. An unreleased assessment is refused at the lookup, so a
 * student who knows its id cannot create a submission the list never offered.
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

  async function seedAssignment({ released = true }: { released?: boolean } = {}) {
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
        // Release governs whether the route will touch the assessment at all.
        // Every test here is about a submission a student is entitled to make, so
        // the fixture is released by default; the release-guard tests pass
        // `released: false` to pin the other branch.
        releasedAt: released ? new Date("2026-09-01T08:00:00.000Z") : null,
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

  it("refuses a submission to an unreleased assessment by id, and writes nothing", async () => {
    // SN-5's server half. Hiding the assessment from the list closes the UI flow
    // only; a student who knows the id must not be able to reach it directly. The
    // refusal is 404 "Assessment not found." on purpose — the route must not
    // confirm that an assessment it will not show exists.
    const { assignment, studentId } = await seedAssignment({ released: false })

    const submit = submissionRequest(assignment.id, {
      contentText: "hidden work",
      action: "submit",
    })
    const response = await POST(submit.request, submit.context)

    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({
      success: false,
      message: "Assessment not found.",
    })
    expect(
      await prisma.submission.count({ where: { assessmentId: assignment.id, studentId } }),
    ).toBe(0)
  })

  it("refuses saving a draft to an unreleased assessment too", async () => {
    // The guard is on the lookup, not the action, so both `submit` and `saveDraft`
    // are refused by the same rule.
    const { assignment, studentId } = await seedAssignment({ released: false })

    const draft = submissionRequest(assignment.id, {
      contentText: "hidden wip",
      action: "saveDraft",
    })
    const response = await POST(draft.request, draft.context)

    expect(response.status).toBe(404)
    expect(
      await prisma.submission.count({ where: { assessmentId: assignment.id, studentId } }),
    ).toBe(0)
  })
})
