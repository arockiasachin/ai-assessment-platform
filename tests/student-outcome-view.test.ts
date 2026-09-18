import { describe, expect, it } from "vitest"

import type { ArrearReason } from "@/lib/arrears"
import type { CourseOutcome } from "@/lib/grading/policy"
import type { StudentCourseOutcome } from "@/lib/student-course-outcome"
import {
  ARREAR_REASON_LABEL,
  OUTCOME_LABEL,
  arrearEntries,
  completedCourses,
  outcomeExplanation,
  summariseOutcomes,
} from "@/lib/student-outcome-view"

/**
 * The presentation rules for Grades and Arrears.
 *
 * The two pages exist to keep three things apart that look alike in a table — a pass, a
 * fail and an unsaid verdict; a missing total and a zero total; an arrear and a merely
 * incomplete record — so the assertions name the distinction rather than the branch.
 */

type Overrides = Partial<StudentCourseOutcome> & { offeringId: string }

function outcome(overrides: Overrides): StudentCourseOutcome {
  return {
    courseId: "course-1",
    courseCode: "SUBJ-101",
    courseName: "Subject One",
    term: "Term-1",
    academicYear: 2026,
    startsOn: null,
    endsOn: null,
    ended: true,
    finalAssessment: null,
    cat: {
      markedCount: 0,
      totalCount: 0,
      completionRatio: 0,
      percent: null,
      status: "no-cat-gate",
    },
    grandTotal: null,
    completedWeight: 0,
    totalWeight: 0,
    incomplete: false,
    outcome: { status: "not-judged", reason: "no-grand-total" },
    arrear: null,
    ...overrides,
  }
}

const PASS: CourseOutcome = { status: "pass", grandTotal: 74 }
const FAIL: CourseOutcome = { status: "fail", grandTotal: 36, reason: "below-pass-mark" }
const GATE_FAIL: CourseOutcome = {
  status: "fail",
  reason: "fat-ineligible",
  catPercent: 12,
  minimum: 30,
}
const NOT_JUDGED: CourseOutcome = { status: "not-judged", reason: "no-grand-total" }

describe("completedCourses", () => {
  it("keeps ended courses only, so a course still being taught stays on Marks", () => {
    const completed = completedCourses([
      outcome({ offeringId: "done", ended: true }),
      outcome({ offeringId: "running", ended: false }),
    ])

    expect(completed.map((entry) => entry.offeringId)).toEqual(["done"])
  })

  it("keeps a not-judged completed course rather than hiding it", () => {
    const completed = completedCourses([
      outcome({ offeringId: "unjudged", ended: true, outcome: NOT_JUDGED }),
    ])

    expect(completed).toHaveLength(1)
  })

  it("orders newest academic year first, then term, then course code", () => {
    const completed = completedCourses([
      outcome({ offeringId: "old", academicYear: 2025, courseCode: "AAA-100" }),
      outcome({ offeringId: "new", academicYear: 2026, courseCode: "ZZZ-999" }),
      outcome({ offeringId: "same-year", academicYear: 2026, courseCode: "BBB-200" }),
    ])

    expect(completed.map((entry) => entry.offeringId)).toEqual(["same-year", "new", "old"])
  })
})

describe("arrearEntries", () => {
  it("reads the reader's arrear field and never infers one from not-judged", () => {
    const entries = arrearEntries([
      outcome({ offeringId: "absent", arrear: "did-not-appear", outcome: NOT_JUDGED }),
      outcome({ offeringId: "unjudged-no-arrear", arrear: null, outcome: NOT_JUDGED }),
      outcome({ offeringId: "failed", arrear: "failed", outcome: FAIL }),
    ])

    expect(entries.map((entry) => entry.offeringId)).toEqual(["absent", "failed"])
    expect(entries.map((entry) => entry.reason)).toEqual(["did-not-appear", "failed"])
  })

  it("carries the course, term and reason a student needs to act", () => {
    const [entry] = arrearEntries([
      outcome({
        offeringId: "o1",
        courseCode: "MCSE501L",
        courseName: "Data Structures",
        term: "Semester-2",
        academicYear: 2025,
        arrear: "failed",
        outcome: FAIL,
      }),
    ])

    expect(entry).toEqual({
      offeringId: "o1",
      courseCode: "MCSE501L",
      courseName: "Data Structures",
      term: "Semester-2",
      academicYear: 2025,
      reason: "failed",
    })
  })

  it("has a distinct label for each reason", () => {
    const reasons: ArrearReason[] = ["failed", "did-not-appear"]
    const labels = reasons.map((reason) => ARREAR_REASON_LABEL[reason])
    expect(new Set(labels).size).toBe(2)
  })
})

describe("outcomeExplanation", () => {
  it("states the pass and the fail against the pass mark", () => {
    expect(outcomeExplanation(PASS)).toContain("74.0%")
    expect(outcomeExplanation(PASS)).toContain("pass mark")
    expect(outcomeExplanation(FAIL)).toContain("36.0%")
    expect(outcomeExplanation(FAIL)).toContain("below")
  })

  it("explains a gate failure without pretending a total exists", () => {
    const text = outcomeExplanation(GATE_FAIL)
    expect(text).toContain("could not be sat")
    expect(text).toContain("12%")
    expect(text).not.toContain("Weighted grand total")
  })

  it("never words a not-judged course as a failure, even with no total", () => {
    const text = outcomeExplanation(NOT_JUDGED)
    expect(text).toContain("not a failure")
    expect(text).not.toContain("0.0%")
    expect(OUTCOME_LABEL["not-judged"]).not.toBe(OUTCOME_LABEL.fail)
  })
})

describe("summariseOutcomes", () => {
  it("counts each verdict separately, so a not-judged course cannot inflate a pass rate", () => {
    const summary = summariseOutcomes([
      outcome({ offeringId: "p", outcome: PASS, ended: true }),
      outcome({ offeringId: "f", outcome: FAIL, ended: true }),
      outcome({ offeringId: "n", outcome: NOT_JUDGED, ended: true }),
    ])

    expect(summary).toEqual({ total: 3, passed: 1, failed: 1, notJudged: 1 })
  })
})
