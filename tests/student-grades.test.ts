import { describe, expect, it } from "vitest"

import type { AssessmentType } from "@/lib/generated/prisma/enums"
import type { StudentAssessmentItem } from "@/lib/student-assessments"
import { buildStudentGrades, periodKey, periodLabel, type ReleasedMark } from "@/lib/student-grades"

/**
 * `lib/student-grades.ts` — the pure grouping behind `/student/grades`.
 *
 * The module owns three decisions that are easy to get subtly wrong and
 * impossible to see from a rendered page, so each gets an assertion here rather
 * than a hand-check:
 *
 * 1. **What counts as a mark.** Released only. An unreleased mark must not appear
 *    and must not be averaged in as zero — the falsification the whole feature is
 *    built to avoid. `hasMark && !published` and `!hasMark` stay distinguishable.
 * 2. **Which period is current.** There is no semester model, so it is derived:
 *    newest `academicYear`, then latest due date. Pinned here because the page and
 *    the course hub both read it, and a second comparator would be a second
 *    definition of "newer".
 * 3. **That a missing mark stays missing.** A released mark with no computable
 *    percentage (a zero max) is still listed and still does not move the average.
 */

const DEFAULTS: StudentAssessmentItem = {
  id: "unset",
  title: "Untitled",
  type: "QUIZ",
  dueDate: "2026-01-01T08:00:00.000Z",
  maxMarks: 20,
  courseId: "course-1",
  courseCode: "SUBJ-101",
  courseName: "Subject One",
  className: "Class A",
  term: "Term-1",
  academicYear: 2026,
  teacherName: "Teacher",
  score: null,
  percentage: null,
  hasMark: false,
  published: false,
  classAveragePercentage: null,
  classAverageWithheld: false,
  classAverageCohortSize: 0,
  classAverageMinimumCohort: 3,
  quizQuestionCount: 0,
  submissionState: "not_submitted",
  submittedAt: null,
  gradedAt: null,
  feedback: null,
  submissionContent: null,
  submissionBlockedReason: null,
  daysUntilDue: 0,
  isPastDue: false,
}

function item(overrides: Partial<StudentAssessmentItem> & { id: string }): StudentAssessmentItem {
  return { ...DEFAULTS, ...overrides }
}

/** A released mark: the reader populates `score`/`percentage` and sets `published`. */
function released(
  id: string,
  percentage: number,
  overrides: Partial<StudentAssessmentItem> = {},
): StudentAssessmentItem {
  return item({
    id,
    published: true,
    hasMark: true,
    score: (percentage / 100) * (overrides.maxMarks ?? DEFAULTS.maxMarks),
    percentage,
    ...overrides,
  })
}

const markPct = (mark: ReleasedMark) => mark.percentage

describe("periodLabel / periodKey", () => {
  it("names a period by term and academic year, which is all the schema has", () => {
    expect(periodLabel({ term: "Term-2", academicYear: 2025 })).toBe("Term-2 2025")
  })

  it("keys periods so two different years cannot collide on the same term name", () => {
    expect(periodKey({ term: "Term-1", academicYear: 2026 })).not.toBe(
      periodKey({ term: "Term-1", academicYear: 2025 }),
    )
  })
})

