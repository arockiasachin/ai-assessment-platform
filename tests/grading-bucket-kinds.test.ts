import { afterAll, beforeEach, describe, expect, it } from "vitest"

import type { AiGradeSuggestionInput } from "@/lib/contracts"
import { QUIZ_ATTEMPT_CRITERION_LABEL } from "@/lib/contracts/quiz-attempts"
import {
  activeSuggestionKind,
  recordAiSuggestion,
  submitReviewDecision,
  suggestionBucketKind,
  suggestionGroupKey,
} from "@/lib/grading"
import { upsertRubricForTeacher } from "@/lib/rubric-grading"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Regression coverage for bug-fix run 3, S-2 (bucket-kind summation).
 *
 * `latestSuggestionTotals` deduped per bucket but summed buckets of different
 * *kinds*. A rubric criterion (`rubricCriterionId`) and the deterministic quiz
 * auto-score (`criterionLabel: "Quiz score"`) were two buckets, so an assessment
 * holding both would add them: a 10-point criterion plus a 20/20 quiz attempt
 * clamped to the rubric ceiling of 20 instead of choosing one score. The kinds
 * are now mutually exclusive by explicit precedence, and a rubric can no longer
 * be attached to an auto-scored quiz in the first place.
 */

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

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
    latencyMs: 1,
    ...overrides,
  }
}

const bucketShape = (overrides: Partial<Parameters<typeof suggestionBucketKind>[0]>) => ({
  rubricCriterionId: null,
  quizResponseId: null,
  submissionId: null,
  criterionLabel: null,
  ...overrides,
})

describe("suggestion bucket kinds (pure)", () => {
  it("classifies a suggestion by its most specific identifier", () => {
    expect(
      suggestionBucketKind(
        bucketShape({ rubricCriterionId: "c1", quizResponseId: "r1", criterionLabel: "Argument" }),
      ),
    ).toBe("rubric")
    expect(
      suggestionBucketKind(
        bucketShape({ quizResponseId: "r1", submissionId: "s1", criterionLabel: "Argument" }),
      ),
    ).toBe("quizResponse")
    expect(
      suggestionBucketKind(
        bucketShape({ submissionId: "s1", criterionLabel: QUIZ_ATTEMPT_CRITERION_LABEL }),
      ),
    ).toBe("quizOverall")
    expect(
      suggestionBucketKind(bucketShape({ submissionId: "s1", criterionLabel: "Argument" })),
    ).toBe("legacy")
  })

  it("selects exactly one kind, most specific first", () => {
    expect(activeSuggestionKind(["legacy", "quizOverall"] as const)).toBe("quizOverall")
    expect(activeSuggestionKind(["quizOverall", "quizResponse"] as const)).toBe("quizResponse")
    expect(activeSuggestionKind(["quizOverall", "rubric"] as const)).toBe("rubric")
    expect(activeSuggestionKind(["legacy"] as const)).toBe("legacy")
    expect(activeSuggestionKind([])).toBeNull()
  })

  it("keeps the existing per-bucket key so dedupe is unchanged", () => {
    expect(suggestionGroupKey(bucketShape({ rubricCriterionId: "c1" }))).toBe("criterion:c1")
    expect(suggestionGroupKey(bucketShape({ quizResponseId: "r1" }))).toBe("quizResponse:r1")
    expect(suggestionGroupKey(bucketShape({ submissionId: "s1" }))).toBe("submission:s1")
    expect(suggestionGroupKey(bucketShape({ criterionLabel: "Argument" }))).toBe("label:Argument")
    expect(suggestionGroupKey(bucketShape({}))).toBe("overall")
  })
})

