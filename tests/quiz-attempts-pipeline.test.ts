import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { listStudentRetakableAssessmentsForStudent } from "@/lib/analytics/service"
import {
  QUIZ_ATTEMPT_CRITERION_LABEL,
  QUIZ_AUTO_SCORER_MODEL,
  QUIZ_SCORING_PROMPT_VERSION,
} from "@/lib/contracts/quiz-attempts"
import { submitReviewDecision } from "@/lib/grading"
import {
  getStudentAttempt,
  getTeacherAttempt,
  latestFailedQuestionIds,
  listTeacherAttempts,
  saveQuizAttemptDraft,
  startQuizAttempt,
  submitQuizAttempt,
} from "@/lib/quiz-attempts"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * End-to-end coverage for quiz-attempt persistence and the grade pipeline.
 *
 * The invariants under test:
 *  1. Scoring is server-authoritative; the answer key never appears in the
 *     pre-submission payload.
 *  2. The score is persisted as a deterministic `AIGradeSuggestion` on a
 *     `GradeReview`; nothing publishes a `Grade` automatically.
 *  3. A later attempt supersedes (never double-counts, never rewrites a
 *     published grade).
 *  4. The attempt cap and the deadline are enforced server-side, and a late
 *     submission is flagged.
 *  5. A submitted attempt cannot be edited.
 *  6. Cross-student and cross-teacher reads are denied.
 *  7. Persisted responses feed the existing adaptive-retake selector.
 */

const DAY = 24 * 60 * 60 * 1000

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

async function seedQuiz(options: { questionCount?: number; dueDate?: Date; draft?: boolean } = {}) {
  const fixture = await createSpineFixture(prisma)
  const studentId = fixture.student.studentProfile!.id

  await prisma.enrollment.create({
    data: { studentId, offeringId: fixture.offering.id, status: "active" },
  })
  await prisma.assessment.update({
    where: { id: fixture.assessment.id },
    data: { dueDate: options.dueDate ?? new Date(Date.now() + 7 * DAY) },
  })

  const questionCount = options.questionCount ?? 3
  const questions = []
  for (let index = 0; index < questionCount; index += 1) {
    const question = await prisma.question.create({
      data: {
        assessmentId: fixture.assessment.id,
        order: index + 1,
        prompt: `Question ${index + 1}`,
        explanation: `Explanation ${index + 1}`,
        metadata: options.draft
          ? {
              generator: "quiz-generation",
              generationStatus: "draft",
              promptVersion: "quiz-generation-v1",
              model: "mock",
              provider: "mock",
              generationId: "gen-1",
              topic: "topic",
              sourceChunkIds: [],
              createdByStaffId: fixture.teacher.staffProfile!.id,
            }
          : undefined,
        options: {
          create: [
            { order: 0, text: "Option A", isCorrect: true },
            { order: 1, text: "Option B", isCorrect: false },
            { order: 2, text: "Option C", isCorrect: false },
          ],
        },
      },
      include: { options: true },
    })
    questions.push(question)
  }

  return {
    fixture,
    questions,
    studentId,
    studentUser: studentSession(fixture.student),
    teacherUser: teacherSession(fixture.teacher),
  }
}

async function createOtherStudent() {
  const user = await prisma.user.create({
    data: {
      email: "other-quiz-student@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "STUDENT",
      studentProfile: { create: { fullName: "Olive Student", registerNumber: "REG-OTHER" } },
    },
    include: { studentProfile: true },
  })
  return { user: studentSession(user), profileId: user.studentProfile!.id }
}

async function createOtherTeacher() {
  const user = await prisma.user.create({
    data: {
      email: "other-quiz-teacher@test.local",
      passwordHash: "test-only-not-a-real-hash",
      role: "TEACHER",
      staffProfile: { create: { fullName: "Olive Teacher", empId: "EMP-OTHER" } },
    },
  })
  return teacherSession(user)
}

