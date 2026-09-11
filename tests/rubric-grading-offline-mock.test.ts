import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { AuthUser } from "@/lib/session"
import { evaluateSubmissionForTeacher, upsertRubricForTeacher } from "@/lib/rubric-grading"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Regression coverage for bug-fix run 2: with `LLM_PROVIDER=mock` (the only
 * offline provider, and the default in CI/dev) the evaluation loop received the
 * mock's generic JSON, which has no `score`/`rationale`/`evidence`/`confidence`,
 * so `parseCriterionEvaluation` rejected it and every evaluate call answered
 * 502. The mock provider now synthesizes the `rubric-grading` task, so the whole
 * pipeline runs offline.
 */

const SUBMISSION_TEXT =
  "The author argues that remote work raises productivity because it removes commutes. " +
  "Studies show a 13% gain, though the evidence is correlational."

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

describe("rubric grading with the offline mock provider", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("evaluates every criterion without a custom provider and never publishes", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    const assessment = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Offline rubric assignment",
        type: "DESCRIPTIVE",
        dueDate: new Date("2027-01-01T08:00:00.000Z"),
        maxMarks: 20,
        createdById: f.teacher.staffProfile!.id,
      },
    })
    const teacherUser = teacherSession(f.teacher)
    await upsertRubricForTeacher(teacherUser, {
      assessmentId: assessment.id,
      title: "Two-criterion rubric",
      criteria: [
        { label: "Argument", weight: 1, maxPoints: 10 },
        { label: "Evidence", weight: 1, maxPoints: 10 },
      ],
    })
    const submission = await prisma.submission.create({
      data: {
        assessmentId: assessment.id,
        studentId,
        status: "SUBMITTED",
        submittedAt: new Date(),
        contentText: SUBMISSION_TEXT,
      },
    })

    const outcome = await evaluateSubmissionForTeacher(teacherUser, submission.id)

    expect(outcome.suggestions).toHaveLength(2)
    expect(outcome.grade.publishedAt).toBeNull()
    expect(outcome.grade.source).toBe("AI_SUGGESTED")
    for (const suggestion of outcome.suggestions) {
      expect(suggestion.suggestedPoints).toBeGreaterThanOrEqual(0)
      expect(suggestion.suggestedPoints).toBeLessThanOrEqual(suggestion.maxPoints ?? 10)
      expect(suggestion.rationale.length).toBeGreaterThan(0)
      expect(suggestion.model).toBe("mock-llm")
      expect(suggestion.promptVersion).toBe("rubric-grading-v1")
    }

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(grade.publishedAt).toBeNull()
  })
})