describe("rubric and quiz buckets are mutually exclusive", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  async function seedRubricAssessment() {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    const assessment = await prisma.assessment.create({
      data: {
        offeringId: f.offering.id,
        courseId: f.course.id,
        classId: f.classroom.id,
        title: "Descriptive assignment",
        type: "DESCRIPTIVE",
        dueDate: new Date("2027-01-01T08:00:00.000Z"),
        maxMarks: 20,
        createdById: f.teacher.staffProfile!.id,
      },
    })
    const teacherUser = teacherSession(f.teacher)
    const { rubric } = await upsertRubricForTeacher(teacherUser, {
      assessmentId: assessment.id,
      title: "Essay rubric",
      criteria: [
        { label: "Argument", weight: 1, maxPoints: 10 },
        { label: "Evidence", weight: 1, maxPoints: 10 },
      ],
    })
    const criteria = await prisma.rubricCriterion.findMany({
      where: { rubricId: rubric.id },
      orderBy: { order: "asc" },
    })
    return { f, assessment, criteria, teacherUser, studentId }
  }

  it("sums rubric criteria but never adds the whole-quiz bucket", async () => {
    const { assessment, criteria, studentId } = await seedRubricAssessment()

    await recordAiSuggestion(
      suggestion(assessment.id, studentId, {
        rubricCriterionId: criteria[0].id,
        criterionLabel: "Argument",
        suggestedPoints: 10,
      }),
    )
    await recordAiSuggestion(
      suggestion(assessment.id, studentId, {
        rubricCriterionId: criteria[1].id,
        criterionLabel: "Evidence",
        suggestedPoints: 8,
      }),
    )
    // The illicit whole-quiz bucket. Pre-fix this summed to min(10+8+20, 20)=20.
    await recordAiSuggestion(
      suggestion(assessment.id, studentId, {
        criterionLabel: QUIZ_ATTEMPT_CRITERION_LABEL,
        suggestedPoints: 20,
        maxPoints: 20,
      }),
    )

    const draft = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(Number(draft.points)).toBe(18)
    expect(Number(draft.maxPoints)).toBe(20)
    expect(draft.publishedAt).toBeNull()
  })

  it("publishes only the rubric total and never lets a quiz bucket rewrite it", async () => {
    const { f, assessment, criteria, studentId } = await seedRubricAssessment()

    await recordAiSuggestion(
      suggestion(assessment.id, studentId, {
        rubricCriterionId: criteria[0].id,
        criterionLabel: "Argument",
        suggestedPoints: 10,
      }),
    )
    await recordAiSuggestion(
      suggestion(assessment.id, studentId, {
        criterionLabel: QUIZ_ATTEMPT_CRITERION_LABEL,
        suggestedPoints: 20,
        maxPoints: 20,
      }),
    )

    await submitReviewDecision({
      assessmentId: assessment.id,
      studentId,
      reviewer: { id: f.teacher.id, role: "teacher" },
      decision: { action: "accept" },
    })
    const published = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(Number(published.points)).toBe(10)
    expect(published.publishedAt).not.toBeNull()

    // A later quiz auto-score must not move a human-published grade.
    await recordAiSuggestion(
      suggestion(assessment.id, studentId, {
        criterionLabel: QUIZ_ATTEMPT_CRITERION_LABEL,
        suggestedPoints: 20,
        maxPoints: 20,
      }),
    )
    const after = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: assessment.id, studentId },
    })
    expect(Number(after.points)).toBe(10)
    expect(after.publishedAt?.getTime()).toBe(published.publishedAt?.getTime())
    expect(
      await prisma.auditLog.count({ where: { entityType: "Grade", action: "grade.published" } }),
    ).toBe(1)
  })

  it("refuses to attach a rubric to an auto-scored quiz", async () => {
    const f = await createSpineFixture(prisma)
    const teacherUser = teacherSession(f.teacher)

    await expect(
      upsertRubricForTeacher(teacherUser, {
        assessmentId: f.assessment.id,
        title: "Not allowed",
        criteria: [{ label: "Argument", weight: 1, maxPoints: 20 }],
      }),
    ).rejects.toMatchObject({ status: 409 })

    expect(await prisma.rubric.count({ where: { assessmentId: f.assessment.id } })).toBe(0)
  })
})