describe("buildStudentGrades — released marks only", () => {
  it("lists released marks and hides unreleased ones entirely", () => {
    const grades = buildStudentGrades([
      released("a", 80),
      item({ id: "b", hasMark: true, published: false }),
      item({ id: "c" }),
    ])

    const group = grades.subjects[0].current!
    expect(group.marks.map((mark) => mark.assessmentId)).toEqual(["a"])
  })

  it("never averages an unreleased mark in as zero", () => {
    // Two released marks at 80% and 40%, plus a marked-but-unreleased one that
    // would drag the mean to 40 if it were counted as a zero.
    const grades = buildStudentGrades([
      released("a", 80),
      released("b", 40),
      item({ id: "c", hasMark: true, published: false }),
    ])

    expect(grades.subjects[0].current!.average).toBeCloseTo(60, 6)
  })

  it("keeps 'marked, awaiting release' apart from 'no mark at all'", () => {
    const grades = buildStudentGrades([
      released("a", 70),
      item({ id: "b", hasMark: true, published: false }),
      item({ id: "c" }),
      item({ id: "d" }),
    ])

    const group = grades.subjects[0].current!
    expect(group.awaitingReleaseCount).toBe(1)
    expect(group.notMarkedCount).toBe(2)
    expect(group.unreleasedCount).toBe(3)
    expect(group.totalCount).toBe(4)
  })

  it("reports a null average, not zero, when nothing is released", () => {
    const grades = buildStudentGrades([item({ id: "a", hasMark: true, published: false })])

    expect(grades.subjects[0].current!.marks).toEqual([])
    expect(grades.subjects[0].current!.average).toBeNull()
    expect(grades.subjects[0].releasedMarkCount).toBe(0)
  })

  it("still lists a released mark whose percentage cannot be computed, without averaging it", () => {
    // A stored `maxPoints` of zero leaves the reader with `published: true` and
    // `percentage: null`. The mark is real and must be visible; it must not become
    // a zero in the mean.
    const grades = buildStudentGrades([
      released("a", 80),
      item({ id: "b", hasMark: true, published: true, score: null, percentage: null }),
    ])

    const group = grades.subjects[0].current!
    expect(group.marks.map((mark) => mark.assessmentId)).toEqual(["a", "b"])
    expect(group.marks.filter((mark) => markPct(mark) === null)).toHaveLength(1)
    expect(group.average).toBeCloseTo(80, 6)
  })
})

describe("buildStudentGrades — current vs prior", () => {
  it("treats the highest academic year as current even when its dates are earlier", () => {
    // The year is the coarse period fact, so 2026 outranks 2025 regardless of
    // which term's work happens to be dated later.
    const grades = buildStudentGrades([
      released("new-term", 70, { term: "Term-1", academicYear: 2026, dueDate: "2026-02-01" }),
      released("old-term", 90, { term: "Term-2", academicYear: 2025, dueDate: "2025-11-01" }),
    ])

    expect(grades.currentPeriod).toEqual({ term: "Term-1", academicYear: 2026 })
  })

  it("breaks a same-year tie on the latest due date rather than the term's name", () => {
    // Within one year, real dates are the signal: `Term-2` starting in July is
    // later than `Semester-1`, which alphabetical comparison of the labels would
    // get backwards.
    const grades = buildStudentGrades([
      released("sem1", 60, { term: "Semester-1", academicYear: 2026, dueDate: "2026-03-01" }),
      released("term2", 60, { term: "Term-2", academicYear: 2026, dueDate: "2026-10-01" }),
    ])

    expect(grades.currentPeriod).toEqual({ term: "Term-2", academicYear: 2026 })
    expect(grades.periods).toEqual([
      { term: "Term-2", academicYear: 2026 },
      { term: "Semester-1", academicYear: 2026 },
    ])
  })

  it("splits one subject into a current group and newest-first prior groups", () => {
    const grades = buildStudentGrades([
      released("now", 75, { term: "Term-1", academicYear: 2026, dueDate: "2026-02-01" }),
      released("last", 50, { term: "Term-2", academicYear: 2025, dueDate: "2025-09-01" }),
      released("older", 25, { term: "Term-1", academicYear: 2025, dueDate: "2025-03-01" }),
    ])

    const subject = grades.subjects[0]
    expect(subject.current?.period).toEqual({ term: "Term-1", academicYear: 2026 })
    expect(subject.current?.average).toBeCloseTo(75, 6)
    expect(subject.prior.map((group) => periodLabel(group.period))).toEqual([
      "Term-2 2025",
      "Term-1 2025",
    ])
    expect(subject.prior.map((group) => group.average)).toEqual([50, 25])
    expect(subject.releasedMarkCount).toBe(3)
  })

  it("gives a subject taken only in a previous term current: null rather than folding it in", () => {
    const grades = buildStudentGrades([
      released("history", 65, {
        id: "history",
        term: "Term-2",
        academicYear: 2025,
        courseId: "course-old",
        courseCode: "OLD-101",
        courseName: "Old Subject",
      }),
      released("now", 80, { term: "Term-1", academicYear: 2026 }),
    ])

    const old = grades.subjects.find((subject) => subject.courseId === "course-old")!
    expect(old.current).toBeNull()
    expect(old.prior.map((group) => periodLabel(group.period))).toEqual(["Term-2 2025"])
    expect(old.prior[0].average).toBeCloseTo(65, 6)
  })

  it("returns an empty view for a student with no assessments", () => {
    expect(buildStudentGrades([])).toEqual({ currentPeriod: null, periods: [], subjects: [] })
  })
})

