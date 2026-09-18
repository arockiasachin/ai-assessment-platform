import { describe, expect, it } from "vitest"

import {
  buildAssessmentComparisons,
  buildTopicMastery,
  chartLabel,
  classAverageChartData,
  distributionChartData,
  focusDistribution,
  positionLetter,
  publishedScoresByAssessment,
  visibleComparisons,
  type ComparisonAssessmentInput,
} from "@/lib/student-analytics-view"
import { buildCohortDistribution } from "@/lib/analytics/cohort"
import { ABSOLUTE_PASS_MARK, type RegimeDecision } from "@/lib/analytics/grading-bands"

/**
 * The pure shaping behind `/student/analytics`.
 *
 * These are the rules that decide what a number *is*: when an average may be disclosed, what a
 * missing mark renders as, which letter a percentage falls in, and how a topic's mastery is
 * counted. They are tested here because a rule left in the component has no test at all.
 */

const MIN_COHORT = 3

function comparison(overrides: Partial<ComparisonAssessmentInput> = {}): ComparisonAssessmentInput {
  return {
    id: "a1",
    title: "Assessment",
    dueDate: "2026-09-01T00:00:00.000Z",
    maxMarks: 100,
    scores: [],
    yourPercentage: null,
    yourMarkState: "none",
    ...overrides,
  }
}

describe("publishedScoresByAssessment", () => {
  it("keeps one score per student and drops rows that cannot make a percentage", () => {
    const byAssessment = publishedScoresByAssessment([
      { assessmentId: "a1", studentId: "s1", points: 80, maxPoints: 100 },
      { assessmentId: "a1", studentId: "s2", points: 9, maxPoints: 10 },
      // A zero max is not a mark; it must not enter as 0.
      { assessmentId: "a1", studentId: "s3", points: 5, maxPoints: 0 },
      // Non-finite is a corrupt row, not a zero.
      { assessmentId: "a1", studentId: "s4", points: Number.NaN, maxPoints: 100 },
      { assessmentId: "a2", studentId: "s1", points: 0, maxPoints: 20 },
    ])

    expect(byAssessment.get("a1")).toEqual([
      { studentId: "s1", percentage: 80 },
      { studentId: "s2", percentage: 90 },
    ])
    // A real released zero is a mark, and counts.
    expect(byAssessment.get("a2")).toEqual([{ studentId: "s1", percentage: 0 }])
  })

  it("returns no entry for an assessment with no usable row", () => {
    const byAssessment = publishedScoresByAssessment([
      { assessmentId: "a1", studentId: "s1", points: 1, maxPoints: 0 },
    ])
    expect(byAssessment.has("a1")).toBe(false)
  })
})

describe("buildAssessmentComparisons", () => {
  const scores = [
    { studentId: "s1", percentage: 80 },
    { studentId: "s2", percentage: 90 },
    { studentId: "s3", percentage: 100 },
  ]

  it("discloses the average at exactly the disclosure floor", () => {
    const [row] = buildAssessmentComparisons(
      [comparison({ scores, yourPercentage: 80, yourMarkState: "released" })],
      MIN_COHORT,
    )
    expect(row.classAverage).toBe(90)
    expect(row.classAverageWithheld).toBe(false)
    expect(row.difference).toBe(-10)
  })

  it("withholds an invertible average below the floor instead of showing it", () => {
    const [row] = buildAssessmentComparisons(
      [
        comparison({
          scores: [
            { studentId: "s1", percentage: 80 },
            { studentId: "s2", percentage: 60 },
          ],
          yourPercentage: 80,
          yourMarkState: "released",
        }),
      ],
      MIN_COHORT,
    )
    expect(row.classAverage).toBeNull()
    expect(row.classAverageWithheld).toBe(true)
    // No average means no difference — never `0`.
    expect(row.difference).toBeNull()
    // The buckets and count are still there, so the page can explain why.
    expect(row.cohort.count).toBe(2)
  })

  it("leaves the average unwithheld-but-null when there is nothing released", () => {
    const [row] = buildAssessmentComparisons(
      [comparison({ yourMarkState: "withheld" })],
      MIN_COHORT,
    )
    expect(row.classAverage).toBeNull()
    expect(row.classAverageWithheld).toBe(false)
    expect(row.yourMarkState).toBe("withheld")
  })

  it("computes no difference when the student's own mark is absent", () => {
    const [row] = buildAssessmentComparisons(
      [comparison({ scores, yourMarkState: "none" })],
      MIN_COHORT,
    )
    expect(row.classAverage).toBe(90)
    expect(row.difference).toBeNull()
  })
})

