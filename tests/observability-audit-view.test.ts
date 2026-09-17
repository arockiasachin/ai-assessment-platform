import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { AiGradeSuggestionInput } from "@/lib/contracts"
import { recordAiSuggestion, submitReviewDecision } from "@/lib/grading"
import { getRecentGradeActivityForTeacher } from "@/lib/observability/audit-view"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

function suggestion(
  assessmentId: string,
  studentId: string,
  overrides: Partial<AiGradeSuggestionInput> = {},
): AiGradeSuggestionInput {
  return {
    assessmentId,
    studentId,
    suggestedPoints: 5,
    rationale: "Quotes the student's text.",
    confidence: 0.8,
    model: "mock-llm",
    promptVersion: "v1",
    latencyMs: 12,
    ...overrides,
  }
}

describe("teacher grade-activity view", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("returns the offering's recent grade-pipeline activity to its owner", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id

    await recordAiSuggestion(suggestion(f.assessment.id, studentId, { criterionLabel: "Argument" }))
    await submitReviewDecision({
      assessmentId: f.assessment.id,
      studentId,
      reviewer: { id: f.teacher.id, role: "teacher" },
      decision: { action: "accept" },
    })

    const activity = await getRecentGradeActivityForTeacher(
      { id: f.teacher.id },
      { offeringId: f.offering.id, limit: 25 },
    )

    const actions = activity.items.map((item) => item.action)
    expect(actions).toContain("ai_suggestion.recorded")
    expect(actions).toContain("grade.ai_draft_created")
    expect(actions).toContain("grade.published")
    expect(activity.truncated).toBe(false)
    expect(activity.items.every((item) => item.assessmentId === f.assessment.id)).toBe(true)
    expect(activity.items.find((item) => item.action === "grade.published")?.actorRole).toBe(
      "teacher",
    )
  })

  it("denies a teacher who does not own the offering", async () => {
    const f = await createSpineFixture(prisma)
    const other = await prisma.user.create({
      data: {
        email: "other-observability@test.local",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Other Teacher", empId: "EMP-OBS-OTHER" } },
      },
    })

    await expect(
      getRecentGradeActivityForTeacher({ id: other.id }, { offeringId: f.offering.id, limit: 25 }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("404s an offering that does not exist", async () => {
    const f = await createSpineFixture(prisma)
    await expect(
      getRecentGradeActivityForTeacher(
        { id: f.teacher.id },
        { offeringId: "does-not-exist", limit: 25 },
      ),
    ).rejects.toMatchObject({ status: 404 })
  })

  it("scopes activity to the requested offering, not every offering the teacher owns", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id

    const secondOffering = await prisma.courseOffering.create({
      data: {
        courseId: f.course.id,
        classId: f.classroom.id,
        teacherId: f.teacher.staffProfile!.id,
        term: "Term-Second",
        academicYear: 2026,
      },
    })
    const secondAssessment = await prisma.assessment.create({
      data: {
        offeringId: secondOffering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Second Quiz",
        type: "QUIZ",
        dueDate: new Date("2026-11-01T08:00:00.000Z"),
        maxMarks: 20,
        createdById: f.teacher.staffProfile!.id,
      },
    })

    await recordAiSuggestion(suggestion(f.assessment.id, studentId, { criterionLabel: "Argument" }))
    await recordAiSuggestion(
      suggestion(secondAssessment.id, studentId, { criterionLabel: "Argument" }),
    )

    const first = await getRecentGradeActivityForTeacher(
      { id: f.teacher.id },
      { offeringId: f.offering.id, limit: 25 },
    )
    const second = await getRecentGradeActivityForTeacher(
      { id: f.teacher.id },
      { offeringId: secondOffering.id, limit: 25 },
    )

    expect(first.items.length).toBeGreaterThan(0)
    expect(first.items.every((item) => item.assessmentId === f.assessment.id)).toBe(true)
    expect(second.items.length).toBeGreaterThan(0)
    expect(second.items.every((item) => item.assessmentId === secondAssessment.id)).toBe(true)
  })

  it("caps the page size and flags truncation", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    for (const label of ["Argument", "Evidence", "Clarity"]) {
      await recordAiSuggestion(suggestion(f.assessment.id, studentId, { criterionLabel: label }))
    }

    const activity = await getRecentGradeActivityForTeacher(
      { id: f.teacher.id },
      { offeringId: f.offering.id, limit: 2 },
    )
    expect(activity.items).toHaveLength(2)
    expect(activity.truncated).toBe(true)
  })

  it("pages the log and reports the total, so a page is not read as the whole log (TN-17)", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    for (const label of ["Argument", "Evidence", "Clarity", "Structure", "Style"]) {
      await recordAiSuggestion(suggestion(f.assessment.id, studentId, { criterionLabel: label }))
    }

    const first = await getRecentGradeActivityForTeacher(
      { id: f.teacher.id },
      { offeringId: f.offering.id, limit: 2 },
    )
    const second = await getRecentGradeActivityForTeacher(
      { id: f.teacher.id },
      { offeringId: f.offering.id, limit: 2, offset: 2 },
    )

    expect(first.items).toHaveLength(2)
    expect(first.truncated).toBe(true)
    expect(second.items).toHaveLength(2)

    // The total is the whole matching set, not the page size, and it is stable
    // across pages — that is what lets the header say "page 1 of N".
    expect(first.total).toBeGreaterThan(4)
    expect(second.total).toBe(first.total)

    // Pages do not overlap.
    const firstPageIds = new Set(first.items.map((item) => item.id))
    expect(second.items.every((item) => !firstPageIds.has(item.id))).toBe(true)
  })
})
