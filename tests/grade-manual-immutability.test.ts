import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { upsertAssessmentGrade } from "@/lib/gradebook-db"
import { recordAiSuggestion, submitReviewDecision } from "@/lib/grading"
import type { AuthUser } from "@/lib/session"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * A teacher's manual mark is itself a human approval, so it must be immutable
 * against every *AI-driven* path: a re-run of grading, and the review-decision
 * endpoint whose `accept`/`flag`/`reject` actions act on the model's suggestion,
 * not on the teacher's own mark. Only an explicit human `override` may replace
 * it.
 */
describe("manual mark immutability against the review path", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function setup() {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })
    const teacher: AuthUser = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }
    return { f, studentId, teacher }
  }

  async function publishManualMarkThenSuggest(score: number, suggested: number) {
    const ctx = await setup()
    await upsertAssessmentGrade(
      { studentId: ctx.studentId, assessmentId: ctx.f.assessment.id, score },
      ctx.teacher,
    )
    await recordAiSuggestion(
      {
        assessmentId: ctx.f.assessment.id,
        studentId: ctx.studentId,
        suggestedPoints: suggested,
        rationale: "Stale model run.",
        confidence: 0.9,
        model: "mock",
        promptVersion: "v1",
        latencyMs: 5,
      },
      { id: "ai", role: "system" },
    )
    return ctx
  }

  async function readGrade(assessmentId: string, studentId: string) {
    return prisma.grade.findUniqueOrThrow({
      where: { assessmentId_studentId: { assessmentId, studentId } },
    })
  }

  it("`accept` cannot overwrite a teacher-published manual mark", async () => {
    const { f, studentId, teacher } = await publishManualMarkThenSuggest(12, 20)

    await expect(
      submitReviewDecision({
        assessmentId: f.assessment.id,
        studentId,
        reviewer: { id: teacher.id, role: "teacher" },
        decision: { action: "accept" },
      }),
    ).rejects.toMatchObject({ status: 409 })

    const grade = await readGrade(f.assessment.id, studentId)
    expect(Number(grade.points)).toBe(12)
    expect(grade.source).toBe("TEACHER_OVERRIDE")
    expect(grade.publishedAt).not.toBeNull()
  })

  it("`reject` closes the review without unpublishing the manual mark", async () => {
    const { f, studentId, teacher } = await publishManualMarkThenSuggest(12, 20)

    await submitReviewDecision({
      assessmentId: f.assessment.id,
      studentId,
      reviewer: { id: teacher.id, role: "teacher" },
      decision: { action: "reject", reason: "I set this mark myself." },
    })

    const grade = await readGrade(f.assessment.id, studentId)
    expect(Number(grade.points)).toBe(12)
    expect(grade.source).toBe("TEACHER_OVERRIDE")
    expect(grade.publishedAt).not.toBeNull()

    const review = await prisma.gradeReview.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(review.status).toBe("REJECTED")
  })

  it("`flag` cannot unpublish the manual mark", async () => {
    const { f, studentId, teacher } = await publishManualMarkThenSuggest(12, 20)

    await submitReviewDecision({
      assessmentId: f.assessment.id,
      studentId,
      reviewer: { id: teacher.id, role: "teacher" },
      decision: { action: "flag", notes: "Looks odd." },
    })

    const grade = await readGrade(f.assessment.id, studentId)
    expect(Number(grade.points)).toBe(12)
    expect(grade.source).toBe("TEACHER_OVERRIDE")
    expect(grade.publishedAt).not.toBeNull()
  })

  it("an explicit human `override` may still replace the manual mark", async () => {
    const { f, studentId, teacher } = await publishManualMarkThenSuggest(12, 20)

    await submitReviewDecision({
      assessmentId: f.assessment.id,
      studentId,
      reviewer: { id: teacher.id, role: "teacher" },
      decision: { action: "override", points: 15, reason: "Re-marked after appeal." },
    })

    const grade = await readGrade(f.assessment.id, studentId)
    expect(Number(grade.points)).toBe(15)
    expect(grade.source).toBe("TEACHER_OVERRIDE")
    expect(grade.publishedAt).not.toBeNull()
  })

  it("a cleared manual mark is not silently resurrected by a later grading run", async () => {
    const { f, studentId, teacher } = await setup()
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: 12 }, teacher)
    await upsertAssessmentGrade({ studentId, assessmentId: f.assessment.id, score: null }, teacher)
    await expect(
      prisma.grade.count({ where: { assessmentId: f.assessment.id, studentId } }),
    ).resolves.toBe(0)

    // A later model run re-derives a suggestion and its *unpublished* draft.
    await recordAiSuggestion(
      {
        assessmentId: f.assessment.id,
        studentId,
        suggestedPoints: 20,
        rationale: "Re-graded after a clear.",
        confidence: 0.9,
        model: "mock",
        promptVersion: "v1",
        latencyMs: 5,
      },
      { id: "ai", role: "system" },
    )

    const drafts = await prisma.grade.findMany({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(drafts).toHaveLength(1)
    expect(drafts[0].publishedAt).toBeNull()
    await expect(
      prisma.grade.count({
        where: { assessmentId: f.assessment.id, studentId, publishedAt: { not: null } },
      }),
    ).resolves.toBe(0)
  })
})