describe("quiz attempts", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("scores server-side and never leaks the answer key before submission", async () => {
    const { fixture, questions, studentUser } = await seedQuiz({ questionCount: 3 })

    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    expect(view.status).toBe("IN_PROGRESS")
    expect(view.results).toBeNull()
    expect(view.questions).toHaveLength(3)

    const serialized = JSON.stringify(view)
    expect(serialized).not.toContain("correctIndex")
    expect(serialized).not.toContain("correctOptionId")
    expect(serialized).not.toContain("isCorrect")
    expect(serialized).not.toContain("selectedIndex")
    expect(serialized).not.toContain("Explanation 1")

    const submitted = await submitQuizAttempt(studentUser, view.id, {
      answers: [
        { questionId: questions[0].id, selectedIndex: 0 },
        { questionId: questions[1].id, selectedIndex: 1 },
        { questionId: questions[2].id, selectedIndex: null },
      ],
    })

    expect(submitted.status).toBe("SUBMITTED")
    expect(submitted.results).not.toBeNull()
    const results = submitted.results ?? []
    expect(results[0]).toMatchObject({
      isCorrect: true,
      selectedIndex: 0,
      correctIndex: 0,
      correctText: "Option A",
      explanation: "Explanation 1",
    })
    expect(results[1]).toMatchObject({ isCorrect: false, selectedIndex: 1, correctIndex: 0 })
    expect(results[2]).toMatchObject({ isCorrect: false, selectedIndex: null })
    expect(submitted.score).toBe(Math.round((1 / 3) * fixture.assessment.maxMarks))
    expect(submitted.maxScore).toBe(fixture.assessment.maxMarks)

    const correctOptionId = questions[0].options.find((option) => option.isCorrect)!.id
    const responses = await prisma.quizResponse.findMany({
      where: { attemptId: view.id },
      orderBy: { question: { order: "asc" } },
    })
    expect(responses).toHaveLength(3)
    expect(responses[0].isCorrect).toBe(true)
    expect(responses[0].selectedOptionIds).toEqual([correctOptionId])
    expect(responses[1].isCorrect).toBe(false)
    expect(responses[2].isCorrect).toBeNull()
    expect(responses[2].selectedOptionIds).toEqual([])
  })

  it("persists a deterministic suggestion, never publishes, and supersedes later attempts", async () => {
    const { fixture, questions, studentId, studentUser, teacherUser } = await seedQuiz({
      questionCount: 4,
    })

    const first = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    await submitQuizAttempt(studentUser, first.id, {
      answers: [
        { questionId: questions[0].id, selectedIndex: 0 },
        { questionId: questions[1].id, selectedIndex: 1 },
        { questionId: questions[2].id, selectedIndex: null },
        { questionId: questions[3].id, selectedIndex: 1 },
      ],
    })

    let grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: fixture.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(5)
    expect(grade.publishedAt).toBeNull()
    expect(grade.source).toBe("AI_SUGGESTED")

    const review = await prisma.gradeReview.findFirstOrThrow({
      where: { assessmentId: fixture.assessment.id, studentId },
    })
    expect(review.status).toBe("PENDING")

    const suggestions = await prisma.aIGradeSuggestion.findMany({
      where: { assessmentId: fixture.assessment.id, studentId },
    })
    expect(suggestions).toHaveLength(1)
    expect(suggestions[0].model).toBe(QUIZ_AUTO_SCORER_MODEL)
    expect(suggestions[0].promptVersion).toBe(QUIZ_SCORING_PROMPT_VERSION)
    expect(suggestions[0].criterionLabel).toBe(QUIZ_ATTEMPT_CRITERION_LABEL)
    expect(suggestions[0].confidence).toBe(1)
    expect(Number(suggestions[0].suggestedPoints)).toBe(5)
    expect(Number(suggestions[0].maxPoints)).toBe(fixture.assessment.maxMarks)

    // No grade is published by the auto-scorer.
    expect(
      await prisma.auditLog.count({ where: { entityType: "Grade", action: "grade.published" } }),
    ).toBe(0)

    // A better second attempt supersedes the draft; it must not sum to 20.
    const second = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    await submitQuizAttempt(studentUser, second.id, {
      answers: [
        { questionId: questions[0].id, selectedIndex: 0 },
        { questionId: questions[1].id, selectedIndex: 0 },
        { questionId: questions[2].id, selectedIndex: 0 },
        { questionId: questions[3].id, selectedIndex: 1 },
      ],
    })
    grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: fixture.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(15)
    expect(grade.publishedAt).toBeNull()
    expect(
      await prisma.aIGradeSuggestion.count({
        where: { assessmentId: fixture.assessment.id, studentId },
      }),
    ).toBe(2)

    // A human publishes. Nothing the machine did published.
    await submitReviewDecision({
      assessmentId: fixture.assessment.id,
      studentId,
      reviewer: { id: fixture.teacher.id, role: "teacher" },
      decision: { action: "accept" },
    })
    grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: fixture.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(15)
    const publishedAt = grade.publishedAt
    expect(publishedAt).not.toBeNull()

    // A third, worse attempt must not rewrite the published grade.
    const third = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    await submitQuizAttempt(studentUser, third.id, {
      answers: [
        { questionId: questions[0].id, selectedIndex: 1 },
        { questionId: questions[1].id, selectedIndex: 1 },
        { questionId: questions[2].id, selectedIndex: 1 },
        { questionId: questions[3].id, selectedIndex: 1 },
      ],
    })
    grade = await prisma.grade.findFirstOrThrow({
      where: { assessmentId: fixture.assessment.id, studentId },
    })
    expect(Number(grade.points)).toBe(15)
    expect(grade.publishedAt?.getTime()).toBe(publishedAt?.getTime())
    expect(
      await prisma.auditLog.count({ where: { entityType: "Grade", action: "grade.published" } }),
    ).toBe(1)

    // The cap (default 3) is enforced on the next start.
    await expect(
      startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id }),
    ).rejects.toMatchObject({ status: 429 })

    // The owner teacher can read the cohort and the answer key for grading.
    const attempts = await listTeacherAttempts(teacherUser, fixture.assessment.id)
    expect(attempts).toHaveLength(3)
    expect(attempts[0].studentId).toBe(studentId)
    expect(attempts[0].reviewStatus).toBe("AUTO_ACCEPTED")
    expect(attempts[0].gradePublishedAt).not.toBeNull()
  })

  it("does not let a practice sitting consume a graded attempt", async () => {
    // The invariant the `kind` column exists for, and precisely the one the old shape could not
    // express. Before it, exercising the retake surface silently burned one of a student's
    // graded attempts — a bug with no error and no visible trace.
    //
    // The existing cap test still passes with `@default(GRADED)`, which is exactly why this
    // sibling is needed: without it, a regression that counted practice rows would be invisible.
    const { fixture, questions, studentId, studentUser } = await seedQuiz()
    await prisma.assessment.update({
      where: { id: fixture.assessment.id },
      data: { maxAttempts: 2 },
    })

    // Three practice sittings, persisted directly — nothing in the product creates them yet, so
    // this stands in for the retake surface that will.
    for (let index = 0; index < 3; index += 1) {
      await prisma.quizAttempt.create({
        data: {
          assessmentId: fixture.assessment.id,
          studentId,
          attemptNumber: index + 1,
          status: "SUBMITTED",
          kind: "PRACTICE",
          score: 1,
          maxScore: questions.length,
          submittedAt: new Date(),
        },
      })
    }

    // Practice numbering did not shift the graded sequence: the first graded attempt is #1.
    const first = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    const stored = await prisma.quizAttempt.findUniqueOrThrow({
      where: { id: first.id },
      select: { attemptNumber: true, kind: true },
    })
    expect(stored.kind).toBe("GRADED")
    expect(stored.attemptNumber).toBe(1)

    // And the graded cap is untouched: one used of two, so a second start is still allowed.
    const settings = await prisma.quizAttempt.count({
      where: { assessmentId: fixture.assessment.id, studentId, kind: "GRADED" },
    })
    expect(settings).toBe(1)

    await submitQuizAttempt(studentUser, first.id, {
      answers: questions.map((question) => ({
        questionId: question.id,
        selectedIndex: 0,
      })),
    })
    const second = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    expect(second.id).not.toBe(first.id)

    await submitQuizAttempt(studentUser, second.id, {
      answers: questions.map((question) => ({
        questionId: question.id,
        selectedIndex: 0,
      })),
    })

    // Two graded sittings used, so the cap now bites — while the three practice rows remain
    // irrelevant to it.
    await expect(
      startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id }),
    ).rejects.toMatchObject({ status: 429 })

    expect(
      await prisma.quizAttempt.count({
        where: { assessmentId: fixture.assessment.id, studentId, kind: "PRACTICE" },
      }),
    ).toBe(3)
  })

  it("enforces the deadline for new attempts", async () => {
    const past = await seedQuiz({ dueDate: new Date(Date.now() - DAY) })
    await expect(
      startQuizAttempt(past.studentUser, { assessmentId: past.fixture.assessment.id }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("flags a submission after the deadline as late", async () => {
    const future = await seedQuiz({ dueDate: new Date(Date.now() + DAY) })
    const view = await startQuizAttempt(future.studentUser, {
      assessmentId: future.fixture.assessment.id,
    })
    await prisma.assessment.update({
      where: { id: future.fixture.assessment.id },
      data: { dueDate: new Date(Date.now() - 60 * 60 * 1000) },
    })
    const submitted = await submitQuizAttempt(future.studentUser, view.id, {
      answers: [{ questionId: future.questions[0].id, selectedIndex: 0 }],
    })
    expect(submitted.isLate).toBe(true)
    expect(
      await prisma.auditLog.count({
        where: { entityType: "QuizAttempt", action: "quiz_attempt.submitted_late" },
      }),
    ).toBe(1)
  })

  it("prevents editing a submitted attempt", async () => {
    const { fixture, questions, studentUser } = await seedQuiz({ questionCount: 1 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    await submitQuizAttempt(studentUser, view.id, {
      answers: [{ questionId: questions[0].id, selectedIndex: 0 }],
    })

    await expect(
      submitQuizAttempt(studentUser, view.id, {
        answers: [{ questionId: questions[0].id, selectedIndex: 1 }],
      }),
    ).rejects.toMatchObject({ status: 409 })

    const responses = await prisma.quizResponse.findMany({ where: { attemptId: view.id } })
    expect(responses).toHaveLength(1)
    expect(responses[0].isCorrect).toBe(true)
  })

  it("rejects a duplicate answer and leaves the attempt untouched", async () => {
    const { fixture, questions, studentUser } = await seedQuiz({ questionCount: 1 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    await expect(
      submitQuizAttempt(studentUser, view.id, {
        answers: [
          { questionId: questions[0].id, selectedIndex: 0 },
          { questionId: questions[0].id, selectedIndex: 1 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 })

    const attempt = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: view.id } })
    expect(attempt.status).toBe("IN_PROGRESS")
    expect(await prisma.quizResponse.count({ where: { attemptId: view.id } })).toBe(0)
  })

  it("refuses to deliver a quiz with unpublished draft questions", async () => {
    const { fixture, studentUser } = await seedQuiz({ draft: true })
    await expect(
      startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id }),
    ).rejects.toMatchObject({ status: 409 })
  })

  it("denies a student who is not actively enrolled", async () => {
    const fixture = await createSpineFixture(prisma)
    await prisma.question.create({
      data: {
        assessmentId: fixture.assessment.id,
        order: 1,
        prompt: "Question 1",
        options: {
          create: [
            { order: 0, text: "Option A", isCorrect: true },
            { order: 1, text: "Option B", isCorrect: false },
          ],
        },
      },
    })
    const unenrolled = studentSession(fixture.student)
    await expect(
      startQuizAttempt(unenrolled, { assessmentId: fixture.assessment.id }),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("denies cross-student reads and cross-teacher reads", async () => {
    const { fixture, questions, studentUser } = await seedQuiz({ questionCount: 2 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })

    const otherStudent = await createOtherStudent()
    await prisma.enrollment.create({
      data: {
        studentId: otherStudent.profileId,
        offeringId: fixture.offering.id,
        status: "active",
      },
    })
    await expect(getStudentAttempt(otherStudent.user, view.id)).rejects.toMatchObject({
      status: 404,
    })
    await expect(
      submitQuizAttempt(otherStudent.user, view.id, {
        answers: [{ questionId: questions[0].id, selectedIndex: 0 }],
      }),
    ).rejects.toMatchObject({ status: 404 })

    const otherTeacher = await createOtherTeacher()
    await expect(listTeacherAttempts(otherTeacher, fixture.assessment.id)).rejects.toMatchObject({
      status: 403,
    })
    await expect(getTeacherAttempt(otherTeacher, view.id)).rejects.toMatchObject({ status: 403 })
  })

  it("feeds the existing adaptive-retake selector from persisted responses", async () => {
    const { fixture, questions, studentUser } = await seedQuiz({ questionCount: 3 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    await submitQuizAttempt(studentUser, view.id, {
      answers: [
        { questionId: questions[0].id, selectedIndex: 1 },
        { questionId: questions[1].id, selectedIndex: 0 },
        { questionId: questions[2].id, selectedIndex: null },
      ],
    })

    const selection = await latestFailedQuestionIds(studentUser, fixture.assessment.id)
    expect(selection.failedQuestionIds).toEqual([questions[0].id])
    expect(selection.unansweredQuestionIds).toEqual([questions[2].id])

    const retakable = await listStudentRetakableAssessmentsForStudent(studentUser)
    const entry = retakable.find((assessment) => assessment.id === fixture.assessment.id)
    expect(entry?.failedCount).toBe(1)
    expect(entry?.unansweredCount).toBe(1)
  })

  it("autosaves in-progress answers and restores them on reopen (SL-1)", async () => {
    const { fixture, questions, studentUser } = await seedQuiz({ questionCount: 2 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    // A fresh sitting has no drafts.
    expect(view.draftAnswers).toEqual([])

    await saveQuizAttemptDraft(studentUser, view.id, {
      answers: [
        { questionId: questions[0].id, selectedIndex: 2 },
        { questionId: questions[1].id, selectedIndex: null },
      ],
    })

    // The reopen path reads the saved answers back rather than resetting them to null.
    const reopened = await getStudentAttempt(studentUser, view.id)
    expect(reopened.status).toBe("IN_PROGRESS")
    expect(reopened.draftAnswers).toEqual([
      { questionId: questions[0].id, selectedIndex: 2, answerText: null },
    ])

    // A draft is not scored and publishes nothing.
    const responses = await prisma.quizResponse.findMany({ where: { attemptId: view.id } })
    expect(responses).toHaveLength(1)
    expect(responses[0].isCorrect).toBeNull()
    expect(responses[0].pointsAwarded).toBeNull()
    expect(await prisma.grade.count()).toBe(0)
    expect(await prisma.aIGradeSuggestion.count()).toBe(0)
  })

  it("replaces autosaved drafts with scored responses at submit (SL-1)", async () => {
    const { fixture, questions, studentUser } = await seedQuiz({ questionCount: 2 })
    const view = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    await saveQuizAttemptDraft(studentUser, view.id, {
      answers: [
        { questionId: questions[0].id, selectedIndex: 1 },
        { questionId: questions[1].id, selectedIndex: 1 },
      ],
    })

    const submitted = await submitQuizAttempt(studentUser, view.id, {
      answers: [
        { questionId: questions[0].id, selectedIndex: 0 },
        { questionId: questions[1].id, selectedIndex: 1 },
      ],
    })
    expect(submitted.status).toBe("SUBMITTED")
    expect(submitted.draftAnswers).toEqual([])

    // Exactly the scored rows, not the draft plus the scored rows.
    const responses = await prisma.quizResponse.findMany({
      where: { attemptId: view.id },
      orderBy: { question: { order: "asc" } },
    })
    expect(responses).toHaveLength(2)
    expect(responses[0].isCorrect).toBe(true)
    expect(responses[1].isCorrect).toBe(false)

    // A submitted attempt refuses further autosaves.
    await expect(saveQuizAttemptDraft(studentUser, view.id, { answers: [] })).rejects.toMatchObject(
      { status: 409 },
    )
  })

  it("starts a graded sitting even when a practice sitting is in progress (SN-2)", async () => {
    const { fixture, studentId, studentUser } = await seedQuiz({ questionCount: 1 })

    // The state the audit's harness created: an in-progress PRACTICE sitting. Before the kind
    // scope existed, starting the graded quiz resumed this and submitting it recorded nothing.
    const practice = await prisma.quizAttempt.create({
      data: {
        assessmentId: fixture.assessment.id,
        studentId,
        attemptNumber: 1,
        status: "IN_PROGRESS",
        kind: "PRACTICE",
      },
    })

    const graded = await startQuizAttempt(studentUser, { assessmentId: fixture.assessment.id })
    expect(graded.id).not.toBe(practice.id)

    const stored = await prisma.quizAttempt.findUniqueOrThrow({
      where: { id: graded.id },
      select: { kind: true, status: true },
    })
    expect(stored.kind).toBe("GRADED")
    expect(stored.status).toBe("IN_PROGRESS")

    // The practice sitting is untouched.
    const untouched = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: practice.id } })
    expect(untouched.status).toBe("IN_PROGRESS")
    expect(untouched.kind).toBe("PRACTICE")
  })
})
