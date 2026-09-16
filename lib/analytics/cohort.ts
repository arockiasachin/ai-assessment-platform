import { ABSOLUTE_BANDS, ABSOLUTE_PASS_MARK, absoluteLetter } from "./grading-bands"

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
  /** VIT's seven performance letters. `E` is the lowest passing grade. */
  grade: "S" | "A" | "B" | "C" | "D" | "E" | "F"
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

/**
 * VIT's absolute pass mark. See `ABSOLUTE_PASS_MARK` in `./grading-bands`, re-exported
 * here because this module's `passThreshold` used to be 60 — a number that appears in no
 * VIT document and would have reported a class whose students all sat between 50 and 59
 * as a 0% pass rate.
 */
export const DEFAULT_PASS_THRESHOLD = ABSOLUTE_PASS_MARK

/**
 * Buckets built from VIT's absolute Table-6 bands rather than a local `A/B/C/D/F` table.
 *
 * Two things were wrong before and are fixed by deriving them: the boundaries (the old
 * table had no `E` and put `D` at 60–69, where VIT puts `D` at 55–60 and `E` at 50–55)
 * and the count of bands (five instead of seven). Deriving from the same table the course
 * letter comes from means a histogram and a letter cannot disagree.
 */
function vitBuckets(): Omit<ScoreBucket, "count">[] {
  return ABSOLUTE_BANDS.map((band) => ({
    grade: band.letter as ScoreBucket["grade"],
    label:
      band.max === null
        ? `${band.letter} (${band.min}–100%)`
        : `${band.letter} (${band.min}–${band.max}%)`,
    min: band.min,
    max: band.max ?? 100,
  }))
}

export type CohortOptions = {
  /** A percentage at or above this counts as a pass. Defaults to VIT's 50. */
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
  const bands = vitBuckets()

  const counts = new Map<string, number>(bands.map((band) => [band.grade, 0]))
  for (const score of scores) {
    const letter = absoluteLetter(score.percentage)
    if (letter === null) continue
    counts.set(letter, (counts.get(letter) ?? 0) + 1)
  }

  const buckets = bands.map((band) => ({ ...band, count: counts.get(band.grade) ?? 0 }))
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
