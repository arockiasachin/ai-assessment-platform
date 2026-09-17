import { afterAll, beforeEach, describe, expect, it } from "vitest"

import { listStudentCodeTasks, submitCodeForStudent } from "@/lib/code-eval"
import { listStudentQuizzes, startPracticeAttempt, startQuizAttempt } from "@/lib/quiz-attempts"
import { requestRetake } from "@/lib/quiz-attempts/retake-requests"
import type { AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

/**
 * Release governs *use*, not only visibility (SN-5), on every student write path.
 *
 * The submission route was the first path to enforce this; the audit found the
 * same latent gap on the quiz start (graded and practice), the code submission,
 * and the retake request. Each begins from a student-supplied assessment id, so
 * hiding the assessment from a list only closes the UI flow — a student who
 * knows the id must be refused server-side.
 *
 * The refusal is deliberately the same **404 "Assessment not found."** the
 * submission route uses. `lib/assessment-release.ts` states the convention: an
 * object a caller may not see and an object that does not exist are reported
 * identically, so the endpoint never confirms that an invisible assessment
 * exists. These tests pin that indistinguishability as well as the refusal.
 *
 * The published-list reads carry the same defect in read form — a list that shows
 * an unreleased assessment is the bug SN-5 named — so they are pinned here too.
 */

const FUTURE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
const NOT_FOUND = { status: 404, message: "Assessment not found." }

let f: Awaited<ReturnType<typeof createSpineFixture>>
let student: AuthUser

beforeEach(async () => {
  await truncateAll()
  f = await createSpineFixture(prisma)
  student = { id: f.student.id, email: f.student.email, role: "student" }
  await prisma.enrollment.create({
    data: { studentId: f.student.studentProfile!.id, offeringId: f.offering.id, status: "active" },
  })
})

afterAll(async () => {
  await disconnectTestDatabase()
})

/** Await a call expected to be refused, returning the domain error's status and message. */
async function refusal(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await promise
    throw new Error("expected the call to be refused")
  } catch (error) {
    return error as { status: number; message: string }
  }
}

/** The fields every assessment in this file needs; the caller decides release. */
function assessmentData(overrides: {
  title: string
  type: "QUIZ" | "CODE"
  releasedAt: Date | null
  retakePolicy?: "NONE" | "FIXED" | "APPROVAL"
}) {
  return {
    offeringId: f.offering.id,
    courseId: f.course.id,
    classId: f.classroom.id,
    title: overrides.title,
    type: overrides.type,
    dueDate: FUTURE,
    maxMarks: 20,
    createdById: f.teacher.staffProfile!.id,
    releasedAt: overrides.releasedAt,
    ...(overrides.retakePolicy ? { retakePolicy: overrides.retakePolicy } : {}),
  }
}

/** A published, deliverable question so a quiz start can only be refused by release. */
async function addPublishedQuestion(assessmentId: string) {
  await prisma.question.create({
    data: {
      assessmentId,
      type: "MULTIPLE_CHOICE",
      order: 1,
      prompt: "Which equation is linear?",
      points: 5,
      status: "published",
      options: {
        create: [
          { order: 0, text: "y = 2x + 1", isCorrect: true },
          { order: 1, text: "y = x^2", isCorrect: false },
        ],
      },
    },
  })
}

/** An unreleased quiz on the offering, deliverable, with an APPROVAL retake policy. */
async function unreleasedQuiz() {
  const assessment = await prisma.assessment.create({
    data: assessmentData({
      title: "Hidden quiz",
      type: "QUIZ",
      releasedAt: null,
      retakePolicy: "APPROVAL",
    }),
  })
  await addPublishedQuestion(assessment.id)
  return assessment
}

/** A released quiz on the offering, so a refusal cannot be "it was never startable". */
async function releasedQuiz() {
  const assessment = await prisma.assessment.create({
    data: assessmentData({ title: "Visible quiz", type: "QUIZ", releasedAt: new Date() }),
  })
  await addPublishedQuestion(assessment.id)
  return assessment
}

