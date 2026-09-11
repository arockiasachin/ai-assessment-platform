import { letterGrade } from "@/lib/gradebook"

/**
 * Cohort/distribution views for a quiz assessment, computed from real attempts.
 *
 * This complements the mark-map helpers in `./legacy`: those read the
 * gradebook's `MarksMap`, these read a list of per-student percentages (built
 * from `QuizAttempt` rows). The letter bands come from the same
 * `letterGrade` function the gradebook uses, so an A here is an A there.
 */

export type CohortScore = {
  studentId: string
  /** Percentage in `[0, 100]`. */
  percentage: number
}

export type ScoreBucket = {
  grade: "A" | "B" | "C" | "D" | "F"
  label: string
  min: number
  max: number
  count: number
}

export type CohortDistribution = {
  count: number
  average: number | null
  passRate: number | null
  passThreshold: number
  highest: number | null
  lowest: number | null
  buckets: ScoreBucket[]
}

export const DEFAULT_PASS_THRESHOLD = 60

const BUCKET_BOUNDS = {
  A: { min: 90, max: 100, label: "A (90-100%)" },
  B: { min: 80, max: 89, label: "B (80-89%)" },
  C: { min: 70, max: 79, label: "C (70-79%)" },
  D: { min: 60, max: 69, label: "D (60-69%)" },
  F: { min: 0, max: 59, label: "F (<60%)" },
} as const

export type CohortOptions = {
  /** A percentage at or above this counts as a pass. Defaults to 60. */
  passThreshold?: number
}

export function averagePercentage(scores: readonly CohortScore[]): number | null {
  if (scores.length === 0) return null
  const total = scores.reduce((sum, score) => sum + score.percentage, 0)
  return Math.round((total / scores.length) * 100) / 100
}

export function percentagePassRate(
  scores: readonly CohortScore[],
  passThreshold = DEFAULT_PASS_THRESHOLD,
): number | null {
  if (scores.length === 0) return null
  const passed = scores.filter((score) => score.percentage >= passThreshold).length
  return Math.round((passed / scores.length) * 10000) / 100
}

/**
 * Build the histogram, average, pass rate, high and low for a cohort. Only
 * students with a finalized attempt should be passed in; an empty list returns
 * `null` aggregates rather than a misleading zero.
 */
export function buildCohortDistribution(
  scores: readonly CohortScore[],
  options: CohortOptions = {},
): CohortDistribution {
  const passThreshold = options.passThreshold ?? DEFAULT_PASS_THRESHOLD
  const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 }
  for (const score of scores) {
    counts[letterGrade(score.percentage) as keyof typeof counts] += 1
  }
  const buckets = (["A", "B", "C", "D", "F"] as const).map((grade) => ({
    grade,
    ...BUCKET_BOUNDS[grade],
    count: counts[grade],
  }))
  const percentages = scores.map((score) => score.percentage)
  return {
    count: scores.length,
    average: averagePercentage(scores),
    passRate: percentagePassRate(scores, passThreshold),
    passThreshold,
    highest: percentages.length > 0 ? Math.max(...percentages) : null,
    lowest: percentages.length > 0 ? Math.min(...percentages) : null,
    buckets,
  }
}
