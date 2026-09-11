import { afterAll, beforeEach, describe, expect, it } from "vitest"

import {
  getStudentAttempt,
  quizAttemptErrorResponse,
  startQuizAttempt,
  submitQuizAttempt,
} from "@/lib/quiz-attempts"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Adversarial coverage for the quiz-attempt persistence feature (bug-fix run 3).
 * The happy-path pipeline is covered in `quiz-attempts-pipeline.test.ts`; this
 * file attacks the vectors that report named: concurrent submits and starts,
 * answer/question IDOR within an attempt, malformed answer payloads, cap
 * accounting for started-but-unsubmitted attempts, and resuming past a deadline.
 */

const DAY = 24 * 60 * 60 * 1000

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

async function seedQuiz(options: { questionCount?: number; dueDate?: Date } = {}) {
  const fixture = await createSpineFixture(prisma)
  const studentId = fixture.student.studentProfile!.id
  await prisma.enrollment.create({
    data: { studentId, offeringId: fixture.offering.id, status: "active" },
  })
  await prisma.assessment.update({
    where: { id: fixture.assessment.id },
    data: { dueDate: options.dueDate ?? new Date(Date.now() + 7 * DAY) },
  })

  const questions = []
  for (let index = 0; index < (options.questionCount ?? 3); index += 1) {
    questions.push(
      await prisma.question.create({
        data: {
          assessmentId: fixture.assessment.id,
          order: index + 1,
          prompt: `Question ${index + 1}`,
          options: {
            create: [
              { order: 0, text: "Option A", isCorrect: true },
              { order: 1, text: "Option B", isCorrect: false },
            ],
          },
        },
        include: { options: true },
      }),
    )
  }

  return { fixture, questions, studentId, studentUser: studentSession(fixture.student) }
}

describe("quiz attempts — adversarial", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("serializes concurrent submissions: one set of responses, one suggestion", async () => {
    const { fixture, questions, studentUser } = await seedQuiz({ questionCount: 2 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })

    const body = {
      answers: [
        { questionId: questions[0].id, selectedIndex: 0 },
        { questionId: questions[1].id, selectedIndex: 0 },
      ],
    }

    const results = await Promise.allSettled([
      submitQuizAttempt(studentUser, view.id, body),
      submitQuizAttempt(studentUser, view.id, body),
    ])

    const fulfilled = results.filter((result) => result.status === "fulfilled")
    const rejected = results.filter((result) => result.status === "rejected")
    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)
    expect(rejected[0]).toMatchObject({ reason: { status: 409 } })

    const responses = await prisma.quizResponse.findMany({ where: { attemptId: view.id } })
    expect(responses).toHaveLength(2)

    const suggestions = await prisma.aIGradeSuggestion.findMany({
      where: { assessmentId: fixture.assessment.id, studentId: fixture.student.studentProfile!.id },
    })
    expect(suggestions).toHaveLength(1)

    const attempt = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: view.id } })
    expect(attempt.status).toBe("SUBMITTED")
  })

  it("rejects an answer that references another assessment's question", async () => {
    const { fixture, questions, studentId, studentUser } = await seedQuiz({ questionCount: 1 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })

    // A second assessment owned by the same teacher with its own question.
    const otherAssessment = await prisma.assessment.create({
      data: {
        offeringId: fixture.offering.id,
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        title: "Other Quiz",
        type: "QUIZ",
        dueDate: new Date(Date.now() + DAY),
        maxMarks: 10,
        createdById: fixture.teacher.staffProfile!.id,
      },
    })
    const foreignQuestion = await prisma.question.create({
      data: {
        assessmentId: otherAssessment.id,
        order: 1,
        prompt: "Foreign question",
        options: {
          create: [
            { order: 0, text: "A", isCorrect: true },
            { order: 1, text: "B", isCorrect: false },
          ],
        },
      },
    })

    await expect(
      submitQuizAttempt(studentUser, view.id, {
        answers: [
          { questionId: questions[0].id, selectedIndex: 0 },
          { questionId: foreignQuestion.id, selectedIndex: 0 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })

    expect(await prisma.quizResponse.count({ where: { attemptId: view.id } })).toBe(0)
    const attempt = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: view.id } })
    expect(attempt.status).toBe("IN_PROGRESS")
    expect(studentId).toBeTruthy()
  })

  it("rejects an empty answers array and a malformed answer payload", async () => {
    const { fixture, studentUser } = await seedQuiz({ questionCount: 1 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })

    await expect(submitQuizAttempt(studentUser, view.id, { answers: [] })).rejects.toBeTruthy()

    await expect(
      submitQuizAttempt(studentUser, view.id, {
        // selectedIndex must be an integer or null; a string is malformed.
        answers: [{ questionId: "whatever", selectedIndex: "zero" }],
      }),
    ).rejects.toBeTruthy()

    expect(await prisma.quizResponse.count({ where: { attemptId: view.id } })).toBe(0)
  })

  it("counts a started-but-unsubmitted attempt against the cap and does not create extras", async () => {
    const { fixture, studentUser } = await seedQuiz({ questionCount: 1 })

    const first = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    // A refresh resumes the same attempt; it must not create attempt #2.
    const resumed = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    expect(resumed.id).toBe(first.id)

    const attempts = await prisma.quizAttempt.findMany({
      where: { assessmentId: fixture.assessment.id },
    })
    expect(attempts).toHaveLength(1)
  })

  it("resumes an in-progress attempt after the deadline instead of blocking it", async () => {
    const { fixture, studentUser } = await seedQuiz({ questionCount: 1 })
    const first = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })

    await prisma.assessment.update({
      where: { id: fixture.assessment.id },
      data: { dueDate: new Date(Date.now() - DAY) },
    })

    const resumed = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    expect(resumed.id).toBe(first.id)
    expect(resumed.results).toBeNull()
  })

  it("never leaks the answer key from the in-progress read either", async () => {
    const { fixture, studentUser } = await seedQuiz({ questionCount: 2 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })

    const reread = await getStudentAttempt(studentUser, view.id)
    const serialized = JSON.stringify(reread)
    expect(serialized).not.toContain("isCorrect")
    expect(serialized).not.toContain("correctIndex")
    expect(serialized).not.toContain("correctOptionId")
    expect(reread.results).toBeNull()
  })

  it("maps a concurrent start race to a domain error, never a raw database 500", async () => {
    const { fixture, studentUser } = await seedQuiz({ questionCount: 1 })

    const results = await Promise.allSettled([
      startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id }),
      startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id }),
    ])

    const rejected = results.filter((result) => result.status === "rejected")
    for (const result of rejected) {
      // A rejected start must be a `QuizAttemptError` (mapped to 409/429 by the
      // route). A raw Prisma P2002 would surface as a generic 500 to a student
      // who simply double-tapped "Start".
      const response = quizAttemptErrorResponse((result as PromiseRejectedResult).reason)
      expect([409, 429]).toContain(response.status)
    }
  })
})
