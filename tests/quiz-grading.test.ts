import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * Object-level authorization for server-side quiz grading. The database layer
 * is mocked so these assertions run without Postgres: a student must be graded
 * as themselves, and a teacher may only grade for assessments they own.
 */
const mocks = vi.hoisted(() => ({
  assessmentFindUnique: vi.fn(),
  studentProfileFindUnique: vi.fn(),
  staffProfileFindUnique: vi.fn(),
  enrollmentFindUnique: vi.fn(),
}))

vi.mock("@/lib/prisma", () => ({
  prisma: {
    assessment: { findUnique: mocks.assessmentFindUnique },
    studentProfile: { findUnique: mocks.studentProfileFindUnique },
    staffProfile: { findUnique: mocks.staffProfileFindUnique },
    enrollment: { findUnique: mocks.enrollmentFindUnique },
  },
}))

import { gradeQuizSubmission } from "@/lib/quiz-grading"
import type { AuthUser } from "@/lib/session"

const assessment = {
  id: "a1",
  title: "Readiness",
  type: "QUIZ",
  maxMarks: 10,
  createdById: "staff-1",
  offering: { id: "o1", teacherId: "staff-1" },
  quiz: {
    questions: [
      { id: "q1", prompt: "2 + 2?", optionsJson: ["3", "4", "5"], correctIndex: 1 },
      { id: "q2", prompt: "3 x 3?", optionsJson: ["6", "9", "12"], correctIndex: 1 },
    ],
  },
}

const student: AuthUser = { id: "user-s1", email: "s1@test.local", role: "student" }
const teacher: AuthUser = { id: "user-t1", email: "t1@test.local", role: "teacher" }

describe("gradeQuizSubmission authorization", () => {
  beforeEach(() => {
    mocks.assessmentFindUnique.mockReset().mockResolvedValue(assessment)
    mocks.studentProfileFindUnique
      .mockReset()
      .mockImplementation((args: { where: { userId?: string; id?: string } }) => {
        if (args.where.userId === student.id) return Promise.resolve({ id: "s1" })
        if (args.where.id === "s1") return Promise.resolve({ id: "s1" })
        return Promise.resolve(null)
      })
    mocks.staffProfileFindUnique.mockReset().mockResolvedValue({ id: "staff-1" })
    mocks.enrollmentFindUnique.mockReset().mockResolvedValue({ status: "active" })
  })

  it("grades for the authenticated student and discloses the key only in the result", async () => {
    const result = await gradeQuizSubmission(
      {
        assessmentId: "a1",
        answers: [
          { questionId: "q1", selectedIndex: 1 },
          { questionId: "q2", selectedIndex: 0 },
        ],
      },
      student,
    )

    expect(result.score).toBe(5)
    expect(result.correctCount).toBe(1)
    expect(result.results[0]).toMatchObject({ correctIndex: 1, correctText: "4", isCorrect: true })
    expect(result.results[1]).toMatchObject({ correctIndex: 1, correctText: "9", isCorrect: false })
  })

  it("refuses a student grading on another student's behalf", async () => {
    await expect(
      gradeQuizSubmission(
        {
          assessmentId: "a1",
          studentId: "s2",
          answers: [{ questionId: "q1", selectedIndex: 1 }],
        },
        student,
      ),
    ).rejects.toMatchObject({ status: 403 })

    expect(mocks.enrollmentFindUnique).not.toHaveBeenCalled()
  })

  it("refuses a teacher who does not own the assessment", async () => {
    mocks.staffProfileFindUnique.mockResolvedValue({ id: "staff-other" })

    await expect(
      gradeQuizSubmission(
        {
          assessmentId: "a1",
          studentId: "s1",
          answers: [{ questionId: "q1", selectedIndex: 1 }],
        },
        teacher,
      ),
    ).rejects.toMatchObject({ status: 403 })
  })

  it("rejects answers that reference an unknown question", async () => {
    await expect(
      gradeQuizSubmission(
        { assessmentId: "a1", answers: [{ questionId: "missing", selectedIndex: 0 }] },
        student,
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
})
