import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Phase 4: retire the legacy `Quiz` / `QuizQuestion` store.
 *
 * The import path used to write the legacy models, which the modern scorer
 * (`lib/quiz-generation/grading.ts` + `lib/quiz-attempts/**`) never reads. These
 * tests pin the replacement end to end:
 *
 *  - an import writes modern `Question` / `QuestionOption` rows, published and
 *    attributed to the importing teacher;
 *  - the existing scorers actually grade what was imported;
 *  - the explicit-offering contract rejects a non-owner offering with a 403;
 *  - a student can never reach the import route;
 *  - the student-facing payload carries the imported question without a key;
 *  - the retired tables no longer exist.
 */
const mocks = vi.hoisted(() => ({
  getCookies: vi.fn(),
}))

vi.mock("next/headers", () => ({
  cookies: () => mocks.getCookies(),
}))

// Route tests use synthetic sessions; the DB re-validation is covered by
// tests/session-role-revalidation.test.ts.
vi.mock("@/lib/authz-actor", () => ({
  revalidateSessionActor: (user: unknown) => Promise.resolve(user),
}))

import { POST as importQuizPost } from "@/app/api/teacher/quiz/route"
import {
  createQuizFromImportForSessionUser,
  getGradebookPayloadForSessionUser,
} from "@/lib/gradebook-db"
import { startQuizAttempt, submitQuizAttempt } from "@/lib/quiz-attempts"
import { gradeQuizSubmission } from "@/lib/quiz-grading"
import { signSessionValue, type AuthUser } from "@/lib/session"

import { disconnectTestDatabase, prisma, truncateAll } from "./helpers/db"
import { createSpineFixture } from "./fixtures/spine"

const DAY = 24 * 60 * 60 * 1000

function teacherSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "teacher" }
}

function studentSession(user: { id: string; email: string }): AuthUser {
  return { id: user.id, email: user.email, role: "student" }
}

function futureIsoDate() {
  return new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10)
}

function useSession(user: { id: string; email: string; role: "teacher" | "student" | "admin" }) {
  mocks.getCookies.mockReturnValue({
    get: (name: string) => ({ name, value: signSessionValue(user) }),
  })
}

function importBody(offeringId: string) {
  return {
    offeringId,
    quizMetadata: { title: "Imported Quiz", dueDate: futureIsoDate(), totalMarks: 3 },
    questions: [
      {
        // Exercise the `correctAnswerId` resolution branch.
        questionText: "2 + 2?",
        options: [
          { optionId: "A", text: "3" },
          { optionId: "B", text: "4" },
          { optionId: "C", text: "5" },
        ],
        correctAnswerId: "B",
        marks: 1,
      },
      {
        // Exercise the numeric `correctIndex` branch.
        questionText: "3 x 3?",
        options: [{ text: "6" }, { text: "9" }],
        correctIndex: 1,
        marks: 2,
      },
    ],
  }
}

