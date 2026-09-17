import { describe, expect, it } from "vitest"

import type { StudentPeerEvaluationGroup } from "@/lib/contracts/groups"
import type { StudentAssessmentItem } from "@/lib/student-assessments"
import {
  dueLabel,
  dueThisWeek,
  outstandingAssessments,
  overallAveragePercent,
  peerRoundSummaries,
  releasedMarkCount,
  studentDashboardKpis,
  studentMarkState,
  submittedCount,
} from "@/lib/student-dashboard-view"

/**
 * The student dashboard's view logic.
 *
 * Pure and here rather than inside the component because this repo has no jsdom, and
 * because the three-state mark cell and the due labels are exactly where a wrong
 * number or a leaked unreleased mark would come from.
 */

function assessment(overrides: Partial<StudentAssessmentItem> = {}): StudentAssessmentItem {
  return {
    id: "asm_1",
    title: "Linear Equations Check-in",
    type: "QUIZ",
    dueDate: "2026-09-28T08:00:00.000Z",
    maxMarks: 20,
    courseId: "crs_1",
    courseCode: "DEMO-MATH-101",
    courseName: "Mathematics",
    className: "Grade 10 A",
    term: "Semester 1",
    academicYear: 2026,
    teacherName: "Priya Nair",
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
    daysUntilDue: 3,
    isPastDue: false,
    ...overrides,
  }
}

function group(overrides: Partial<StudentPeerEvaluationGroup> = {}): StudentPeerEvaluationGroup {
  return {
    groupId: "grp_1",
    groupName: "Matrices",
    projectTitle: "Data storytelling",
    offeringId: "off_1",
    courseCode: "DEMO-MATH-101",
    courseName: "Mathematics",
    teammates: [
      { studentId: "stu_1", fullName: "Aarav Sharma", registerNumber: "R001", isSelf: true },
      { studentId: "stu_2", fullName: "Bela Rao", registerNumber: "R002", isSelf: false },
    ],
    myEvaluations: [],
    selfEvaluationSubmitted: false,
    expectedEvaluations: 2,
    submittedEvaluations: 1,
    received: {
      withheld: true,
      ratingCount: 0,
      minRatersRequired: 3,
      reason: "Results are shown only after at least 3 teammates have submitted.",
    },
    ...overrides,
  }
}

describe("overallAveragePercent / releasedMarkCount", () => {
  it("averages only released percentages", () => {
    expect(
      overallAveragePercent([
        assessment({ percentage: 80 }),
        assessment({ percentage: null }),
        assessment({ percentage: 90 }),
      ]),
    ).toBe(85)
    expect(
      releasedMarkCount([assessment({ percentage: 80 }), assessment({ percentage: null })]),
    ).toBe(1)
  })

  it("returns null rather than zero when nothing has been released", () => {
    expect(overallAveragePercent([assessment({ percentage: null })])).toBeNull()
    expect(overallAveragePercent([])).toBeNull()
  })
})

describe("submittedCount", () => {
  it("counts handed-in work and does not count a saved draft", () => {
    // A draft has no `submittedAt`, which is what separates "started" from "submitted".
    expect(
      submittedCount([
        assessment({ submittedAt: "2026-09-20T08:00:00.000Z" }),
        assessment({ submissionState: "draft", submittedAt: null }),
        assessment({ submittedAt: null }),
      ]),
    ).toBe(1)
  })
})

describe("outstandingAssessments", () => {
  it("keeps only unsubmitted work, soonest first, without mutating the input", () => {
    const input = [
      assessment({ id: "late", dueDate: "2026-10-01T08:00:00.000Z" }),
      assessment({ id: "soon", dueDate: "2026-09-20T08:00:00.000Z" }),
      assessment({ id: "done", submittedAt: "2026-09-19T08:00:00.000Z" }),
    ]
    expect(outstandingAssessments(input).map((row) => row.id)).toEqual(["soon", "late"])
    expect(input.map((row) => row.id)).toEqual(["late", "soon", "done"])
  })

  it("leaves out an assessment the teacher already marked, released or withheld (SN-9)", () => {
    // A manual `Grade` with no `Submission` row is legitimate, so `submittedAt` alone put a
    // marked row into a "still have to submit" table badged "Not submitted" beside its own
    // released score.
    const marked = assessment({
      id: "marked",
      percentage: 90,
      hasMark: true,
      published: true,
    })
    const withheld = assessment({ id: "withheld", hasMark: true, published: false })

    expect(outstandingAssessments([marked, withheld])).toEqual([])
    expect(submittedCount([marked, withheld])).toBe(2)
    expect(dueThisWeek([assessment({ ...marked, daysUntilDue: 2 })])).toEqual([])
  })
})

describe("dueThisWeek", () => {
  it("includes unsubmitted work due today through the window", () => {
    const rows = [
      assessment({ id: "today", daysUntilDue: 0 }),
      assessment({ id: "edge", daysUntilDue: 7 }),
      assessment({ id: "later", daysUntilDue: 8 }),
      assessment({ id: "overdue", daysUntilDue: -2, isPastDue: true }),
      assessment({ id: "done", daysUntilDue: 2, submittedAt: "2026-09-19T08:00:00.000Z" }),
    ]
    expect(dueThisWeek(rows).map((row) => row.id)).toEqual(["today", "edge"])
  })

  it("takes the window as a parameter so the rule is testable", () => {
    expect(dueThisWeek([assessment({ daysUntilDue: 14 })], 14)).toHaveLength(1)
  })
})

