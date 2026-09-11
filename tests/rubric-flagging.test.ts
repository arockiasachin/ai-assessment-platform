import { describe, expect, it } from "vitest"

import {
  collectFlagReasons,
  computeCohortStats,
  isLowConfidence,
  isStatisticalOutlier,
  lowConfidenceReasons,
} from "@/lib/rubric-grading/flagging"

/**
 * Confidence and statistical-outlier flagging. Both signals only choose
 * `NEEDS_REVIEW`; they never publish or reject anything.
 */

describe("confidence flagging", () => {
  it("treats low or non-finite confidence as flaggable", () => {
    expect(isLowConfidence(0.59)).toBe(true)
    expect(isLowConfidence(0.6)).toBe(false)
    expect(isLowConfidence(0.95)).toBe(false)
    expect(isLowConfidence(Number.NaN)).toBe(true)
  })

  it("names the low-confidence criteria", () => {
    const reasons = lowConfidenceReasons([
      { criterionLabel: "Argument", confidence: 0.4 },
      { criterionLabel: "Evidence", confidence: 0.9 },
    ])
    expect(reasons).toEqual(['Low confidence (0.40) on "Argument".'])
  })
})

describe("cohort statistics", () => {
  it("computes population mean and standard deviation", () => {
    const stats = computeCohortStats([2, 4, 4, 4, 5, 5, 7, 9])
    expect(stats.count).toBe(8)
    expect(stats.mean).toBeCloseTo(5)
    expect(stats.stdDev).toBeCloseTo(2)
  })

  it("returns zeros for an empty cohort", () => {
    expect(computeCohortStats([])).toEqual({ count: 0, mean: 0, stdDev: 0 })
  })
})

describe("statistical outlier detection", () => {
  it("flags a value more than two standard deviations from the mean", () => {
    const cohort = [8, 9, 9, 10, 10, 10, 11, 11, 12]
    expect(isStatisticalOutlier(0, cohort)).toBe(true)
    expect(isStatisticalOutlier(10, cohort)).toBe(false)
  })

  it("does not flag when the cohort is too small to be meaningful", () => {
    expect(isStatisticalOutlier(100, [1, 2, 3], { minSampleSize: 5 })).toBe(false)
  })

  it("treats a different value as an outlier in a zero-variance cohort", () => {
    const cohort = [10, 10, 10, 10, 10]
    expect(isStatisticalOutlier(10, cohort)).toBe(false)
    expect(isStatisticalOutlier(0, cohort)).toBe(true)
  })
})

describe("collectFlagReasons", () => {
  it("combines low confidence, ceiling clamps, unverified evidence, and outliers", () => {
    const reasons = collectFlagReasons({
      evaluations: [
        {
          criterionLabel: "Argument",
          confidence: 0.4,
          clampedToCeiling: true,
          evidenceVerified: false,
        },
      ],
      totalPoints: 0,
      cohortPoints: [10, 10, 10, 10, 10],
    })

    expect(reasons.some((reason) => reason.includes("Low confidence"))).toBe(true)
    expect(reasons.some((reason) => reason.includes("criterion ceiling"))).toBe(true)
    expect(reasons.some((reason) => reason.includes("could not be matched"))).toBe(true)
    expect(reasons.some((reason) => reason.includes("statistical outlier"))).toBe(true)
  })

  it("returns no reasons for a clean, in-range evaluation", () => {
    const reasons = collectFlagReasons({
      evaluations: [
        {
          criterionLabel: "Argument",
          confidence: 0.9,
          clampedToCeiling: false,
          evidenceVerified: true,
        },
      ],
      totalPoints: 8,
      cohortPoints: [7, 8, 9, 8, 8, 7],
    })
    expect(reasons).toEqual([])
  })
})