describe("visibleComparisons", () => {
  it("keeps a row with a cohort or a personal mark, and drops an entirely empty one", () => {
    const rows = buildAssessmentComparisons(
      [
        comparison({ id: "cohort-only", scores: [{ studentId: "s1", percentage: 70 }] }),
        comparison({ id: "mark-only", yourPercentage: 55, yourMarkState: "released" }),
        comparison({ id: "withheld", yourMarkState: "withheld" }),
        comparison({ id: "empty" }),
      ],
      MIN_COHORT,
    )

    expect(visibleComparisons(rows).map((row) => row.assessmentId)).toEqual([
      "cohort-only",
      "mark-only",
      "withheld",
    ])
  })
})

describe("classAverageChartData", () => {
  it("charts only disclosed averages, with a bounded label", () => {
    const rows = buildAssessmentComparisons(
      [
        comparison({
          id: "shown",
          title: "A very long assessment name",
          scores: [
            { studentId: "s1", percentage: 70 },
            { studentId: "s2", percentage: 80 },
            { studentId: "s3", percentage: 90 },
          ],
        }),
        comparison({
          id: "withheld",
          title: "Short",
          scores: [{ studentId: "s1", percentage: 5 }],
        }),
      ],
      MIN_COHORT,
    )

    expect(classAverageChartData(rows)).toEqual([{ label: "A very long …", value: 80 }])
    expect(chartLabel("Short")).toBe("Short")
  })
})

describe("focusDistribution", () => {
  const rows = buildAssessmentComparisons(
    [
      comparison({
        id: "old",
        dueDate: "2026-08-01T00:00:00.000Z",
        scores: [
          { studentId: "s1", percentage: 60 },
          { studentId: "s2", percentage: 70 },
          { studentId: "s3", percentage: 80 },
        ],
        yourPercentage: 60,
        yourMarkState: "released",
      }),
      comparison({
        id: "recent",
        dueDate: "2026-09-01T00:00:00.000Z",
        scores: [
          { studentId: "s1", percentage: 60 },
          { studentId: "s2", percentage: 70 },
          { studentId: "s3", percentage: 80 },
        ],
        yourPercentage: 80,
        yourMarkState: "released",
      }),
      // Most recent, but the student has no released mark — no position to show.
      comparison({
        id: "no-mark",
        dueDate: "2026-10-01T00:00:00.000Z",
        scores: [
          { studentId: "s1", percentage: 60 },
          { studentId: "s2", percentage: 70 },
          { studentId: "s3", percentage: 80 },
        ],
        yourMarkState: "withheld",
      }),
    ],
    MIN_COHORT,
  )

  it("picks the most recent assessment with both an average and a personal mark", () => {
    expect(focusDistribution(rows)?.assessmentId).toBe("recent")
  })

  it("returns null when nothing has both sides", () => {
    const none = buildAssessmentComparisons(
      [comparison({ scores: [{ studentId: "s1", percentage: 90 }] })],
      MIN_COHORT,
    )
    expect(focusDistribution(none)).toBeNull()
  })
})

