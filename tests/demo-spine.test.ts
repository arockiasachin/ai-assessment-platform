import { afterAll, beforeAll, describe, expect, it } from "vitest"

import {
  getAssessmentItemAnalysisForTeacher,
  getTeacherAnalyticsOverview,
} from "@/lib/analytics/service"
import { getTeacherRatingsReport } from "@/lib/course-ratings"
import { submitReviewDecision } from "@/lib/grading/review-service"
import { getStudentGradeExport, getTeacherGradeExport } from "@/lib/lms-export/service"
import { resolveGenerationStatus } from "@/lib/quiz-generation/metadata"
import { readRunEvidence } from "@/lib/code-eval/serialize"
import { listGeneratedQuestionsForTeacher } from "@/lib/quiz-generation/review-service"
import { startQuizAttempt, submitQuizAttempt } from "@/lib/quiz-attempts/service"
import { listReviewQueueForTeacher } from "@/lib/rubric-grading/review-queue"
import type { AuthUser } from "@/lib/session"

import { DEMO_ACCOUNTS, DEMO_IDS, seedDemo, type DemoSeedSummary } from "@/prisma/seed-demo"
import { disconnectTestDatabase, prisma as db, truncateAll } from "./helpers/db"

/**
 * Phase 4 spine proof.
 *
 * Runs against the demo-seeded database and walks the whole product path in one
 * file: generated-and-published quiz -> server-scored attempt -> AI suggestion
 * on an unpublished review -> human publish -> analytics + LMS export. It also
 * asserts the two product invariants that must be visible in the demo:
 *
 *   1. server-authoritative grading: the pre-submission payload has no key;
 *   2. no grade publishes without a human, and a published grade is immutable.
 */

const teacher: AuthUser = {
  id: DEMO_IDS.teacherUserId,
  email: DEMO_ACCOUNTS.teacher.email,
  role: "teacher",
}
const otherTeacher: AuthUser = {
  id: DEMO_IDS.teacher2UserId,
  email: DEMO_ACCOUNTS.teacher2.email,
  role: "teacher",
}
const studentOne: AuthUser = {
  id: DEMO_IDS.studentUserIds[0],
  email: DEMO_ACCOUNTS.students[0].email,
  role: "student",
}
// Student four has no seeded attempt, so this file can drive a fresh
// start -> submit -> review -> publish cycle without contending with seed state.
const studentFour: AuthUser = {
  id: DEMO_IDS.studentUserIds[3],
  email: DEMO_ACCOUNTS.students[3].email,
  role: "student",
}

const studentOneProfileId = DEMO_IDS.studentProfileIds[0]
const studentTwoProfileId = DEMO_IDS.studentProfileIds[1]
const studentThreeProfileId = DEMO_IDS.studentProfileIds[2]
const studentFourProfileId = DEMO_IDS.studentProfileIds[3]

let firstSummary: DemoSeedSummary
let inProgressAttemptId: string

function pairReviews(items: Awaited<ReturnType<typeof listReviewQueueForTeacher>>) {
  return items.map((item) => `${item.assessment.id}:${item.student.id}`)
}

