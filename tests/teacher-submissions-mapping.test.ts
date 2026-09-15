import { describe, expect, it } from "vitest"

import { toTeacherSubmissionRow, type SubmissionQueryRow } from "@/lib/teacher-submissions"

/**
 * The teacher submissions queue's projection.
 *
 * Pure and database-free on purpose: the read path behind this page
 * (`app/api/teacher/assessments/submissions` GET) had **no test at all**, so
 * this is where the mapping gets one. Two invariants matter most and each has a
 * case here:
 *
 * 1. an unmarked submission yields `points: null`, never `0` (the design system's
 *    null-vs-zero rule);
 * 2. `published` is independent of `points`, because "marked, withheld" is a
 *    state the queue has to name.
 */

const MARK = 30

function row(overrides: {
  status?: SubmissionQueryRow["status"]
  grade?: {
    points: number | string | null
    maxPoints: number | string | null
    published: boolean
  } | null
  maxMarks?: number
  section?: string | null
}): SubmissionQueryRow {
  const grade = overrides.grade ?? null
  return {
    id: "sub_1",
    status: overrides.status ?? "SUBMITTED",
    submittedAt: new Date("2026-09-10T09:00:00.000Z"),
    gradedAt: grade ? new Date("2026-09-11T09:00:00.000Z") : null,
    feedback: grade ? "Well argued." : null,
    versionCount: 2,
    student: { id: "stu_1", fullName: "Aarav Mehta", registerNumber: "REG-1" },
    assessment: {
      id: "asm_1",
      title: "Describing a linear model",
      type: "DESCRIPTIVE",
      dueDate: new Date("2026-09-12T09:00:00.000Z"),
      maxMarks: overrides.maxMarks ?? MARK,
      offering: {
        classRoom: {
          name: "Main Hall",
          section: overrides.section === undefined ? "A" : overrides.section,
        },
        course: { code: "MATH-101", name: "Algebra Foundations" },
      },
      finalGrades: grade
        ? [
            {
              studentId: "stu_1",
              points: grade.points,
              maxPoints: grade.maxPoints,
              publishedAt: grade.published ? new Date("2026-09-12T00:00:00.000Z") : null,
            },
          ]
        : [],
    },
  }
}

describe("toTeacherSubmissionRow", () => {
  it("passes through the real assessment kind, not a Quiz/Assignment collapse", () => {
    expect(toTeacherSubmissionRow(row({})).kind).toBe("DESCRIPTIVE")
  })

  it("renders an unmarked submission as null points, never zero", () => {
    const result = toTeacherSubmissionRow(row({}))
    expect(result.points).toBeNull()
    expect(result.points).not.toBe(0)
    expect(result.published).toBe(false)
    expect(result.gradedAt).toBeNull()
  })

  it("reports a released mark as points plus published", () => {
    const result = toTeacherSubmissionRow(
      row({ status: "GRADED", grade: { points: 21, maxPoints: 30, published: true } }),
    )
    // 21/30 rescaled onto maxMarks 30 is 21.
    expect(result.points).toBe(21)
    expect(result.published).toBe(true)
  })

  it("reports a withheld mark as points WITHOUT published — the state the count names", () => {
    const result = toTeacherSubmissionRow(
      row({ status: "GRADED", grade: { points: 21, maxPoints: 30, published: false } }),
    )
    expect(result.points).toBe(21)
    expect(result.published).toBe(false)
  })

  it("rescales the mark onto the assessment's maxMarks", () => {
    // 15/20 rescaled onto 30 marks is 22.5.
    const result = toTeacherSubmissionRow(
      row({ grade: { points: 15, maxPoints: 20, published: true }, maxMarks: 30 }),
    )
    expect(result.points).toBe(22.5)
    expect(result.maxPoints).toBe(30)
  })

  it("ignores another student's grade", () => {
    const query = row({})
    query.assessment.finalGrades = [
      { studentId: "someone_else", points: 30, maxPoints: 30, publishedAt: new Date() },
    ]
    const result = toTeacherSubmissionRow(query)
    expect(result.points).toBeNull()
    expect(result.published).toBe(false)
  })

  it("treats a grade with null points as unmarked", () => {
    const result = toTeacherSubmissionRow(
      row({ grade: { points: null, maxPoints: null, published: false } }),
    )
    expect(result.points).toBeNull()
    expect(result.published).toBe(false)
  })

  it("joins the class name and section, and omits an absent section", () => {
    expect(toTeacherSubmissionRow(row({ section: "A" })).className).toBe("Main Hall A")
    expect(toTeacherSubmissionRow(row({ section: null })).className).toBe("Main Hall")
  })

  it("carries ISO timestamps and the version count through", () => {
    const result = toTeacherSubmissionRow(row({}))
    expect(result.submittedAt).toBe("2026-09-10T09:00:00.000Z")
    expect(result.dueDate).toBe("2026-09-12T09:00:00.000Z")
    expect(result.versionCount).toBe(2)
    expect(result.studentName).toBe("Aarav Mehta")
  })

  it("handles a submission with no submittedAt", () => {
    const query = row({})
    query.submittedAt = null
    expect(toTeacherSubmissionRow(query).submittedAt).toBeNull()
  })
})
