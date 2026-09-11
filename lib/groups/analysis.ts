import {
  applyAdjustmentFactor,
  computeAdjustmentFactors,
  type AdjustmentApplication,
  type MemberAdjustment,
} from "./adjustment"
import {
  summarizeContributions,
  type ContributionSignalInput,
  type ContributionSummary,
} from "./contribution"
import {
  detectFreeRiders,
  type FreeRiderThresholds,
  type MemberFreeRiderSignal,
} from "./free-rider"
import { summarizeMilestones, type MilestoneInput, type MilestoneProgress } from "./milestones"
import type { PeerEvaluationRatings } from "./dimensions"

/**
 * Compose the pure helpers into the instructor-facing analysis for one group:
 * adjustment factors both with and without self-ratings, free-rider signals,
 * contribution evidence, and milestone progress. Pure; the DB service only
 * assembles the inputs and serializes the output.
 */

export type GroupEvaluationRow = {
  evaluatorId: string
  evaluateeId: string
  status: "DRAFT" | "SUBMITTED" | string
  ratings: PeerEvaluationRatings
}

export type GroupAnalysisInput = {
  groupId: string
  memberIds: readonly string[]
  evaluations: readonly GroupEvaluationRow[]
  contributions?: readonly ContributionSignalInput[]
  milestones?: readonly MilestoneInput[]
  thresholds?: Partial<FreeRiderThresholds>
  factorBounds?: { minFactor?: number; maxFactor?: number }
  now?: Date
}

export type GroupAnalysis = {
  groupId: string
  memberIds: string[]
  /** Peer-only factors (self-ratings excluded) — the CATME convention. */
  withoutSelf: MemberAdjustment[]
  /** Factors that fold each student's self-rating into their average. */
  withSelf: MemberAdjustment[]
  freeRiders: MemberFreeRiderSignal[]
  contributionSummaries: ContributionSummary[]
  milestoneProgress: MilestoneProgress
  submittedEvaluationCount: number
}

export function analyzeGroup(input: GroupAnalysisInput): GroupAnalysis {
  const memberIds = [...input.memberIds]
  const submitted = input.evaluations.filter((evaluation) => evaluation.status === "SUBMITTED")
  const ratingInputs = submitted.map((evaluation) => ({
    evaluatorId: evaluation.evaluatorId,
    evaluateeId: evaluation.evaluateeId,
    ratings: evaluation.ratings,
  }))

  const withoutSelf = computeAdjustmentFactors(memberIds, ratingInputs, {
    includeSelfRatings: false,
    ...input.factorBounds,
  })
  const withSelf = computeAdjustmentFactors(memberIds, ratingInputs, {
    includeSelfRatings: true,
    ...input.factorBounds,
  })

  const contributions = input.contributions ?? []
  const freeRiders = detectFreeRiders({
    memberIds,
    adjustments: withoutSelf,
    contributions,
    submittedEvaluations: submitted.map((evaluation) => ({
      evaluatorId: evaluation.evaluatorId,
    })),
    expectedEvaluationsPerMember: memberIds.length,
    thresholds: input.thresholds,
  })

  return {
    groupId: input.groupId,
    memberIds,
    withoutSelf,
    withSelf,
    freeRiders,
    contributionSummaries: summarizeContributions(contributions),
    milestoneProgress: summarizeMilestones(input.milestones ?? [], input.now ?? new Date()),
    submittedEvaluationCount: submitted.length,
  }
}

export type SuggestedIndividualGrade = AdjustmentApplication & {
  studentId: string
  /** Same suggestion computed with self-ratings included, for comparison. */
  withSelf: AdjustmentApplication
}

/**
 * Convert one group grade into per-student suggestions using both factors.
 * These are suggestions only: publishing a `Grade` remains a teacher action.
 */
export function suggestIndividualGrades(
  groupGrade: number,
  analysis: Pick<GroupAnalysis, "withoutSelf" | "withSelf">,
): SuggestedIndividualGrade[] {
  const byStudent = new Map(
    analysis.withSelf.map((adjustment) => [adjustment.studentId, adjustment]),
  )
  return analysis.withoutSelf.map((adjustment) => ({
    studentId: adjustment.studentId,
    ...applyAdjustmentFactor(groupGrade, adjustment.adjustmentFactor),
    withSelf: applyAdjustmentFactor(
      groupGrade,
      byStudent.get(adjustment.studentId)?.adjustmentFactor ?? 1,
    ),
  }))
}