describe("seeded demo course — end-to-end spine", () => {
  beforeAll(async () => {
    await truncateAll()
    firstSummary = await seedDemo()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("seeds every previously-uncovered model and is idempotent", async () => {
    // The seventeen models the shipped features depend on and the old seed
    // never created.
    expect(await db.material.count()).toBeGreaterThan(0)
    expect(await db.materialChunk.count()).toBeGreaterThan(0)
    expect(await db.rubric.count()).toBeGreaterThan(0)
    expect(await db.rubricCriterion.count()).toBeGreaterThan(0)
    expect(await db.aIGradeSuggestion.count()).toBeGreaterThan(0)
    expect(await db.gradeReview.count()).toBeGreaterThan(0)
    expect(await db.codeTask.count()).toBeGreaterThan(0)
    expect(await db.testCase.count()).toBeGreaterThan(0)

    /*
     * The seeded code run must be *legible*, not merely present.
     *
     * `count() > 0` passed for months while the run was unreadable: `resultsJson`
     * was written as `{ cases: [...] }` where `readRunEvidence` requires
     * `record.results`, and `finishedAt` was never set — so the page showed a
     * "Passed" row whose per-test evidence, recomputed points and diagnostics were
     * all empty, and whose statistics said "no finished run yet". Two reviewers
     * flagged it independently. These assertions are the guard.
     */
    const seededRun = await db.testRun.findFirstOrThrow({
      select: { finishedAt: true, resultsJson: true, passedCount: true },
    })
    expect(seededRun.finishedAt).not.toBeNull()
    const evidence = readRunEvidence(seededRun.resultsJson)
    expect(evidence.results).toHaveLength(seededRun.passedCount ?? 0)
    // Every result must carry the fields the UI renders; a partially-shaped row
    // would parse but render blanks.
    for (const result of evidence.results) {
      expect(result.testCaseId).toBeTruthy()
      expect(result.name).toBeTruthy()
      expect(typeof result.passed).toBe("boolean")
    }
    expect(await db.group.count()).toBeGreaterThan(0)
    expect(await db.groupMember.count()).toBeGreaterThan(0)
    expect(await db.peerEvaluation.count()).toBeGreaterThan(0)
    expect(await db.quizAttempt.count()).toBeGreaterThan(0)
    expect(await db.quizResponse.count()).toBeGreaterThan(0)
    expect(await db.ltiRegistration.count()).toBeGreaterThan(0)
    expect(await db.courseRating.count()).toBeGreaterThan(0)
    expect(await db.contributionEvent.count()).toBeGreaterThan(0)
    expect(await db.milestone.count()).toBeGreaterThan(0)

    // Embeddings are actually written through lib/vector, not just chunk rows.
    const embedded = await db.$queryRaw<{ count: number }[]>`
      SELECT COUNT(*)::int AS "count" FROM "MaterialChunk" WHERE "embedding" IS NOT NULL
    `
    expect(Number(embedded[0].count)).toBe(firstSummary.materialChunks)

    // Re-running must replace, not duplicate or crash.
    const secondSummary = await seedDemo()
    expect(secondSummary).toEqual(firstSummary)
  })

  it("publishes the generated quiz and never leaks the answer key to a student", async () => {
    const questions = await db.question.findMany({
      where: { assessmentId: DEMO_IDS.quizAssessmentId },
      include: { options: true },
      orderBy: { order: "asc" },
    })
    expect(questions.length).toBeGreaterThan(0)
    for (const question of questions) {
      expect(resolveGenerationStatus(question)).toBe("published")
      expect(question.publishedAt).not.toBeNull()
      expect(question.publishedById).toBe(DEMO_IDS.teacherStaffId)
      expect(question.options.filter((option) => option.isCorrect)).toHaveLength(1)
    }

    // The teacher-authoring payload does carry the key (ownership-scoped).
    const teacherQuestions = await listGeneratedQuestionsForTeacher(
      teacher,
      DEMO_IDS.quizAssessmentId,
    )
    expect(teacherQuestions.length).toBe(questions.length)
    expect(teacherQuestions.every((question) => question.correctOptionId)).toBe(true)

    // The student-facing payload does not, before or after submission.
    const view = await startQuizAttempt(studentFour, {
      assessmentId: DEMO_IDS.quizAssessmentId,
    })
    expect(view.results).toBeNull()
    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain('"isCorrect"')
    expect(serialized).not.toContain("correctOptionId")
    expect(serialized).not.toContain("correctIndex")
    expect(serialized).not.toContain('"rationale"')
    expect(serialized).not.toContain('"explanation"')
    inProgressAttemptId = view.id
  })

  it("scores a submitted attempt server-side and opens an unpublished review", async () => {
    const questions = await db.question.findMany({
      where: { assessmentId: DEMO_IDS.quizAssessmentId },
      include: { options: { orderBy: { order: "asc" } } },
      orderBy: { order: "asc" },
    })
    const answers = questions.map((question) => ({
      questionId: question.id,
      selectedIndex: question.options.findIndex((option) => option.isCorrect),
    }))

    const submitted = await submitQuizAttempt(studentFour, inProgressAttemptId, { answers })
    expect(submitted.status).toBe("SUBMITTED")
    expect(submitted.score).toBe(submitted.maxScore)

    const attempt = await db.quizAttempt.findUniqueOrThrow({
      where: { id: inProgressAttemptId },
    })
    expect(attempt.status).toBe("SUBMITTED")
    expect(Number(attempt.score)).toBe(Number(attempt.maxScore))

    const responses = await db.quizResponse.findMany({
      where: { attemptId: inProgressAttemptId },
      orderBy: { question: { order: "asc" } },
    })
    expect(responses).toHaveLength(questions.length)
    expect(responses.every((response) => response.isCorrect === true)).toBe(true)
    expect(responses.every((response) => response.pointsAwarded !== null)).toBe(true)

    const review = await db.gradeReview.findUniqueOrThrow({
      where: {
        assessmentId_studentId: {
          assessmentId: DEMO_IDS.quizAssessmentId,
          studentId: studentFourProfileId,
        },
      },
    })
    expect(["PENDING", "NEEDS_REVIEW"]).toContain(review.status)

    // The machine drafted a grade, but nothing is published.
    const grade = await db.grade.findUniqueOrThrow({
      where: {
        assessmentId_studentId: {
          assessmentId: DEMO_IDS.quizAssessmentId,
          studentId: studentFourProfileId,
        },
      },
    })
    expect(grade.publishedAt).toBeNull()
    expect(grade.source).toBe("AI_SUGGESTED")
    expect(Number(grade.points)).toBe(Number(grade.maxPoints))
  })

  it("publishes only on a human accept, and a later attempt cannot rewrite it", async () => {
    await submitReviewDecision({
      assessmentId: DEMO_IDS.quizAssessmentId,
      studentId: studentFourProfileId,
      reviewer: { id: teacher.id, role: "teacher" },
      decision: { action: "accept" },
    })

    const published = await db.grade.findUniqueOrThrow({
      where: {
        assessmentId_studentId: {
          assessmentId: DEMO_IDS.quizAssessmentId,
          studentId: studentFourProfileId,
        },
      },
    })
    expect(published.publishedAt).not.toBeNull()
    expect(published.approvedById).toBe(DEMO_IDS.teacherStaffId)
    const publishedAt = published.publishedAt
    const publishedPoints = Number(published.points)

    // A second, deliberately worse attempt supersedes the *suggestion* but must
    // never overwrite the grade a human already published.
    const questions = await db.question.findMany({
      where: { assessmentId: DEMO_IDS.quizAssessmentId },
      include: { options: { orderBy: { order: "asc" } } },
      orderBy: { order: "asc" },
    })
    const secondAttempt = await startQuizAttempt(studentFour, {
      assessmentId: DEMO_IDS.quizAssessmentId,
    })
    await submitQuizAttempt(studentFour, secondAttempt.id, {
      answers: questions.map((question) => ({
        questionId: question.id,
        selectedIndex: (question.options.findIndex((option) => option.isCorrect) + 1) % 4,
      })),
    })

    const afterSecondAttempt = await db.grade.findUniqueOrThrow({
      where: {
        assessmentId_studentId: {
          assessmentId: DEMO_IDS.quizAssessmentId,
          studentId: studentFourProfileId,
        },
      },
    })
    expect(Number(afterSecondAttempt.points)).toBe(publishedPoints)
    expect(afterSecondAttempt.publishedAt?.getTime()).toBe(publishedAt?.getTime())

    // Exactly one human publish action for this grade; no model call published.
    const publishAudits = await db.auditLog.count({
      where: { entityType: "Grade", action: "grade.published", entityId: published.id },
    })
    expect(publishAudits).toBe(1)
  })

  it("produces per-criterion rubric suggestions on a pending review", async () => {
    const criteria = await db.rubricCriterion.findMany({
      where: { rubric: { assessmentId: DEMO_IDS.essayAssessmentId } },
      orderBy: { order: "asc" },
    })
    expect(criteria).toHaveLength(3)

    const suggestions = await db.aIGradeSuggestion.findMany({
      where: {
        assessmentId: DEMO_IDS.essayAssessmentId,
        studentId: studentOneProfileId,
      },
      orderBy: { seq: "asc" },
    })
    expect(suggestions).toHaveLength(criteria.length)

    const criterionById = new Map(criteria.map((criterion) => [criterion.id, criterion]))
    for (const suggestion of suggestions) {
      expect(suggestion.rubricCriterionId).not.toBeNull()
      const criterion = criterionById.get(suggestion.rubricCriterionId ?? "")
      expect(criterion).toBeDefined()
      expect(suggestion.rationale.length).toBeGreaterThan(0)
      expect(suggestion.evidence).toBeTruthy()
      expect(suggestion.confidence).toBeGreaterThan(0)
      expect(suggestion.model).toMatch(/mock/)
      expect(Number(suggestion.maxPoints)).toBe(Number(criterion?.maxPoints))
      expect(Number(suggestion.suggestedPoints)).toBeLessThanOrEqual(
        Number(criterion?.maxPoints ?? 0),
      )
    }
    expect(new Set(suggestions.map((s) => s.rubricCriterionId)).size).toBe(criteria.length)

    const review = await db.gradeReview.findUniqueOrThrow({
      where: {
        assessmentId_studentId: {
          assessmentId: DEMO_IDS.essayAssessmentId,
          studentId: studentOneProfileId,
        },
      },
    })
    expect(["PENDING", "NEEDS_REVIEW"]).toContain(review.status)

    const grade = await db.grade.findUniqueOrThrow({
      where: {
        assessmentId_studentId: {
          assessmentId: DEMO_IDS.essayAssessmentId,
          studentId: studentOneProfileId,
        },
      },
    })
    expect(grade.publishedAt).toBeNull()
  })

  it("surfaces the pending queue to the owning teacher only", async () => {
    const queue = await listReviewQueueForTeacher(teacher)
    const keys = pairReviews(queue)

    expect(keys).toContain(`${DEMO_IDS.quizAssessmentId}:${studentTwoProfileId}`)
    expect(keys).toContain(`${DEMO_IDS.quizAssessmentId}:${studentThreeProfileId}`)
    expect(keys).toContain(`${DEMO_IDS.essayAssessmentId}:${studentOneProfileId}`)

    const essayItem = queue.find(
      (item) =>
        item.assessment.id === DEMO_IDS.essayAssessmentId &&
        item.student.id === studentOneProfileId,
    )
    expect(essayItem?.suggestions).toHaveLength(3)
    expect(essayItem?.grade?.isPublished).toBe(false)

    // A teacher who owns none of these assessments sees nothing.
    await expect(listReviewQueueForTeacher(otherTeacher)).resolves.toHaveLength(0)
  })

  it("reflects published grades in LMS export and excludes unpublished ones", async () => {
    const exportData = await getTeacherGradeExport(teacher, {
      offeringId: DEMO_IDS.activeOfferingId,
    })

    const studentOneGrade = exportData.students.find(
      (student) => student.studentId === studentOneProfileId,
    )
    expect(studentOneGrade).toBeDefined()

    // The accepted quiz grade is part of the weighted final grade...
    const quizMark = studentOneGrade?.marks.find(
      (mark) => mark.assessmentId === DEMO_IDS.quizAssessmentId,
    )
    expect(quizMark?.origin).toBe("modern-grade")
    expect(quizMark?.publishedAt).not.toBeNull()

    // ...the unpublished rubric draft is excluded, not zero-scored.
    expect(studentOneGrade?.excludedUnpublishedAssessmentIds).toContain(DEMO_IDS.essayAssessmentId)

    // A student whose quiz was never approved has it excluded too.
    const studentTwoGrade = exportData.students.find(
      (student) => student.studentId === studentTwoProfileId,
    )
    expect(studentTwoGrade?.excludedUnpublishedAssessmentIds).toContain(DEMO_IDS.quizAssessmentId)

    // No unpublished grade can ever appear as a mark for anyone.
    for (const student of exportData.students) {
      for (const mark of student.marks) {
        expect(mark.publishedAt).not.toBeNull()
      }
    }

    const studentExport = await getStudentGradeExport(studentOne, {
      offeringId: DEMO_IDS.activeOfferingId,
    })
    expect(studentExport.finalGrade.marks.every((mark) => mark.publishedAt !== null)).toBe(true)
    expect(studentExport.finalGrade.excludedUnpublishedAssessmentIds).toContain(
      DEMO_IDS.essayAssessmentId,
    )
  })

  it("runs item analysis over real attempts and reports insufficient data honestly", async () => {
    const overview = await getTeacherAnalyticsOverview(teacher, {
      offeringId: DEMO_IDS.activeOfferingId,
    })
    const quizSummary = overview.assessments.find(
      (assessment) => assessment.id === DEMO_IDS.quizAssessmentId,
    )
    expect(quizSummary?.attemptCount).toBeGreaterThan(0)

    const analysis = await getAssessmentItemAnalysisForTeacher(teacher, {
      assessmentId: DEMO_IDS.quizAssessmentId,
    })
    const questionCount = await db.question.count({
      where: { assessmentId: DEMO_IDS.quizAssessmentId },
    })
    expect(analysis.items).toHaveLength(questionCount)

    // The demo cohort is deliberately below the documented minimum, so the
    // indices must be withheld with an explanation rather than invented.
    for (const item of analysis.items) {
      expect(item.insufficientData).toBe(true)
      expect(item.difficultyIndex).toBeNull()
      expect(item.discriminationIndex).toBeNull()
      expect(item.notes.length).toBeGreaterThan(0)
    }
  })

  it("aggregates course ratings for the completed offering", async () => {
    const report = await getTeacherRatingsReport(teacher)
    expect(report).not.toBeNull()
    const past = report?.find((offering) => offering.offeringId === DEMO_IDS.pastOfferingId)
    expect(past?.ratingsCount).toBe(3)
    expect(past?.averageRating).toBeCloseTo((5 + 4 + 4) / 3, 6)
    expect(past?.ratings.every((rating) => rating.rating >= 1 && rating.rating <= 5)).toBe(true)
  })

  it("publishes no grade except through a recorded human action", async () => {
    const assessmentIds = [
      DEMO_IDS.quizAssessmentId,
      DEMO_IDS.essayAssessmentId,
      DEMO_IDS.codeAssessmentId,
      DEMO_IDS.groupAssessmentId,
    ]
    const published = await db.grade.findMany({
      where: { assessmentId: { in: assessmentIds }, publishedAt: { not: null } },
    })
    expect(published.length).toBeGreaterThan(0)
    for (const grade of published) {
      // Every published grade is attributed to a staff member.
      expect(grade.approvedById).not.toBeNull()
    }

    // And every published grade has exactly one matching human publish audit row
    // (`accept`/`override` writes `grade.published`; a manual mark writes
    // `grade.manual_mark_published`). Nothing else may create one.
    const publishAudits = await db.auditLog.count({
      where: {
        entityType: "Grade",
        action: { in: ["grade.published", "grade.manual_mark_published"] },
      },
    })
    expect(publishAudits).toBe(published.length)
  })
})
