import {
  PEER_EVALUATION_DIMENSION_KEYS,
  overallFromRatings,
  type PeerEvaluationDimensionKey,
  type PeerEvaluationRatings,
} from "./dimensions"

/**
 * Adjustment factors convert a single group grade into individual grades.
 *
 * The established convention (CATME) is a ratio of ratios:
 *
 *   adjustmentFactor(student) = studentReceivedAverage / teamAverageOfReceivedAverages
 *
 * where "received average" is the mean rating the student's teammates gave them
 * and the team average is the mean of every member's received average. A student
 * rated at the team norm gets 1.0; above the norm gets > 1.0; below gets < 1.0.
 *
 * The convention is computed **both without and with self-ratings**, because a
 * student's self-rating can hide (or exaggerate) a problem:
 *
 *  - without self-ratings: only evaluations `evaluatorId !== evaluateeId` count;
 *  - with self-ratings: each student's own rating is folded into their average.
 *
 * This module is pure: it takes already-submitted ratings and returns the maths.
 * Persisting the factors onto `GroupMember.adjustmentFactor` /
 * `selfAdjustmentFactor` is the service's job.
 */

export type EvaluationRatingInput = {
  evaluatorId: string
  evaluateeId: string
  ratings: PeerEvaluationRatings
}

export type AdjustmentFactorOptions = {
  includeSelfRatings: boolean
  /** Optional lower clamp applied to the returned factor. */
  minFactor?: number
  /** Optional upper clamp applied to the returned factor. */
  maxFactor?: number
}

export type MemberAdjustment = {
  studentId: string
  /** Mean of the ratings this student received, or `null` when there are none. */
  receivedAverage: number | null
  /** The team norm this student is compared against, or `null` when undefined. */
  teamAverage: number | null
  /** `receivedAverage / teamAverage`, clamped; 1 when it cannot be computed. */
  adjustmentFactor: number
  /** Per-dimension factors, for explainability. */
  dimensionFactors: Record<PeerEvaluationDimensionKey, number>
  /** How many ratings were folded into `receivedAverage`. */
  ratingCount: number
  includesSelf: boolean
  /** True when no usable ratings existed and the neutral factor 1 was returned. */
  insufficientRatings: boolean
}

