import { describe, expect, it } from "vitest"

import type { AnalyticsAssessmentSummary, AtRiskStudentValue } from "@/lib/contracts/analytics"
import type { AiGradeSuggestionResponse, GradeReviewResponse } from "@/lib/contracts/grading"
import type { ReviewQueueItem } from "@/lib/rubric-grading/contracts"
import type { TeacherDeadlineItem } from "@/lib/teacher-planner"
import {
  atRiskCounts,
  attentionForOffering,
  buildAssessmentProgressRows,
  cohortAverageFromAssessments,
  cohortTrendPoints,
  hasTrendData,
  lowestConfidence,
  markingProgress,
  reviewQueueForOffering,
  teacherDashboardKpis,
} from "@/lib/teacher-dashboard-view"

/**
 * The teacher dashboard's view logic.
 *
 * Pure and here rather than inside the component because this repo has no jsdom — and
 * because these functions are what decide whether a number is real. A fabricated KPI
 * would not fail a typecheck, so the derivations need assertions of their own.
 */

function assessment(
  overrides: Partial<AnalyticsAssessmentSummary> = {},
): AnalyticsAssessmentSummary {
  return {
    id: "asm_1",
    title: "Linear Equations Check-in",
    type: "QUIZ",
    dueDate: "2026-09-28T08:00:00.000Z",
    maxMarks: 20,
    attemptCount: 12,
    average: 74,
    passRate: 0.8,
    ...overrides,
  }
}

function deadline(overrides: Partial<TeacherDeadlineItem> = {}): TeacherDeadlineItem {
  return {
    id: "asm_1",
    title: "Linear Equations Check-in",
    kind: "QUIZ",
    dueDate: "2026-09-28T08:00:00.000Z",
    maxMarks: 20,
    courseCode: "DEMO-MATH-101",
    released: true,
    releasedAt: "2026-09-14T08:00:00.000Z",
    submitted: 10,
    graded: 6,
    ...overrides,
  }
}

function suggestion(confidence: number): AiGradeSuggestionResponse {
  return {
    id: `sug_${confidence}`,
    assessmentId: "asm_1",
    studentId: "stu_1",
    criterionLabel: "Accuracy",
    suggestedPoints: 7,
    maxPoints: 10,
    rationale: "Worked the method correctly.",
    evidence: null,
    confidence,
    model: "test-model",
    promptVersion: "v1",
    latencyMs: 120,
    createdAt: "2026-09-20T08:00:00.000Z",
  }
}

function review(
  overrides: {
    assessmentId?: string
    studentId?: string
    flags?: string[]
    confidences?: number[]
    status?: GradeReviewResponse["status"]
  } = {},
): ReviewQueueItem {
  const assessmentId = overrides.assessmentId ?? "asm_1"
  const studentId = overrides.studentId ?? "stu_1"
  return {
    submission: {
      id: "sub_1",
      status: "SUBMITTED",
      contentText: null,
      submittedAt: "2026-09-20T08:00:00.000Z",
    },
    student: {
      id: studentId,
      fullName: "Aarav Sharma",
      registerNumber: "R001",
      email: "aarav@example.test",
    },
    assessment: {
      id: assessmentId,
      title: "Linear Equations Check-in",
      maxMarks: 20,
      courseCode: "DEMO-MATH-101",
      courseName: "Mathematics",
      className: "Grade 10 A",
    },
    review: {
      id: "rev_1",
      assessmentId,
      studentId,
      status: overrides.status ?? "NEEDS_REVIEW",
      reviewerId: null,
      notes: null,
      decidedAt: null,
      createdAt: "2026-09-20T08:00:00.000Z",
      updatedAt: "2026-09-20T08:00:00.000Z",
    },
    grade: null,
    suggestions: (overrides.confidences ?? [0.82]).map(suggestion),
    flags: overrides.flags ?? [],
  }
}

function atRiskStudent(
  studentId: string,
  group: AtRiskStudentValue["group"],
  grandTotal: number | null,
): AtRiskStudentValue {
  return {
    studentId,
    fullName: `Student ${studentId}`,
    registerNumber: studentId,
    grandTotal,
    group,
  }
}