function importRequest(body: unknown) {
  return new Request("https://app.test/api/teacher/quiz", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

async function importAndEnroll(options: { enroll: boolean }) {
  const fixture = await createSpineFixture(prisma)
  const studentId = fixture.student.studentProfile!.id
  if (options.enroll) {
    await prisma.enrollment.create({
      data: { studentId, offeringId: fixture.offering.id, status: "active" },
    })
  }
  const created = await createQuizFromImportForSessionUser(
    importBody(fixture.offering.id),
    teacherSession(fixture.teacher),
  )
  // The gradebook payload's student projection enforces release (SN-29), and the import path
  // creates the assessment unreleased. An imported quiz is meant to be delivered, so the setup
  // releases it; the assertions are unchanged.
  await prisma.assessment.update({
    where: { id: created.id },
    data: { releasedAt: new Date("2026-01-01T00:00:00.000Z") },
  })
  return { fixture, studentId, created }
}

describe("legacy quiz retirement — import path", () => {
  beforeEach(async () => {
    await truncateAll()
    mocks.getCookies.mockReset()
  })

  afterAll(async () => {
    await disconnectTestDatabase()
  })

  it("lands the import as published, attributed modern questions that score end to end", async () => {
    const { fixture, studentId, created } = await importAndEnroll({ enroll: true })

    expect(created.offeringId).toBe(fixture.offering.id)
    expect(created.questionCount).toBe(2)
    expect(created.maxMarks).toBe(3)

    const questions = await prisma.question.findMany({
      where: { assessmentId: created.id },
      include: { options: { orderBy: { order: "asc" } } },
      orderBy: { order: "asc" },
    })
    expect(questions).toHaveLength(2)

    const staffId = fixture.teacher.staffProfile!.id
    for (const question of questions) {
      expect(question.status).toBe("published")
      expect(question.publishedAt).not.toBeNull()
      expect(question.publishedById).toBe(staffId)
      expect(question.options).toHaveLength(question.order === 0 ? 3 : 2)
      expect(question.options.filter((option) => option.isCorrect)).toHaveLength(1)
    }
    expect(questions[0].options.map((option) => option.text)).toEqual(["3", "4", "5"])
    expect(questions[0].options.find((option) => option.isCorrect)?.text).toBe("4")
    expect(questions[1].options.find((option) => option.isCorrect)?.text).toBe("9")
    expect(Number(questions[0].points)).toBe(1)
    expect(Number(questions[1].points)).toBe(2)

    // The modern attempt pipeline — the only writer of persisted responses and
    // a pending suggestion — can deliver and score what was imported.
    const student = studentSession(fixture.student)
    const attempt = await startQuizAttempt(student, { assessmentId: created.id })
    expect(attempt.questions).toHaveLength(2)

    const answers = questions.map((question) => ({
      questionId: question.id,
      selectedIndex: question.options.findIndex((option) => option.isCorrect),
    }))
    const submitted = await submitQuizAttempt(student, attempt.id, { answers })

    expect(submitted.score).toBe(3)
    expect(submitted.maxScore).toBe(3)
    expect(submitted.results).toHaveLength(2)
    expect(submitted.results?.every((result) => result.isCorrect)).toBe(true)

    const responses = await prisma.quizResponse.findMany({ where: { attemptId: attempt.id } })
    expect(responses).toHaveLength(2)
    expect(responses.every((response) => response.isCorrect === true)).toBe(true)

    // The server-side quiz runner grades from the same modern rows.
    const graded = await gradeQuizSubmission(
      { assessmentId: created.id, studentId, answers },
      student,
    )
    expect(graded.score).toBe(3)
    expect(graded.correctCount).toBe(2)
  })

  it("rejects an offering owned by another teacher through the service and the route", async () => {
    const fixture = await createSpineFixture(prisma)
    const other = await prisma.user.create({
      data: {
        email: "other-quiz-teacher@test.local",
        passwordHash: "test-only-not-a-real-hash",
        role: "TEACHER",
        staffProfile: { create: { fullName: "Olive Teacher", empId: "EMP-OTHER-QUIZ" } },
      },
      include: { staffProfile: true },
    })
    const otherOffering = await prisma.courseOffering.create({
      data: {
        courseId: fixture.course.id,
        classId: fixture.classroom.id,
        teacherId: other.staffProfile!.id,
        term: "Other term",
        academicYear: 2026,
      },
    })

    await expect(
      createQuizFromImportForSessionUser(
        importBody(otherOffering.id),
        teacherSession(fixture.teacher),
      ),
    ).rejects.toThrow("Offering not found or not owned by you.")
    expect(await prisma.assessment.count({ where: { offeringId: otherOffering.id } })).toBe(0)

    useSession({ id: fixture.teacher.id, email: fixture.teacher.email, role: "teacher" })
    const response = await importQuizPost(importRequest(importBody(otherOffering.id)))
    const body = (await response.json()) as { message: string }

    expect(response.status).toBe(403)
    expect(body.message).toBe("Offering not found or not owned by you.")
    expect(await prisma.assessment.count({ where: { offeringId: otherOffering.id } })).toBe(0)
  })

  it("rejects a student at the import route before anything is written", async () => {
    const fixture = await createSpineFixture(prisma)
    useSession({ id: fixture.student.id, email: fixture.student.email, role: "student" })

    const response = await importQuizPost(importRequest(importBody(fixture.offering.id)))

    expect(response.status).toBe(403)
    expect(await prisma.assessment.count({ where: { offeringId: fixture.offering.id } })).toBe(1)
  })

  it("carries the imported question to students without an answer key", async () => {
    const { fixture, created } = await importAndEnroll({ enroll: true })

    // The gradebook payload (the JSON-backed quiz runner) exposes the imported
    // question set with no correctness field.
    const payload = await getGradebookPayloadForSessionUser(studentSession(fixture.student))
    const quiz = payload.quizzes.find((entry) => entry.assessmentId === created.id)
    expect(quiz).toBeDefined()
    expect(quiz?.questions).toHaveLength(2)
    expect(quiz?.questions[0].options).toEqual(["3", "4", "5"])

    const serializedQuiz = JSON.stringify(quiz)
    expect(serializedQuiz).not.toContain("isCorrect")
    expect(serializedQuiz).not.toContain("correctIndex")
    expect(serializedQuiz).not.toContain("correctOptionId")

    // The modern attempt view is key-free before submission too.
    const attempt = await startQuizAttempt(studentSession(fixture.student), {
      assessmentId: created.id,
    })
    expect(attempt.results).toBeNull()
    const serializedAttempt = JSON.stringify(attempt)
    expect(serializedAttempt).not.toContain("isCorrect")
    expect(serializedAttempt).not.toContain("correctIndex")
    expect(serializedAttempt).not.toContain("correctOptionId")
  })

  it("has dropped the legacy Quiz / QuizQuestion tables", async () => {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT "tablename" FROM pg_tables
      WHERE "schemaname" = 'public' AND "tablename" IN ('Quiz', 'QuizQuestion')
    `
    expect(rows).toHaveLength(0)
  })
})