function clamp(value: number, min?: number, max?: number): number {
  let result = value
  if (min !== undefined) result = Math.max(min, result)
  if (max !== undefined) result = Math.min(max, result)
  return result
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

/**
 * Compute per-student adjustment factors for one group.
 *
 * `memberIds` defines the group roster (so a member nobody rated still gets a
 * neutral factor rather than being dropped). Evaluations from or to non-members
 * are ignored, as are duplicates for the same `(evaluator, evaluatee)` pair
 * (the last one wins, matching the upsert semantics of the API).
 */
export function computeAdjustmentFactors(
  memberIds: readonly string[],
  evaluations: readonly EvaluationRatingInput[],
  options: AdjustmentFactorOptions,
): MemberAdjustment[] {
  const roster = new Set(memberIds)
  const deduped = new Map<string, EvaluationRatingInput>()
  for (const evaluation of evaluations) {
    if (!roster.has(evaluation.evaluatorId) || !roster.has(evaluation.evaluateeId)) continue
    if (!options.includeSelfRatings && evaluation.evaluatorId === evaluation.evaluateeId) continue
    deduped.set(`${evaluation.evaluatorId}->${evaluation.evaluateeId}`, evaluation)
  }
  const usable = [...deduped.values()]

  const overallReceived = new Map<string, number[]>([])
  const dimensionReceived = new Map<PeerEvaluationDimensionKey, Map<string, number[]>>()
  for (const key of PEER_EVALUATION_DIMENSION_KEYS) dimensionReceived.set(key, new Map())

  for (const studentId of memberIds) {
    overallReceived.set(studentId, [])
    for (const key of PEER_EVALUATION_DIMENSION_KEYS) {
      dimensionReceived.get(key)!.set(studentId, [])
    }
  }

  for (const evaluation of usable) {
    overallReceived.get(evaluation.evaluateeId)?.push(overallFromRatings(evaluation.ratings))
    for (const key of PEER_EVALUATION_DIMENSION_KEYS) {
      dimensionReceived.get(key)!.get(evaluation.evaluateeId)?.push(evaluation.ratings[key])
    }
  }

  const overallAverages = new Map<string, number | null>()
  const dimensionAverages = new Map<PeerEvaluationDimensionKey, Map<string, number | null>>()
  for (const key of PEER_EVALUATION_DIMENSION_KEYS) dimensionAverages.set(key, new Map())

  const receivedList: number[] = []
  const dimensionReceivedLists = new Map<PeerEvaluationDimensionKey, number[]>()
  for (const key of PEER_EVALUATION_DIMENSION_KEYS) dimensionReceivedLists.set(key, [])

  for (const studentId of memberIds) {
    const average = mean(overallReceived.get(studentId) ?? [])
    overallAverages.set(studentId, average)
    if (average !== null) receivedList.push(average)
    for (const key of PEER_EVALUATION_DIMENSION_KEYS) {
      const dimensionAverage = mean(dimensionReceived.get(key)!.get(studentId) ?? [])
      dimensionAverages.get(key)!.set(studentId, dimensionAverage)
      if (dimensionAverage !== null) dimensionReceivedLists.get(key)!.push(dimensionAverage)
    }
  }

  const teamAverage = mean(receivedList)
  const dimensionTeamAverages = new Map<PeerEvaluationDimensionKey, number | null>()
  for (const key of PEER_EVALUATION_DIMENSION_KEYS) {
    dimensionTeamAverages.set(key, mean(dimensionReceivedLists.get(key)!))
  }

  return memberIds.map((studentId) => {
    const receivedAverage = overallAverages.get(studentId) ?? null
    const insufficientRatings = receivedAverage === null || teamAverage === null || teamAverage <= 0
    const rawFactor = insufficientRatings ? 1 : receivedAverage! / teamAverage!
    const adjustmentFactor = clamp(rawFactor, options.minFactor, options.maxFactor)

    const dimensionFactors = {} as Record<PeerEvaluationDimensionKey, number>
    for (const key of PEER_EVALUATION_DIMENSION_KEYS) {
      const studentAverage = dimensionAverages.get(key)!.get(studentId) ?? null
      const teamDimensionAverage = dimensionTeamAverages.get(key) ?? null
      const raw =
        studentAverage === null || teamDimensionAverage === null || teamDimensionAverage <= 0
          ? 1
          : studentAverage / teamDimensionAverage
      dimensionFactors[key] = clamp(raw, options.minFactor, options.maxFactor)
    }

    return {
      studentId,
      receivedAverage,
      teamAverage,
      adjustmentFactor,
      dimensionFactors,
      ratingCount: overallReceived.get(studentId)?.length ?? 0,
      includesSelf: options.includeSelfRatings,
      insufficientRatings,
    }
  })
}

export type AdjustmentApplication = {
  groupGrade: number
  factor: number
  /** `groupGrade * factor`; the teacher decides whether to publish it. */
  individualGrade: number
  factorWasClamped: boolean
}

/**
 * Apply a factor to a group grade. Pure and side-effect free: it computes a
 * suggestion, it does not publish a grade (the product rule is that a teacher
 * approves every grade).
 */
export function applyAdjustmentFactor(
  groupGrade: number,
  factor: number,
  options: { minFactor?: number; maxFactor?: number } = {},
): AdjustmentApplication {
  const clamped = clamp(factor, options.minFactor, options.maxFactor)
  const rounded = Math.round(clamped * 1e6) / 1e6
  return {
    groupGrade,
    factor: rounded,
    individualGrade: Math.round(groupGrade * rounded * 100) / 100,
    factorWasClamped: Math.abs(clamped - factor) > 1e-9,
  }
}