describe("cohortAverageFromAssessments", () => {
  it("weights each assessment's mean by how many students it marked", () => {
    // (80 * 2 + 90 * 1) / 3 = 83.33. An unweighted mean would say 85 and let a
    // two-attempt quiz move the tile as much as a forty-attempt one.
    expect(
      cohortAverageFromAssessments([
        { average: 80, attemptCount: 2 },
        { average: 90, attemptCount: 1 },
      ]),
    ).toBeCloseTo(83.33, 2)
  })

  it("ignores assessments with no mean", () => {
    expect(
      cohortAverageFromAssessments([
        { average: null, attemptCount: 5 },
        { average: 50, attemptCount: 1 },
      ]),
    ).toBe(50)
  })

  it("returns null rather than zero when nothing has been marked", () => {
    expect(cohortAverageFromAssessments([])).toBeNull()
    expect(cohortAverageFromAssessments([{ average: null, attemptCount: 0 }])).toBeNull()
    expect(cohortAverageFromAssessments([{ average: 70, attemptCount: 0 }])).toBeNull()
  })
})

describe("reviewQueueForOffering", () => {
  const items = [
    review({ assessmentId: "asm_1", studentId: "stu_1" }),
    review({ assessmentId: "asm_2", studentId: "stu_2" }),
    review({ assessmentId: "asm_1", studentId: "stu_3" }),
  ]

  it("keeps only rows whose assessment is in the offering", () => {
    expect(reviewQueueForOffering(items, ["asm_1", "asm_9"]).map((row) => row.student.id)).toEqual([
      "stu_1",
      "stu_3",
    ])
  })

  it("returns nothing when the offering has no assessments", () => {
    expect(reviewQueueForOffering(items, [])).toEqual([])
  })
})

describe("lowestConfidence", () => {
  it("reports the weakest suggestion, not the strongest", () => {
    // The row is in the queue because one criterion fell below the floor; the
    // minimum is the number that explains it.
    expect(lowestConfidence([suggestion(0.9), suggestion(0.62), suggestion(0.81)])).toBe(0.62)
  })

  it("returns null when there are no suggestions", () => {
    expect(lowestConfidence([])).toBeNull()
  })
})

describe("attentionForOffering", () => {
  const items = [
    review({ assessmentId: "asm_1", studentId: "stu_1" }),
    review({ assessmentId: "asm_1", studentId: "stu_2" }),
    review({ assessmentId: "asm_2", studentId: "stu_3" }),
  ]

  it("limits the rows but reports the full total", () => {
    expect(attentionForOffering(items, ["asm_1"], 1)).toMatchObject({ total: 2 })
    expect(attentionForOffering(items, ["asm_1"], 1).rows.map((row) => row.student.id)).toEqual([
      "stu_1",
    ])
  })

  it("keeps the reader's order rather than inventing a priority score", () => {
    const rows = attentionForOffering(items, ["asm_1"], 5).rows
    expect(rows.map((row) => row.student.id)).toEqual(["stu_1", "stu_2"])
  })
})

describe("atRiskCounts", () => {
  it("separates the judged from the unjudged", () => {
    const counts = atRiskCounts([
      atRiskStudent("stu_1", "below-boundary", 42),
      atRiskStudent("stu_2", "below-boundary", 48),
      atRiskStudent("stu_3", "no-published-work", null),
    ])
    // A student with no released mark is not "at risk" on evidence; the split keeps
    // the tile's hint honest about both groups.
    expect(counts).toEqual({ belowBoundary: 2, noPublishedWork: 1, total: 3 })
  })

  it("reports zeroes, not nulls, for an empty roster", () => {
    expect(atRiskCounts([])).toEqual({ belowBoundary: 0, noPublishedWork: 0, total: 0 })
  })
})

describe("buildAssessmentProgressRows", () => {
  it("joins the analytics summary to the deadline facts by id", () => {
    const rows = buildAssessmentProgressRows(
      [assessment({ id: "asm_1", average: 74, attemptCount: 12 })],
      [deadline({ id: "asm_1", submitted: 10, graded: 6, released: true })],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: "asm_1",
      kind: "QUIZ",
      averagePercent: 74,
      submitted: 10,
      graded: 6,
      released: true,
    })
  })

  it("keeps the overview's order, which is the offering's own list", () => {
    const rows = buildAssessmentProgressRows(
      [assessment({ id: "asm_2" }), assessment({ id: "asm_1" })],
      [deadline({ id: "asm_1" }), deadline({ id: "asm_2" })],
    )
    expect(rows.map((row) => row.id)).toEqual(["asm_2", "asm_1"])
  })

  it("leaves the deadline side null when it is missing rather than zero-filling", () => {
    // Defensive: the ownership rules should make this unreachable, but "we did not
    // read it" must never render as "nothing was submitted".
    const rows = buildAssessmentProgressRows([assessment({ id: "asm_1" })], [])
    expect(rows[0]).toMatchObject({ kind: null, submitted: null, graded: null, released: null })
  })

  it("derives release from the deadline row rather than a separate flag", () => {
    const rows = buildAssessmentProgressRows(
      [assessment({ id: "asm_1" })],
      [deadline({ id: "asm_1", released: false })],
    )
    expect(rows[0].released).toBe(false)
  })
})

