/**
 * Descriptive statistics for the analytics surfaces.
 *
 * Pure and dependency-free, like `item-analysis.ts` and `cohort.ts`, so the numbers
 * that end up in front of a teacher can be tested without a database.
 *
 * Every function returns `null` for an empty input rather than `0`. That is the
 * same rule the item-analysis guard already uses ("below a minimum we return `null`
 * and say so instead of emitting a number that would be read as real"): a mean of
 * zero and an absence of data are different facts, and rendering the first where
 * the second is true is how a dashboard lies.
 */

/** Arithmetic mean, or `null` when there is nothing to average. */
export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const total = values.reduce((sum, value) => sum + value, 0)
  return total / values.length
}

/**
 * Median, or `null` when there is nothing to average.
 *
 * Sorted numerically rather than lexically — `Array.prototype.sort` with no
 * comparator compares strings, which would put `100` before `9` and silently
 * produce a wrong median for any percentage above 99. For an even count this
 * averages the two middle values.
 */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)

  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

export type StandardDeviationOptions = {
  /**
   * Divide by `n - 1` instead of `n`.
   *
   * Defaults to `false` — **population** standard deviation — because the cohorts
   * here are complete populations, not samples: the offering's enrolled students
   * *are* the group being described, so there is no sampling correction to apply.
   * Sample deviation would inflate σ slightly and move the pass boundary for a
   * reason nobody could explain.
   *
   * One caveat worth stating rather than hiding: for `n = 1` the sample form divides
   * by zero, so it returns `null` instead of `Infinity` or `NaN`.
   */
  sample?: boolean
}

/**
 * Standard deviation, or `null` for an empty input (and for `n = 1` in sample mode).
 *
 * `n = 1` in **population** mode returns `0`, which is arithmetically right: a lone
 * value does not vary. It is the caller's business to decide whether a cohort of one
 * is worth reporting at all — which is what the sample-size minimums are for.
 */
export function standardDeviation(
  values: readonly number[],
  options: StandardDeviationOptions = {},
): number | null {
  if (values.length === 0) return null
  const sample = options.sample ?? false
  if (sample && values.length < 2) return null

  const average = mean(values)
  if (average === null) return null

  const sumSquares = values.reduce((sum, value) => sum + (value - average) ** 2, 0)
  return Math.sqrt(sumSquares / (sample ? values.length - 1 : values.length))
}

/**
 * The institution's pass boundary: `mean − 2σ`, floored at 50.
 *
 * This is VIT's own `F`/`E` line, not an invented threshold, and the floor is part
 * of the same regulation: for a high-averaging class, `mean − 2σ` can fall below 50,
 * and a student above 50 must still pass. Without the floor, a strong cohort would
 * be told its weakest members were failing when the institution would pass them.
 *
 * Returns `null` when there is nothing to compute a boundary from. A caller that
 * needs a threshold with no cohort should say so rather than default to something —
 * see `PASS_FLOOR` for that case.
 */
export function passBoundary(percentages: readonly number[]): number | null {
  const average = mean(percentages)
  const deviation = standardDeviation(percentages)
  if (average === null || deviation === null) return null

  return quantise(Math.max(average - 2 * deviation, PASS_FLOOR))
}

/**
 * The floor in `max(mean − 2σ, 50)`. Exported so a reader can see the constant
 * rather than inferring it from a magic number inside the formula, and so a caller
 * that has no cohort can reach for the floor deliberately.
 */
export const PASS_FLOOR = 50

/** Two decimal places, matching `averagePercentage` in `cohort.ts`. */
function quantise(value: number): number {
  return Math.round(value * 100) / 100
}

export type GradeSpread = {
  count: number
  mean: number | null
  median: number | null
  standardDeviation: number | null
  /** `max(mean − 2σ, 50)`, or `null` without a cohort. */
  passBoundary: number | null
  highest: number | null
  lowest: number | null
}

/**
 * Mean, median, σ and the pass boundary in one pass, for the tiles that show them
 * together.
 *
 * Median sits next to mean deliberately: the institution grades on mean and σ, and a
 * median that disagrees with the mean tells a teacher that a single script is
 * distorting the cohort — which is the thing a bare mean hides.
 */
export function summariseSpread(percentages: readonly number[]): GradeSpread {
  if (percentages.length === 0) {
    return {
      count: 0,
      mean: null,
      median: null,
      standardDeviation: null,
      passBoundary: null,
      highest: null,
      lowest: null,
    }
  }

  const average = mean(percentages)
  const middle = median(percentages)
  const deviation = standardDeviation(percentages)

  return {
    count: percentages.length,
    mean: average === null ? null : quantise(average),
    median: middle === null ? null : quantise(middle),
    standardDeviation: deviation === null ? null : quantise(deviation),
    passBoundary: passBoundary(percentages),
    highest: Math.max(...percentages),
    lowest: Math.min(...percentages),
  }
}
