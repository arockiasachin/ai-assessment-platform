import { describe, expect, it } from "vitest"

import { buildCohortDistribution, mergeAssessmentScorePopulation } from "@/lib/analytics/cohort"

/**
 * The per-assessment mark population for the analytics overview (TN-3 / TL-3).
 *
 * The defect: the summary was built from `QuizAttempt` rows only, so an assessment whose marks
 * are manual (`Grade` rows with no attempt — the seeded M.Tech sets) reported `attemptCount: 0`
 * and `average: null` on a page that simultaneously reported the released marks. Pure here so
 * the union rule has a test that needs no database.
 */
describe("mergeAssessmentScorePopulation", () => {
  it("counts a manual published mark with no attempt", () => {
    // The exact shape the audit found: a `Grade` and no `QuizAttempt`.
    const scores = mergeAssessmentScorePopulation({
      attemptPercentages: new Map(),
      publishedPercentages: new Map([["stu_1", 72]]),
    })
    expect(scores).toEqual([{ studentId: "stu_1", percentage: 72 }])
    expect(buildCohortDistribution(scores).average).toBe(72)
    expect(buildCohortDistribution(scores).count).toBe(1)
  })

  it("counts an attempt with no released mark", () => {
    const scores = mergeAssessmentScorePopulation({
      attemptPercentages: new Map([["stu_1", 40]]),
      publishedPercentages: new Map(),
    })
    expect(scores).toEqual([{ studentId: "stu_1", percentage: 40 }])
  })

  it("counts a student once when both exist, preferring the released mark", () => {
    // An attempt is the un-released draft behind the grade; the released mark is what the course
    // awarded, so it must be the number the summary reports.
    const scores = mergeAssessmentScorePopulation({
      attemptPercentages: new Map([["stu_1", 20]]),
      publishedPercentages: new Map([["stu_1", 80]]),
    })
    expect(scores).toHaveLength(1)
    expect(scores[0].percentage).toBe(80)
  })

  it("merges disjoint populations", () => {
    const scores = mergeAssessmentScorePopulation({
      attemptPercentages: new Map([
        ["stu_1", 10],
        ["stu_2", 20],
      ]),
      publishedPercentages: new Map([["stu_3", 30]]),
    })
    expect(scores.map((score) => score.studentId)).toEqual(["stu_1", "stu_2", "stu_3"])
  })

  it("falls back to the attempt when the grade's percentage is not finite", () => {
    // A `Grade` with a non-positive `maxPoints` produces a non-finite percentage upstream. It
    // must not erase the student's otherwise valid attempt.
    const scores = mergeAssessmentScorePopulation({
      attemptPercentages: new Map([["stu_1", 55]]),
      publishedPercentages: new Map([["stu_1", Number.NaN]]),
    })
    expect(scores).toEqual([{ studentId: "stu_1", percentage: 55 }])
  })

  it("drops a student with no usable mark at all", () => {
    const scores = mergeAssessmentScorePopulation({
      attemptPercentages: new Map([["stu_1", Number.POSITIVE_INFINITY]]),
      publishedPercentages: new Map([["stu_2", Number.NaN]]),
    })
    expect(scores).toEqual([])
  })

  it("is deterministic regardless of insertion order", () => {
    const scores = mergeAssessmentScorePopulation({
      attemptPercentages: new Map([
        ["stu_b", 50],
        ["stu_a", 60],
      ]),
      publishedPercentages: new Map(),
    })
    expect(scores.map((score) => score.studentId)).toEqual(["stu_a", "stu_b"])
  })
})