describe("cohortTrendPoints / hasTrendData", () => {
  const series = {
    weeks: 3,
    startsOn: "2026-09-01T00:00:00.000Z",
    endsOn: "2026-09-22T00:00:00.000Z",
    points: [
      { week: 1, average: 68, count: 2 },
      { week: 2, average: null, count: 0 },
      { week: 3, average: 72, count: 3 },
    ],
  }

  it("labels each point by teaching week", () => {
    expect(cohortTrendPoints(series)).toEqual([
      { label: "W1", value: 68 },
      { label: "W2", value: null },
      { label: "W3", value: 72 },
    ])
  })

  it("returns no points for a missing series", () => {
    expect(cohortTrendPoints(null)).toEqual([])
    expect(hasTrendData(null)).toBe(false)
  })

  it("treats an all-null series as undrawable rather than an empty axis", () => {
    expect(
      hasTrendData({
        ...series,
        points: [
          { week: 1, average: null, count: 0 },
          { week: 2, average: null, count: 0 },
        ],
      }),
    ).toBe(false)
    expect(hasTrendData(series)).toBe(true)
  })
})

describe("teacherDashboardKpis", () => {
  const base = {
    offeringLabel: "DEMO-MATH-101 · Grade 10 A · Semester 1",
    enrolledCount: 34,
    assessments: [assessment({ average: 74, attemptCount: 12 })],
    awaitingReview: 3,
    atRisk: [
      atRiskStudent("stu_1", "below-boundary", 42),
      atRiskStudent("stu_2", "no-published-work", null),
    ],
  }

  it("reports the four tiles from real values", () => {
    const kpis = teacherDashboardKpis(base)
    expect(kpis.map((kpi) => kpi.id)).toEqual([
      "enrolled",
      "cohort-average",
      "awaiting-review",
      "at-risk",
    ])
    expect(kpis[0]).toMatchObject({ value: "34", hint: base.offeringLabel })
    expect(kpis[1].value).toBe("74%")
    expect(kpis[2].value).toBe("3")
    expect(kpis[3].value).toBe("2")
  })

  it("shows an em dash for the cohort average when nothing is marked", () => {
    // Never "0%": an unmarked cohort and a cohort that scored nothing are different.
    const kpis = teacherDashboardKpis({
      ...base,
      assessments: [{ average: null, attemptCount: 0 }],
    })
    expect(kpis[1].value).toBe("—")
    expect(kpis[1].hint).toBe("No released marks yet")
  })

  it("names both at-risk groups in the hint", () => {
    expect(teacherDashboardKpis(base)[3].hint).toBe(
      "1 below the pass line · 1 with no published work",
    )
  })

  it("carries no sparkline or delta field at all", () => {
    // The mockup's sparkline and delta cannot be derived; the shape must not offer
    // a slot a future edit could fill with an invented series.
    const kpi = teacherDashboardKpis(base)[0] as Record<string, unknown>
    expect(kpi.sparkline).toBeUndefined()
    expect(kpi.delta).toBeUndefined()
  })
})

describe("markingProgress", () => {
  it("counts marks against the cohort, not against submissions (TN-2)", () => {
    // The seed's DSA sets have nine Grade rows and zero Submission rows: a manual mark
    // with no submission is legitimate. `graded / submitted` produced "9 / 0 ... 100%".
    expect(markingProgress({ graded: 9, submitted: 0, enrolled: 9 })).toEqual({
      graded: 9,
      markable: 9,
      valueText: "9 / 9",
      complete: true,
    })
  })

  it("never lets the denominator fall below the mark count", () => {
    // A mark recorded for a student outside the enrolled count still renders a bar that
    // fits, rather than one over 100%.
    const progress = markingProgress({ graded: 12, submitted: 4, enrolled: 9 })
    expect(progress.markable).toBe(12)
    expect(progress.complete).toBe(true)
  })

  it("uses the larger of submissions and enrolment when nothing is marked", () => {
    expect(markingProgress({ graded: 0, submitted: 5, enrolled: 9 })).toEqual({
      graded: 0,
      markable: 9,
      valueText: "0 / 9",
      complete: false,
    })
  })

  it("does not call a zero-mark, zero-cohort row complete", () => {
    const progress = markingProgress({ graded: 0, submitted: 0, enrolled: 0 })
    expect(progress.complete).toBe(false)
    expect(progress.markable).toBe(0)
  })
})
