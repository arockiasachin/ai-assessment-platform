import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { getTeacherAttempt, startQuizAttempt, submitQuizAttempt } from "@/lib/quiz-attempts"
import { scoreQuiz, normalizeQuestionPoints } from "@/lib/quiz-scoring"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Regression coverage for bug-fix run 3, S-3 (`Question.points` ignored).
 *
 * `Question.points` is editable and was serialized to students, but the scoring
 * kernel weighted every question equally (`correctCount / total × maxMarks`), so
 * the point values the client saw did not affect the score. Scoring now weights
 * by `points` and projects the ratio onto `maxScore`; absent/zero/non-finite
 * weights fall back to `1`, which makes the legacy equal-weight behaviour the
 * default special case.
 */

const DAY = 24 * 60 * 60 * 1000

const weightedQuestions = [
  { id: "q1", prompt: "Light", options: ["a", "b"], correctIndex: 0, points: 1 },
  { id: "q2", prompt: "Heavy", options: ["a", "b"], correctIndex: 0, points: 3 },
]

const equalQuestions = [
  { id: "q1", prompt: "Light", options: ["a", "b"], correctIndex: 0 },
  { id: "q2", prompt: "Heavy", options: ["a", "b"], correctIndex: 0 },
]

describe("scoreQuiz honours Question.points", () => {
  it("weights the score by the per-question points", () => {
    const both = scoreQuiz(
      weightedQuestions,
      [
        { questionId: "q1", selectedIndex: 0 },
        { questionId: "q2", selectedIndex: 0 },
      ],
      20,
    )
    expect(both.score).toBe(20)
    expect(both.results[0]).toMatchObject({ points: 1, maxPoints: 1 })
    expect(both.results[1]).toMatchObject({ points: 3, maxPoints: 3 })

    const lightOnly = scoreQuiz(weightedQuestions, [{ questionId: "q1", selectedIndex: 0 }], 20)
    expect(lightOnly.score).toBe(5)

    const heavyOnly = scoreQuiz(weightedQuestions, [{ questionId: "q2", selectedIndex: 0 }], 20)
    expect(heavyOnly.score).toBe(15)
  })

  it("matches the old equal-weight result when points are absent (legacy path)", () => {
    const scored = scoreQuiz(
      equalQuestions,
      [
        { questionId: "q1", selectedIndex: 0 },
        { questionId: "q2", selectedIndex: 1 },
      ],
      10,
    )
    expect(scored.score).toBe(5)
    expect(scored.results.map((result) => result.maxPoints)).toEqual([1, 1])
  })

  it("falls back to 1 for zero/negative/non-finite weights and never divides by zero", () => {
    expect(normalizeQuestionPoints(0)).toBe(1)
    expect(normalizeQuestionPoints(-2)).toBe(1)
    expect(normalizeQuestionPoints(Number.NaN)).toBe(1)
    expect(normalizeQuestionPoints(Number.POSITIVE_INFINITY)).toBe(1)
    expect(normalizeQuestionPoints(undefined)).toBe(1)
    expect(normalizeQuestionPoints(2.5)).toBe(2.5)

    const scored = scoreQuiz(
      [
        { ...weightedQuestions[0], points: 0 },
        { ...weightedQuestions[1], points: Number.NaN },
      ],
      [{ questionId: "q1", selectedIndex: 0 }],
      10,
    )
    expect(scored.score).toBe(5)
  })

  it("keeps every score inside [0, maxScore]", () => {
    const scored = scoreQuiz(
      weightedQuestions,
      [
        { questionId: "q1", selectedIndex: 0 },
        { questionId: "q2", selectedIndex: 1 },
      ],
      7,
    )
    expect(scored.score).toBeGreaterThanOrEqual(0)
    expect(scored.score).toBeLessThanOrEqual(7)
    expect(scoreQuiz([], [], 10).score).toBe(0)
  })
})

describe("quiz-attempt pipeline honours points end to end", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("shows, scores, stores, and reports the same per-question weights — and never publishes", async () => {
    const f = await createSpineFixture(prisma)
    const studentId = f.student.studentProfile!.id
    const studentUser: AuthUser = { id: f.student.id, email: f.student.email, role: "student" }
    const teacherUser: AuthUser = { id: f.teacher.id, email: f.teacher.email, role: "teacher" }

    await prisma.enrollment.create({
      data: { studentId, offeringId: f.offering.id, status: "active" },
    })
    await prisma.assessment.update({
      where: { id: f.assessment.id },
      data: { dueDate: new Date(Date.now() + 7 * DAY), maxMarks: 20 },
    })

    const weights = [1, 2, 7]
    const questions: Array<{ id: string }> = []
    for (let index = 0; index < weights.length; index += 1) {
      questions.push(
        await prisma.question.create({
          data: {
            assessmentId: f.assessment.id,
            order: index + 1,
            prompt: `Question ${index + 1}`,
            points: weights[index],
            options: {
              create: [
                { order: 0, text: "Option A", isCorrect: true },
                { order: 1, text: "Option B", isCorrect: false },
              ],
            },
          },
        }),
      )
    }

    const view = await startQuizAttempt(studentUser, { assessmentId: f.assessment.id })
    // What the student is told must be the weights the scorer uses.
    expect(view.questions.map((question) => question.points)).toEqual(weights)

    const submitted = await submitQuizAttempt(studentUser, view.id, {
      // Only the 7-weight question is answered correctly: 7 of 10 → 14 of 20.
      answers: [{ questionId: questions[2].id, selectedIndex: 0 }],
    })
    expect(submitted.score).toBe(14)
    expect(submitted.maxScore).toBe(20)
    const heavy = (submitted.results ?? []).find((result) => result.questionId === questions[2].id)
    expect(heavy).toMatchObject({ isCorrect: true, points: 7, maxPoints: 7 })

    const suggestion = await prisma.aIGradeSuggestion.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(suggestion.suggestedPoints)).toBe(14)
    expect(Number(suggestion.maxPoints)).toBe(20)

    const grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: f.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(14)
    expect(grade.publishedAt).toBeNull()
    expect(
      await prisma.auditLog.count({ where: { entityType: "Grade", action: "grade.published" } }),
    ).toBe(0)

    // The teacher view reports the same per-question ceiling.
    const detail = await getTeacherAttempt(teacherUser, view.id)
    const teacherHeavy = detail.responses.find(
      (response) => response.questionId === questions[2].id,
    )
    expect(teacherHeavy).toMatchObject({ isCorrect: true, pointsAwarded: 7, maxPoints: 7 })
  })
})
