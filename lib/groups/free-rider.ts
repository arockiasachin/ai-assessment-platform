import type { MemberAdjustment } from "./adjustment"
import type { ContributionSignalInput } from "./contribution"

/**
 * Free-rider detection.
 *
 * "Free-rider" means a member whose peer ratings fall well below the team norm.
 * That is the primary signal and the **only** one that sets `flagged`. Contribution
 * data and survey completion are surfaced as supporting evidence reasons, but a
 * member with a normal peer rating is never flagged on contribution alone — the
 * product rule says contribution metrics must never be the sole basis for a
 * grade, and the same restraint applies to the flag an instructor sees.
 */

export type FreeRiderThresholds = {
  /** Flag when the member's z-score is at most `-ratingZScore`. */
  ratingZScore: number
  /** Flag when the member's received average is at most this ratio of the team mean. */
  ratingRatio: number
  /** Require this many non-self ratings before a rating signal can fire. */
  minRaters: number
  /** Contribution below this ratio of the team mean is surfaced as evidence. */
  contributionRatio: number
}

export const DEFAULT_FREE_RIDER_THRESHOLDS: FreeRiderThresholds = {
  ratingZScore: 1.5,
  ratingRatio: 0.8,
  minRaters: 2,
  contributionRatio: 0.5,
}

export type MemberFreeRiderSignal = {
  studentId: string
  receivedAverage: number | null
  teamMean: number | null
  teamStdDev: number | null
  zScore: number | null
  ratioToTeamMean: number | null
  ratingCount: number
  /** Peer ratings are well below the team norm. */
  ratingSignal: boolean
  contributionCount: number
  contributionWeight: number
  /** Contribution is well below the team norm. Evidence only. */
  contributionSignal: boolean
  /** True when this member submitted fewer evaluations than required. */
  surveyIncomplete: boolean
  submittedEvaluations: number
  expectedEvaluations: number
  completionRate: number
  /** Only ever set from the peer-rating signal. */
  flagged: boolean
  severity: "none" | "watch" | "at-risk"
  /** Human-readable, evidence-framed reasons. */
  reasons: string[]
  /** True when the only signals are contribution/survey evidence. */
  evidenceOnly: boolean
}

export type DetectFreeRidersInput = {
  memberIds: readonly string[]
  /** Adjustment factors computed WITHOUT self-ratings (the peer signal). */
  adjustments: readonly MemberAdjustment[]
  contributions?: readonly ContributionSignalInput[]
  /** One entry per submitted evaluation row (`status === "SUBMITTED"`). */
  submittedEvaluations?: readonly { evaluatorId: string }[]
  /** Evaluations each member is expected to submit (group size, incl. self). */
  expectedEvaluationsPerMember?: number
  thresholds?: Partial<FreeRiderThresholds>
}

function stdDev(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export function detectFreeRiders(input: DetectFreeRidersInput): MemberFreeRiderSignal[] {
  const thresholds = { ...DEFAULT_FREE_RIDER_THRESHOLDS, ...input.thresholds }
  const adjustmentByStudent = new Map(
    input.adjustments.map((adjustment) => [adjustment.studentId, adjustment]),
  )

  const receivedAverages = input.memberIds
    .map((studentId) => adjustmentByStudent.get(studentId)?.receivedAverage ?? null)
    .filter((value): value is number => value !== null)
  const teamMean =
    receivedAverages.length > 0
      ? receivedAverages.reduce((sum, value) => sum + value, 0) / receivedAverages.length
      : null
  const teamStdDev = stdDev(receivedAverages)

  const contributionTotals = new Map<string, { count: number; weight: number }>()
  for (const studentId of input.memberIds)
    contributionTotals.set(studentId, { count: 0, weight: 0 })
  for (const event of input.contributions ?? []) {
    if (!event.studentId) continue
    const total = contributionTotals.get(event.studentId)
    if (!total) continue
    total.count += 1
    total.weight += Number.isFinite(event.weight) ? event.weight : 0
  }
  const contributionWeights = [...contributionTotals.values()].map((total) => total.weight)
  const teamContributionMean =
    contributionWeights.length > 0
      ? contributionWeights.reduce((sum, value) => sum + value, 0) / contributionWeights.length
      : 0

  const expectedEvaluations = input.expectedEvaluationsPerMember ?? input.memberIds.length
  const submittedByEvaluator = new Map<string, number>()
  for (const evaluation of input.submittedEvaluations ?? []) {
    submittedByEvaluator.set(
      evaluation.evaluatorId,
      (submittedByEvaluator.get(evaluation.evaluatorId) ?? 0) + 1,
    )
  }

  return input.memberIds.map((studentId) => {
    const adjustment = adjustmentByStudent.get(studentId)
    const receivedAverage = adjustment?.receivedAverage ?? null
    const ratingCount = adjustment?.ratingCount ?? 0

    const zScore =
      teamStdDev !== null && teamStdDev > 0 && receivedAverage !== null
        ? (receivedAverage - (teamMean ?? 0)) / teamStdDev
        : null
    const ratioToTeamMean =
      teamMean !== null && teamMean > 0 && receivedAverage !== null
        ? receivedAverage / teamMean
        : null

    const ratingSignal =
      ratingCount >= thresholds.minRaters &&
      ((zScore !== null && zScore <= -thresholds.ratingZScore) ||
        (ratioToTeamMean !== null && ratioToTeamMean <= thresholds.ratingRatio))

    const contributionTotal = contributionTotals.get(studentId) ?? { count: 0, weight: 0 }
    const contributionSignal =
      teamContributionMean > 0 &&
      contributionTotal.weight <= thresholds.contributionRatio * teamContributionMean

    const submittedEvaluations = submittedByEvaluator.get(studentId) ?? 0
    const surveyIncomplete = expectedEvaluations > 0 && submittedEvaluations < expectedEvaluations
    const completionRate = expectedEvaluations > 0 ? submittedEvaluations / expectedEvaluations : 1

    const reasons: string[] = []
    if (ratingSignal) {
      reasons.push(
        `Peer rating average ${receivedAverage?.toFixed(2) ?? "n/a"} is well below the team norm (${teamMean?.toFixed(2) ?? "n/a"}).`,
      )
    }
    if (contributionSignal) {
      reasons.push(
        `Contribution weight ${contributionTotal.weight} is below the team norm (${teamContributionMean.toFixed(2)}). Evidence only, not a grade basis.`,
      )
    }
    if (surveyIncomplete) {
      reasons.push(
        `Submitted ${submittedEvaluations} of ${expectedEvaluations} expected peer evaluations.`,
      )
    }

    const severity: MemberFreeRiderSignal["severity"] = ratingSignal
      ? (zScore !== null && zScore <= -2) || (ratioToTeamMean !== null && ratioToTeamMean <= 0.6)
        ? "at-risk"
        : "watch"
      : "none"

    return {
      studentId,
      receivedAverage,
      teamMean,
      teamStdDev,
      zScore,
      ratioToTeamMean,
      ratingCount,
      ratingSignal,
      contributionCount: contributionTotal.count,
      contributionWeight: contributionTotal.weight,
      contributionSignal,
      surveyIncomplete,
      submittedEvaluations,
      expectedEvaluations,
      completionRate,
      flagged: ratingSignal,
      severity,
      reasons,
      evidenceOnly: !ratingSignal && (contributionSignal || surveyIncomplete),
    }
  })
}