describe("startQuizAttempt refuses an unreleased assessment", () => {
  it("returns 404 and creates no sitting", async () => {
    const hidden = await unreleasedQuiz()

    await expect(startQuizAttempt(student, { assessmentId: hidden.id })).rejects.toMatchObject(
      NOT_FOUND,
    )
    expect(await prisma.quizAttempt.count({ where: { assessmentId: hidden.id } })).toBe(0)
  })

  it("is indistinguishable from a nonexistent assessment", async () => {
    const missing = await refusal(startQuizAttempt(student, { assessmentId: "does-not-exist" }))
    const hidden = await unreleasedQuiz()
    const refused = await refusal(startQuizAttempt(student, { assessmentId: hidden.id }))

    expect(refused.status).toBe(missing.status)
    expect(refused.message).toBe(missing.message)
  })

  it("still starts a released quiz, so the guard is release-specific", async () => {
    const visible = await releasedQuiz()
    const view = await startQuizAttempt(student, { assessmentId: visible.id })
    expect(view.status).toBe("IN_PROGRESS")
  })
})

describe("startPracticeAttempt refuses an unreleased assessment", () => {
  it("returns 404 and creates no practice sitting", async () => {
    const hidden = await unreleasedQuiz()
    // Make practice otherwise available, so release is the only reason to refuse.
    await prisma.quizAttempt.create({
      data: {
        assessmentId: hidden.id,
        studentId: f.student.studentProfile!.id,
        attemptNumber: 1,
        status: "SUBMITTED",
        kind: "GRADED",
        submittedAt: new Date(),
      },
    })

    await expect(startPracticeAttempt(student, { assessmentId: hidden.id })).rejects.toMatchObject(
      NOT_FOUND,
    )
    expect(
      await prisma.quizAttempt.count({ where: { assessmentId: hidden.id, kind: "PRACTICE" } }),
    ).toBe(0)
  })
})

describe("submitCodeForStudent refuses an unreleased assessment", () => {
  it("returns 404 without invoking the sandbox or writing a run or submission", async () => {
    const hidden = await prisma.assessment.create({
      data: assessmentData({ title: "Hidden code task", type: "CODE", releasedAt: null }),
    })
    const codeTask = await prisma.codeTask.create({
      data: {
        assessmentId: hidden.id,
        language: "python",
        timeLimitMs: 2_000,
        memoryLimitMb: 128,
      },
    })
    await prisma.testCase.create({
      data: {
        codeTaskId: codeTask.id,
        order: 0,
        name: "Echoes the input",
        category: "input-output",
        input: "7\n",
        expectedOutput: "7\n",
        points: 2,
      },
    })

    let calls = 0
    const executor = async () => {
      calls += 1
      throw new Error("the sandbox must never run for an unreleased assessment")
    }

    await expect(
      submitCodeForStudent(
        student,
        { assessmentId: hidden.id, sourceCode: "print(1)" },
        { executor },
      ),
    ).rejects.toMatchObject(NOT_FOUND)

    expect(calls).toBe(0)
    expect(await prisma.testRun.count({ where: { codeTaskId: codeTask.id } })).toBe(0)
    expect(await prisma.submission.count({ where: { assessmentId: hidden.id } })).toBe(0)
  })
})

describe("requestRetake refuses an unreleased assessment", () => {
  it("returns 404 and files no request", async () => {
    const hidden = await unreleasedQuiz()

    await expect(requestRetake(student, hidden.id)).rejects.toMatchObject(NOT_FOUND)
    expect(await prisma.retakeRequest.count({ where: { assessmentId: hidden.id } })).toBe(0)
  })
})

describe("student published lists omit unreleased assessments", () => {
  it("listStudentQuizzes omits an unreleased quiz and keeps the released one", async () => {
    const hidden = await unreleasedQuiz()
    const visible = await releasedQuiz()

    const quizzes = await listStudentQuizzes(student)
    const ids = quizzes.map((quiz) => quiz.assessmentId)

    expect(ids).toContain(visible.id)
    expect(ids).not.toContain(hidden.id)
  })

  it("listStudentCodeTasks omits an unreleased code task and keeps the released one", async () => {
    const hidden = await prisma.assessment.create({
      data: assessmentData({ title: "Hidden code task", type: "CODE", releasedAt: null }),
    })
    const visible = await prisma.assessment.create({
      data: assessmentData({ title: "Visible code task", type: "CODE", releasedAt: new Date() }),
    })
    await prisma.codeTask.create({
      data: {
        assessmentId: hidden.id,
        language: "python",
        timeLimitMs: 2_000,
        memoryLimitMb: 128,
      },
    })
    await prisma.codeTask.create({
      data: {
        assessmentId: visible.id,
        language: "python",
        timeLimitMs: 2_000,
        memoryLimitMb: 128,
      },
    })

    const tasks = await listStudentCodeTasks(student)
    const ids = tasks.map((task) => task.assessmentId)

    expect(ids).toContain(visible.id)
    expect(ids).not.toContain(hidden.id)
  })
})