describe("positionLetter", () => {
  const absolute = (): RegimeDecision => ({
    regime: "absolute",
    reason: "non-theory-course",
    notice: { tone: "info", title: "Absolute", detail: "Absolute bands apply." },
  })
  const relative = (mean: number, standardDeviation: number): RegimeDecision => ({
    regime: "relative",
    mean,
    standardDeviation,
    markedCount: 11,
  })

  it("uses VIT's absolute Table-6 bands when the course is absolute", () => {
    const decision = absolute()
    expect(positionLetter(90, decision)).toBe("S")
    expect(positionLetter(82, decision)).toBe("A")
    expect(positionLetter(51, decision)).toBe("E")
    expect(positionLetter(49, decision)).toBe("F")
    expect(positionLetter(ABSOLUTE_PASS_MARK, decision)).toBe("E")
  })

  it("uses the class's own mean ± kσ bands when the course is relative", () => {
    // mean 70, sd 10 → S ≥ 85, A ≥ 75, B ≥ 65, C ≥ 60, D ≥ 55, E ≥ 50, F below.
    const decision = relative(70, 10)
    expect(positionLetter(90, decision)).toBe("S")
    expect(positionLetter(72, decision)).toBe("B")
    expect(positionLetter(48, decision)).toBe("F")
  })

  it("states no letter rather than a defaulted one when the bands cannot be computed", () => {
    expect(positionLetter(70, relative(70, 0))).toBeNull()
    // S boundary 95 + 1.5×10 = 110 > 100 → the rank rule applies, which this cannot do.
    expect(positionLetter(70, relative(95, 10))).toBeNull()
    expect(positionLetter(null, absolute())).toBeNull()
  })
})

describe("buildTopicMastery", () => {
  it("counts the retake selector's failed and unanswered questions as not mastered", () => {
    const breakdown = buildTopicMastery({
      assessments: [
        {
          questions: [
            { id: "q1", subtopic: "slope" },
            { id: "q2", subtopic: "slope" },
            { id: "q3", subtopic: "systems" },
            { id: "q4", subtopic: null },
          ],
          responses: [
            { questionId: "q1", isCorrect: true },
            { questionId: "q2", isCorrect: false },
            // q3 was never answered.
          ],
        },
      ],
    })

    // Weakest first: systems (0%) before slope (50%).
    expect(breakdown.topics).toEqual([
      { topic: "systems", totalQuestions: 1, notMasteredCount: 1, mastery: 0 },
      { topic: "slope", totalQuestions: 2, notMasteredCount: 1, mastery: 50 },
    ])
    expect(breakdown.untaggedQuestionCount).toBe(1)
    expect(breakdown.totalQuestions).toBe(4)
  })

  it("aggregates across a course's assessments and orders weakest first", () => {
    const breakdown = buildTopicMastery({
      assessments: [
        {
          questions: [{ id: "q1", subtopic: "arrays" }],
          responses: [{ questionId: "q1", isCorrect: true }],
        },
        {
          questions: [
            { id: "q2", subtopic: "arrays" },
            { id: "q3", subtopic: "graphs" },
          ],
          responses: [
            { questionId: "q2", isCorrect: false },
            { questionId: "q3", isCorrect: true },
          ],
        },
      ],
    })

    expect(breakdown.topics).toEqual([
      { topic: "arrays", totalQuestions: 2, notMasteredCount: 1, mastery: 50 },
      { topic: "graphs", totalQuestions: 1, notMasteredCount: 0, mastery: 100 },
    ])
  })

  it("breaks a mastery tie by tag so the order is stable", () => {
    const breakdown = buildTopicMastery({
      assessments: [
        {
          questions: [
            { id: "q1", subtopic: "zeta" },
            { id: "q2", subtopic: "alpha" },
          ],
          responses: [
            { questionId: "q1", isCorrect: true },
            { questionId: "q2", isCorrect: true },
          ],
        },
      ],
    })
    expect(breakdown.topics.map((topic) => topic.topic)).toEqual(["alpha", "zeta"])
  })

  it("returns no topics but a full untagged count when nothing is tagged", () => {
    const breakdown = buildTopicMastery({
      assessments: [
        {
          questions: [
            { id: "q1", subtopic: null },
            { id: "q2", subtopic: "   " },
          ],
          responses: [],
        },
      ],
    })
    expect(breakdown.topics).toEqual([])
    expect(breakdown.untaggedQuestionCount).toBe(2)
  })
})

describe("distributionChartData", () => {
  it("carries every absolute band, including the empty ones", () => {
    const cohort = buildCohortDistribution([
      { studentId: "s1", percentage: 82 },
      { studentId: "s2", percentage: 48 },
    ])
    const data = distributionChartData(cohort)
    expect(data.map((entry) => entry.grade)).toEqual(["S", "A", "B", "C", "D", "E", "F"])
    expect(data.find((entry) => entry.grade === "A")?.count).toBe(1)
    expect(data.find((entry) => entry.grade === "F")?.count).toBe(1)
  })
})
