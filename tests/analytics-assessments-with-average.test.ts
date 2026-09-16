import { describe, expect, it } from "vitest"

import { assessmentsWithAverage } from "@/lib/analytics"
import { markKey, type Assessment, type MarksMap, type Student } from "@/lib/gradebook"

/**
 * The teacher dashboard's "Average score by assessment" series.
 *
 * These tests exist because the series once rendered a coordinate for every assessment on the
 * course, coercing a missing average to `0`. An assessment with no published mark then drew a bar
 * indistinguishable from a cohort that genuinely averaged zero — and the chart's screen-reader
 * description announced it as "0%" — which is the "no page renders a number that nothing derives"
 * rule in `docs/plans/mockup-to-backend.md` §8.
 *
 * The distinction being protected is the one `assessmentAverage` encodes by returning `null`
 * instead of `0`. So the tests assert on **which assessments appear at all**, not only on the
 * values, because a regression to `?? 0` would leave the length and ordering plausible.
 */

const students: Student[] = [
  { id: "s1", name: "Asha", email: "asha@example.test" },
  { id: "s2", name: "Bilal", email: "bilal@example.test" },
]

function assessment(id: string, title: string, maxMarks = 100): Assessment {
  return {
    id,
    title,
    courseId: "c1",
    courseName: "Data Structures",
    type: "QUIZ",
    date: "2026-09-01",
    maxMarks,
    offeringId: "o1",
    classId: "cl1",
  }
}

/** A mark map in the gradebook's own key format, expressed as raw scores out of each maximum. */
function rawMarks(entries: { studentId: string; assessmentId: string; raw: number }[]): MarksMap {
  return Object.fromEntries(
    entries.map(({ studentId, assessmentId, raw }) => [markKey(studentId, assessmentId), raw]),
  )
}

describe("assessmentsWithAverage", () => {
  it("omits an assessment that no student has a mark for", () => {
    const series = assessmentsWithAverage(
      rawMarks([
        { studentId: "s1", assessmentId: "a1", raw: 80 },
        { studentId: "s2", assessmentId: "a1", raw: 60 },
      ]),
      students,
      [assessment("a1", "Quiz 1"), assessment("a2", "Quiz 2")],
    )

    expect(series.map((entry) => entry.assessment.id)).toEqual(["a1"])
    expect(series.map((entry) => entry.average)).toEqual([70])
  })

  it("keeps a genuine zero average, which is not the same as no average", () => {
    // A regression cannot be caught by testing for `0`: a real 0% average must still be charted, so
    // the fix has to distinguish "no marks at all" from "marks that all scored zero".
    const series = assessmentsWithAverage(
      rawMarks([
        { studentId: "s1", assessmentId: "a1", raw: 0 },
        { studentId: "s2", assessmentId: "a1", raw: 0 },
      ]),
      students,
      [assessment("a1", "Quiz 1")],
    )

    expect(series).toHaveLength(1)
    expect(series[0].average).toBe(0)
  })

  it("does not treat a partially-marked assessment as unmarked", () => {
    // One student marked, one not: the average is over the marked subset, so it must appear.
    const series = assessmentsWithAverage(
      rawMarks([{ studentId: "s1", assessmentId: "a1", raw: 90 }]),
      students,
      [assessment("a1", "Quiz 1")],
    )

    expect(series).toHaveLength(1)
    expect(series[0].average).toBe(90)
  })

  it("projects the score onto the assessment's own maximum", () => {
    // A 15-out-of-30 quiz is 50%, not 15% — the projection is what the chart is titled on.
    const series = assessmentsWithAverage(
      rawMarks([{ studentId: "s1", assessmentId: "a1", raw: 15 }]),
      students,
      [assessment("a1", "Short quiz", 30)],
    )

    expect(series[0].average).toBe(50)
  })

  it("reports the position in the input list, not in the result", () => {
    // The label uses this to disambiguate assessments whose titles truncate identically, so an
    // omitted earlier assessment must not shift the ones after it.
    const series = assessmentsWithAverage(
      rawMarks([{ studentId: "s1", assessmentId: "a3", raw: 100 }]),
      students,
      [assessment("a1", "One"), assessment("a2", "Two"), assessment("a3", "Three")],
    )

    expect(series).toHaveLength(1)
    expect(series[0].position).toBe(2)
  })

  it("returns nothing when no assessment has an average", () => {
    // The empty series is what lets the chart fall back to its "No finalized attempts yet."
    // description instead of drawing an axis of zero-height bars.
    const series = assessmentsWithAverage(rawMarks([]), students, [
      assessment("a1", "One"),
      assessment("a2", "Two"),
    ])

    expect(series).toEqual([])
  })

  it("returns nothing when there are no students, rather than dividing by zero", () => {
    const series = assessmentsWithAverage(rawMarks([]), [], [assessment("a1", "One")])

    expect(series).toEqual([])
  })
})