describe("buildStudentGrades — grouping and order", () => {
  it("groups by course id, not by course code or name", () => {
    const grades = buildStudentGrades([
      released("a", 60, { courseId: "c1" }),
      released("b", 80, { courseId: "c2" }),
    ])

    expect(grades.subjects.map((subject) => subject.courseId).sort()).toEqual(["c1", "c2"])
  })

  it("merges two offerings of the same course in one term into one group", () => {
    const grades = buildStudentGrades([released("a", 60), released("b", 80)])

    expect(grades.subjects).toHaveLength(1)
    expect(grades.subjects[0].current!.marks).toHaveLength(2)
  })

  it("orders marks inside a term by due date, earliest first", () => {
    const grades = buildStudentGrades([
      released("later", 60, { dueDate: "2026-05-01" }),
      released("earlier", 70, { dueDate: "2026-02-01" }),
    ])

    expect(grades.subjects[0].current!.marks.map((mark) => mark.assessmentId)).toEqual([
      "earlier",
      "later",
    ])
  })

  it("puts subjects with current-term work before subjects that only have prior terms", () => {
    const grades = buildStudentGrades([
      released("old", 60, {
        term: "Term-1",
        academicYear: 2025,
        dueDate: "2025-03-01",
        courseId: "course-old",
        courseCode: "AAA-100",
      }),
      released("now", 70, {
        term: "Term-2",
        academicYear: 2025,
        dueDate: "2025-09-01",
        courseId: "course-new",
        courseCode: "ZZZ-999",
      }),
    ])

    // The current period is Term-2 2025, so `course-new` has current-term work and
    // `course-old` — alphabetically first — does not, and must still sort below it.
    expect(grades.currentPeriod).toEqual({ term: "Term-2", academicYear: 2025 })
    expect(grades.subjects.map((subject) => subject.courseId)).toEqual(["course-new", "course-old"])
  })

  it("carries the assessment kind and max marks through to the mark row", () => {
    const types: AssessmentType[] = ["ASSIGNMENT", "DESCRIPTIVE"]
    const grades = buildStudentGrades([
      released("a", 75, { type: types[0], maxMarks: 40, title: "Assignment" }),
    ])

    expect(grades.subjects[0].current!.marks[0]).toMatchObject({
      assessmentId: "a",
      title: "Assignment",
      type: "ASSIGNMENT",
      maxMarks: 40,
    })
  })

  it("is deterministic: the same rows produce the same order", () => {
    const rows = [
      released("a", 60, { courseId: "c2", courseCode: "B-2" }),
      released("b", 70, { courseId: "c1", courseCode: "A-1" }),
      released("c", 80, { courseId: "c3", courseCode: "C-3" }),
    ]

    expect(buildStudentGrades(rows)).toEqual(buildStudentGrades([...rows].reverse()))
  })
})