describe("dueLabel", () => {
  it("says today and tomorrow rather than 'in 0 days'", () => {
    expect(dueLabel(assessment({ daysUntilDue: 0 }))).toBe("Due today")
    expect(dueLabel(assessment({ daysUntilDue: 1 }))).toBe("Due tomorrow")
    expect(dueLabel(assessment({ daysUntilDue: 4 }))).toBe("Due in 4 days")
  })

  it("says '1 day overdue', not '1 days overdue'", () => {
    expect(dueLabel(assessment({ daysUntilDue: -1, isPastDue: true }))).toBe("1 day overdue")
    expect(dueLabel(assessment({ daysUntilDue: -3, isPastDue: true }))).toBe("3 days overdue")
  })
})

describe("studentMarkState", () => {
  it("marks a released result as released", () => {
    expect(studentMarkState(assessment({ percentage: 80, hasMark: true, published: true }))).toBe(
      "released",
    )
  })

  it("withholds a marked-but-unreleased result instead of showing its value", () => {
    // The value is not in the payload at all, but the state must still be distinct
    // from "not marked" so the cell can say so.
    expect(studentMarkState(assessment({ hasMark: true, published: false }))).toBe("withheld")
  })

  it("reports no mark when nothing has been recorded", () => {
    expect(studentMarkState(assessment())).toBe("none")
  })
})

describe("peerRoundSummaries", () => {
  it("derives outstanding from the workspace's own counts", () => {
    const [round] = peerRoundSummaries([group()])
    expect(round).toMatchObject({ expected: 2, submitted: 1, outstanding: 1 })
  })

  it("describes a withheld aggregate by rater count, not as a missing value", () => {
    const [round] = peerRoundSummaries([group()])
    expect(round.resultsLabel).toBe("Withheld — 0 of 3 teammates have rated")
  })

  it("describes a disclosed aggregate as an overall score", () => {
    const [round] = peerRoundSummaries([
      group({
        received: {
          withheld: false,
          dimensionAverages: {
            contributing: 4,
            interacting: 4,
            keepingOnTrack: 4,
            expectingQuality: 4,
            knowledgeSkillsAbilities: 4,
          },
          overallAverage: 4.25,
          ratingCount: 3,
          minRatersRequired: 3,
        },
      }),
    ])
    expect(round.resultsLabel).toBe("Overall 4.3 / 5 from 3 ratings")
  })

  it("never reports a negative outstanding count", () => {
    const [round] = peerRoundSummaries([group({ submittedEvaluations: 3 })])
    expect(round.outstanding).toBe(0)
  })
})

describe("studentDashboardKpis", () => {
  const assessments = [
    assessment({
      id: "a",
      title: "Quiz 1",
      percentage: 80,
      hasMark: true,
      published: true,
      submittedAt: "2026-09-10T08:00:00.000Z",
    }),
    assessment({
      id: "b",
      title: "Quiz 2",
      percentage: 90,
      hasMark: true,
      published: true,
      submittedAt: "2026-09-12T08:00:00.000Z",
    }),
    assessment({ id: "c", title: "Essay", daysUntilDue: 2 }),
    assessment({ id: "d", title: "Project", submittedAt: "2026-09-19T08:00:00.000Z" }),
  ]

  it("reports the four tiles from real values", () => {
    const kpis = studentDashboardKpis({ assessments, groups: [group()] })
    expect(kpis.map((kpi) => kpi.id)).toEqual(["overall", "due-this-week", "submitted", "peer"])
    expect(kpis[0]).toMatchObject({ value: "85%", hint: "Across 2 released assessments" })
    expect(kpis[1]).toMatchObject({ value: "1", hint: "Essay" })
    expect(kpis[2]).toMatchObject({ value: "3 of 4", hint: "1 still to hand in" })
    expect(kpis[3]).toMatchObject({ value: "1 to do", hint: "1 of 2 · Matrices" })
  })

  it("shows an em dash for the overall average when nothing is released", () => {
    const kpis = studentDashboardKpis({ assessments: [], groups: [] })
    expect(kpis[0]).toMatchObject({ value: "—", hint: "No marks released yet" })
  })

  it("says there is no peer round rather than claiming everything is submitted", () => {
    const kpis = studentDashboardKpis({ assessments, groups: [] })
    expect(kpis[3]).toMatchObject({ value: "—", hint: "No peer evaluation round" })
  })

  it("aggregates across several groups", () => {
    const kpis = studentDashboardKpis({
      assessments,
      groups: [group(), group({ groupId: "grp_2", groupName: "Vectors" })],
    })
    expect(kpis[3]).toMatchObject({ value: "2 to do", hint: "2 of 4 across 2 groups" })
  })

  it("carries no sparkline or delta field at all", () => {
    const kpi = studentDashboardKpis({ assessments, groups: [] })[0] as Record<string, unknown>
    expect(kpi.sparkline).toBeUndefined()
    expect(kpi.delta).toBeUndefined()
  })
})
