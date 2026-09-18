import { describe, expect, it } from "vitest"

import {
  buildCurrentTermMarks,
  type GradePeriod,
  type ReleasedMark,
  type StudentGrades,
  type SubjectTermGroup,
} from "@/lib/student-grades"

/**
 * `buildCurrentTermMarks` — the pure view model behind `/student/marks`.
 *
 * The page is a re-presentation, so the assertions are about *what is left out*: past
 * periods, unreleased marks, and any arithmetic that would turn "no mark" into `0`. These
 * are the three ways a marks page can lie, and none of them is visible from a rendered
 * page when the seed happens to have data.
 */

const CURRENT: GradePeriod = { term: "Semester-1", academicYear: 2026 }
const PRIOR: GradePeriod = { term: "Semester-2", academicYear: 2025 }

function mark(id: string, percentage: number | null): ReleasedMark {
  return {
    assessmentId: id,
    title: `Assessment ${id}`,
    type: "QUIZ",
    dueDate: "2026-02-01T08:00:00.000Z",
    score: percentage === null ? null : percentage / 2,
    maxMarks: 50,
    percentage,
  }
}

function group(
  period: GradePeriod,
  marks: ReleasedMark[],
  counts: Partial<Pick<SubjectTermGroup, "awaitingReleaseCount" | "notMarkedCount">> = {},
): SubjectTermGroup {
  const percentages = marks
    .map((entry) => entry.percentage)
    .filter((value): value is number => value !== null)
  const awaitingReleaseCount = counts.awaitingReleaseCount ?? 0
  const notMarkedCount = counts.notMarkedCount ?? 0
  return {
    period,
    marks,
    average:
      percentages.length > 0
        ? percentages.reduce((sum, value) => sum + value, 0) / percentages.length
        : null,
    awaitingReleaseCount,
    notMarkedCount,
    unreleasedCount: awaitingReleaseCount + notMarkedCount,
    totalCount: marks.length + awaitingReleaseCount + notMarkedCount,
  }
}

function subject(
  courseId: string,
  current: SubjectTermGroup | null,
  prior: SubjectTermGroup[] = [],
): StudentGrades["subjects"][number] {
  return {
    courseId,
    courseCode: courseId.toUpperCase(),
    courseName: `Course ${courseId}`,
    current,
    prior,
    releasedMarkCount: (current?.marks.length ?? 0) + prior.reduce((n, g) => n + g.marks.length, 0),
  }
}

describe("buildCurrentTermMarks", () => {
  it("keeps only the current period and drops subjects that have none", () => {
    const marks = buildCurrentTermMarks({
      currentPeriod: CURRENT,
      periods: [CURRENT, PRIOR],
      subjects: [
        subject("now", group(CURRENT, [mark("a", 80)])),
        subject("old", null, [group(PRIOR, [mark("b", 90)])]),
      ],
    })

    expect(marks.period).toEqual(CURRENT)
    expect(marks.subjects.map((entry) => entry.courseId)).toEqual(["now"])
    expect(marks.releasedMarkCount).toBe(1)
  })

  it("never folds an unreleased mark into the count or the mean", () => {
    const marks = buildCurrentTermMarks({
      currentPeriod: CURRENT,
      periods: [CURRENT],
      subjects: [
        subject("now", group(CURRENT, [mark("a", 80), mark("b", 40)], { awaitingReleaseCount: 1 })),
      ],
    })

    // A third mark entered as 0 would drag the mean to 40; it is excluded entirely.
    expect(marks.releasedMarkCount).toBe(2)
    expect(marks.average).toBeCloseTo(60, 6)
    expect(marks.awaitingReleaseCount).toBe(1)
  })

  it("keeps 'marked, awaiting release' apart from 'not marked yet'", () => {
    const marks = buildCurrentTermMarks({
      currentPeriod: CURRENT,
      periods: [CURRENT],
      subjects: [
        subject(
          "now",
          group(CURRENT, [mark("a", 70)], { awaitingReleaseCount: 2, notMarkedCount: 3 }),
        ),
      ],
    })

    expect(marks.awaitingReleaseCount).toBe(2)
    expect(marks.notMarkedCount).toBe(3)
  })

  it("reports a null average, never zero, when nothing is computable", () => {
    const marks = buildCurrentTermMarks({
      currentPeriod: CURRENT,
      periods: [CURRENT],
      subjects: [subject("now", group(CURRENT, [mark("a", null)]))],
    })

    // The mark is still listed — it exists — but it cannot move a mean.
    expect(marks.releasedMarkCount).toBe(1)
    expect(marks.average).toBeNull()
    expect(marks.average).not.toBe(0)
  })

  it("returns an empty view rather than a synthetic term for a student with no work", () => {
    expect(buildCurrentTermMarks({ currentPeriod: null, periods: [], subjects: [] })).toEqual({
      period: null,
      subjects: [],
      releasedMarkCount: 0,
      awaitingReleaseCount: 0,
      notMarkedCount: 0,
      average: null,
    })
  })
})
