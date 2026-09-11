import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { recordAiSuggestion, submitReviewDecision } from "@/lib/grading"

import type { AiGradeSuggestionInput } from "@/lib/contracts"
import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Regression coverage for the "model re-run inflates the grade" defect.
 *
 * Before the fix, `recordAiSuggestion` and `submitReviewDecision` summed *every*
 * `AIGradeSuggestion` row for the assessment/student, so re-running the model
 * for a criterion that had already been scored added the new score on top of
 * the old one. The draft (and then the published) grade grew with each re-run.
 *
 * `createdAt` is the only ordering column, so the helper below spaces writes to
 * keep "latest suggestion wins" deterministic instead of depending on
 * millisecond tie-breaks.
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function suggestion(
  assessmentId: string,
  studentId: string,
  overrides: Partial<AiGradeSuggestionInput>,
): AiGradeSuggestionInput {
  return {
    assessmentId,
    studentId,
    suggestedPoints: 5,
    rationale: "Quotes the student's text that supports the score.",
    confidence: 0.8,
    model: "mock-llm",
    promptVersion: "v1",
    latencyMs: 12,
    ...overrides,
  }
}

async function draftPoints(assessmentId: string, studentId: string) {
  const grade = await prisma.grade.findFirstOrThrow({ where: { assessmentId, studentId } })
  return Number(grade.points)
}

describe("AI suggestion aggregation", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("sums the latest suggestion per criterion instead of every historical row", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id

    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { criterionLabel: "Argument", suggestedPoints: 5 }),
    )
    await sleep(5)
    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { criterionLabel: "Evidence", suggestedPoints: 5 }),
    )

    expect(await draftPoints(f.assessment.id, studentId)).toBe(10)

    // A re-run for "Argument" must supersede, not add.
    await sleep(5)
    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { criterionLabel: "Argument", suggestedPoints: 5 }),
    )
    expect(await draftPoints(f.assessment.id, studentId)).toBe(10)

    // A corrected re-run still supersedes.
    await sleep(5)
    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { criterionLabel: "Argument", suggestedPoints: 8 }),
    )
    expect(await draftPoints(f.assessment.id, studentId)).toBe(13)

    // History is preserved (3 Argument/Evidence rows) even though only the
    // latest per criterion counts.
    await expect(
      prisma.aIGradeSuggestion.count({ where: { assessmentId: f.assessment.id, studentId } }),
    ).resolves.toBe(4)

    // The published grade uses the same deduped total.
    await submitReviewDecision({
      assessmentId: f.assessment.id,
      studentId,
      reviewer: { id: f.teacher.id, role: "teacher" },
      decision: { action: "accept" },
    })
    const published = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(published.points)).toBe(13)
    expect(published.publishedAt).not.toBeNull()
  })

  it("dedupes per quiz response so distinct responses still combine", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id

    const q1 = await prisma.question.create({
      data: { assessmentId: f.assessment.id, order: 1, prompt: "Q1" },
    })
    const q2 = await prisma.question.create({
      data: { assessmentId: f.assessment.id, order: 2, prompt: "Q2" },
    })
    const attempt = await prisma.quizAttempt.create({
      data: { assessmentId: f.assessment.id, studentId },
    })
    const r1 = await prisma.quizResponse.create({
      data: { attemptId: attempt.id, questionId: q1.id, answerText: "a" },
    })
    const r2 = await prisma.quizResponse.create({
      data: { attemptId: attempt.id, questionId: q2.id, answerText: "b" },
    })

    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { quizResponseId: r1.id, suggestedPoints: 4 }),
    )
    await sleep(5)
    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { quizResponseId: r2.id, suggestedPoints: 4 }),
    )
    await sleep(5)
    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { quizResponseId: r1.id, suggestedPoints: 2 }),
    )

    expect(await draftPoints(f.assessment.id, studentId)).toBe(6)
  })

  it("audits the AI draft grade and never rewrites a published grade without a human action", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    const reviewer = { id: f.teacher.id, role: "teacher" as const }

    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { suggestedPoints: 7, maxPoints: 20 }),
    )

    const draftActions = await prisma.auditLog.findMany({
      where: { entityType: "Grade" },
      select: { action: true },
    })
    expect(draftActions.map((row) => row.action)).toContain("grade.ai_draft_created")

    await submitReviewDecision({
      assessmentId: f.assessment.id,
      studentId,
      reviewer,
      decision: { action: "accept" },
    })

    // A later model output must leave the published grade byte-for-byte intact.
    await sleep(5)
    await recordAiSuggestion(
      suggestion(f.assessment.id, studentId, { suggestedPoints: 19, maxPoints: 20 }),
    )
    const published = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(published.points)).toBe(7)
    expect(published.publishedAt).not.toBeNull()

    const rePublishAudits = await prisma.auditLog.count({
      where: { entityType: "Grade", action: "grade.published" },
    })
    expect(rePublishAudits).toBe(1)
  })
})
