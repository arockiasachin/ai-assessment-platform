/**
 * Flagging heuristics for AI-graded submissions.
 *
 * Two independent signals put a submission in front of a human:
 *
 * 1. **Low confidence** — any criterion the model scored below the threshold.
 * 2. **Statistical outlier** — a total that sits far from the cohort's mean.
 *
 * Both are pure so they can be tested without a database or a model. They are
 * advisory only: flagging never publishes or rejects anything, it just chooses
 * `NEEDS_REVIEW` instead of `PENDING`.
 */

export const LOW_CONFIDENCE_THRESHOLD = 0.6
export const OUTLIER_Z_THRESHOLD = 2
export const OUTLIER_MIN_SAMPLE = 5

const EPSILON = 1e-9

export type ConfidenceSignal = {
  criterionLabel: string
  confidence: number
}

export function isLowConfidence(
  confidence: number,
  threshold: number = LOW_CONFIDENCE_THRESHOLD,
): boolean {
  return !Number.isFinite(confidence) || confidence < threshold
}

export function lowConfidenceReasons(
  signals: readonly ConfidenceSignal[],
  threshold: number = LOW_CONFIDENCE_THRESHOLD,
): string[] {
  return signals
    .filter((signal) => isLowConfidence(signal.confidence, threshold))
    .map(
      (signal) => `Low confidence (${signal.confidence.toFixed(2)}) on "${signal.criterionLabel}".`,
    )
}

export type CohortStats = {
  count: number
  mean: number
  stdDev: number
}

/** Population statistics; an empty cohort is all zeros. */
export function computeCohortStats(values: readonly number[]): CohortStats {
  const finite = values.filter((value) => Number.isFinite(value))
  if (finite.length === 0) return { count: 0, mean: 0, stdDev: 0 }
  const mean = finite.reduce((total, value) => total + value, 0) / finite.length
  const variance = finite.reduce((total, value) => total + (value - mean) ** 2, 0) / finite.length
  return { count: finite.length, mean, stdDev: Math.sqrt(variance) }
}

export type OutlierOptions = {
  zThreshold?: number
  minSampleSize?: number
}

export function isStatisticalOutlier(
  value: number,
  cohort: readonly number[],
  options: OutlierOptions = {},
): boolean {
  const zThreshold = options.zThreshold ?? OUTLIER_Z_THRESHOLD
  const minSampleSize = options.minSampleSize ?? OUTLIER_MIN_SAMPLE
  const stats = computeCohortStats(cohort)
  if (stats.count < minSampleSize) return false
  if (!Number.isFinite(value)) return false

  if (stats.stdDev < EPSILON) {
    // A perfectly uniform cohort: any different value is the outlier, but the
    // value matching the cohort is not.
    return Math.abs(value - stats.mean) > EPSILON
  }

  const zScore = Math.abs(value - stats.mean) / stats.stdDev
  return zScore >= zThreshold
}

export type FlagInput = {
  evaluations: readonly {
    criterionLabel: string
    confidence: number
    clampedToCeiling: boolean
    evidenceVerified: boolean
  }[]
  totalPoints: number
  cohortPoints: readonly number[]
  lowConfidenceThreshold?: number
  zThreshold?: number
  minSampleSize?: number
}

/**
 * Collect every reason this submission should be reviewed by a human. An empty
 * array means the AI output was consistent and in-range.
 */
export function collectFlagReasons(input: FlagInput): string[] {
  const reasons: string[] = []

  reasons.push(...lowConfidenceReasons(input.evaluations, input.lowConfidenceThreshold))

  for (const evaluation of input.evaluations) {
    if (evaluation.clampedToCeiling) {
      reasons.push(
        `Model score for "${evaluation.criterionLabel}" exceeded the criterion ceiling and was clamped.`,
      )
    }
    if (!evaluation.evidenceVerified) {
      reasons.push(
        `Evidence for "${evaluation.criterionLabel}" could not be matched to the submission text.`,
      )
    }
  }

  if (
    isStatisticalOutlier(input.totalPoints, input.cohortPoints, {
      zThreshold: input.zThreshold,
      minSampleSize: input.minSampleSize,
    })
  ) {
    const stats = computeCohortStats(input.cohortPoints)
    const zScore =
      stats.stdDev < EPSILON ? 0 : Math.abs(input.totalPoints - stats.mean) / stats.stdDev
    reasons.push(
      `Total ${input.totalPoints.toFixed(2)} is a statistical outlier for this assessment (z=${zScore.toFixed(2)}).`,
    )
  }

  return reasons
}
