import type { FinalGradeConfig } from "@/lib/contracts/lms-export"
import { letterGrade } from "@/lib/gradebook"

import { assessmentWeight, categoryForAssessment, totalWeight } from "./weights"

/**
 * Pure weighted-final-grade logic.
 *
 * The two product rules this module exists to guarantee:
 *
 * 1. **Only published grades count.** A modern `Grade` row contributes only when
 *    `publishedAt` is set. A model suggestion that no teacher has approved is
 *    not zero-scored, it is *excluded*, and it is reported in
 *    `excludedUnpublishedAssessmentIds` so the caller can show why.
 * 2. **Modern beats legacy, absolutely.** A legacy `AssessmentGrade` is a
 *    fallback for assessments that have *no* modern `Grade` row. When a modern
 *    row exists it wins even if it is unpublished — an unpublished suggestion
 *    blocks the legacy fallback rather than being silently replaced by it.
 */

export type ModernGradeCandidate = {
  points: number
  maxPoints: number
  publishedAt: Date | string | null
}

export type LegacyGradeCandidate = {
  marksObtained: number
  maxMarks: number
}

export type GradeCandidateInput = {
  assessmentId: string
  modern: ModernGradeCandidate | null
  legacy: LegacyGradeCandidate | null
}

export type ResolvedMarkOrigin = "modern-grade" | "legacy-grade"

export type ResolvedMark = {
  assessmentId: string
  points: number
  maxPoints: number
  percentage: number
  origin: ResolvedMarkOrigin
  publishedAt: string | null
}

export type ResolvedMarks = {
  marks: ResolvedMark[]
  /** Modern rows that exist but are unpublished — excluded by rule 1. */
  excludedUnpublishedAssessmentIds: string[]
  /** Assessments scored from the legacy model because no modern row existed. */
  legacyFallbackAssessmentIds: string[]
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function percentageOf(points: number, maxPoints: number): number {
  if (!Number.isFinite(points) || !Number.isFinite(maxPoints) || maxPoints <= 0) return 0
  return round2(Math.max(0, Math.min(100, (points / maxPoints) * 100)))
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

/**
 * Apply the published-only rule and the modern-over-legacy precedence to one
 * student's raw candidates. Pure and order-preserving.
 */
export function resolveMarks(candidates: readonly GradeCandidateInput[]): ResolvedMarks {
  const marks: ResolvedMark[] = []
  const excludedUnpublishedAssessmentIds: string[] = []
  const legacyFallbackAssessmentIds: string[] = []

  for (const candidate of candidates) {
    if (candidate.modern) {
      if (candidate.modern.publishedAt === null) {
        // Rule 1 and rule 2: an unpublished modern row is excluded, and it
        // pre-empts the legacy fallback rather than deferring to it.
        excludedUnpublishedAssessmentIds.push(candidate.assessmentId)
        continue
      }
      marks.push({
        assessmentId: candidate.assessmentId,
        points: candidate.modern.points,
        maxPoints: candidate.modern.maxPoints,
        percentage: percentageOf(candidate.modern.points, candidate.modern.maxPoints),
        origin: "modern-grade",
        publishedAt: toIso(candidate.modern.publishedAt),
      })
      continue
    }

    if (candidate.legacy && candidate.legacy.maxMarks > 0) {
      marks.push({
        assessmentId: candidate.assessmentId,
        points: candidate.legacy.marksObtained,
        maxPoints: candidate.legacy.maxMarks,
        percentage: percentageOf(candidate.legacy.marksObtained, candidate.legacy.maxMarks),
        origin: "legacy-grade",
        publishedAt: null,
      })
      legacyFallbackAssessmentIds.push(candidate.assessmentId)
    }
  }

  return { marks, excludedUnpublishedAssessmentIds, legacyFallbackAssessmentIds }
}

export type FinalGradeCategoryResult = {
  id: string
  name: string
  weight: number
  score: number | null
  included: boolean
  assessmentIds: string[]
  includedAssessmentIds: string[]
  missingAssessmentIds: string[]
}

export type FinalGradeComputation = {
  percentage: number | null
  letter: string | null
  completedWeight: number
  totalWeight: number
  incomplete: boolean
  categories: FinalGradeCategoryResult[]
}

/**
 * Combine resolved marks into a weighted final grade.
 *
 * A category with no usable mark is excluded and the final percentage is
 * renormalised over the categories that do have marks (`completedWeight`). This
 * is why a pending AI suggestion cannot drag a grade toward zero: it simply is
 * not in the input.
 */
export function computeFinalGrade(
  config: FinalGradeConfig,
  resolved: ResolvedMarks,
): FinalGradeComputation {
  const marksByAssessment = new Map(resolved.marks.map((mark) => [mark.assessmentId, mark]))

  const categories: FinalGradeCategoryResult[] = config.categories.map((category) => {
    const includedAssessmentIds: string[] = []
    const missingAssessmentIds: string[] = []
    let weightedSum = 0
    let weightSum = 0

    for (const assessmentId of category.assessmentIds) {
      const mark = marksByAssessment.get(assessmentId)
      if (!mark) {
        missingAssessmentIds.push(assessmentId)
        continue
      }
      const weight = assessmentWeight(category, assessmentId)
      weightedSum += mark.percentage * weight
      weightSum += weight
      includedAssessmentIds.push(assessmentId)
    }

    const included = weightSum > 0
    return {
      id: category.id,
      name: category.name,
      weight: category.weight,
      score: included ? round2(weightedSum / weightSum) : null,
      included,
      assessmentIds: [...category.assessmentIds],
      includedAssessmentIds,
      missingAssessmentIds,
    }
  })

  const includedCategories = categories.filter((category) => category.included)
  const completedWeight = round2(
    includedCategories.reduce((sum, category) => sum + category.weight, 0),
  )
  const configuredTotal = totalWeight(config)

  let percentage: number | null = null
  if (completedWeight > 0) {
    const weighted = includedCategories.reduce(
      (sum, category) => sum + (category.score ?? 0) * category.weight,
      0,
    )
    percentage = round2(weighted / completedWeight)
  }

  const excludedUnpublishedInConfig = resolved.excludedUnpublishedAssessmentIds.filter(
    (assessmentId) => categoryForAssessment(config, assessmentId) !== null,
  )

  return {
    percentage,
    letter: percentage === null ? null : letterGrade(percentage),
    completedWeight,
    totalWeight: configuredTotal,
    incomplete: completedWeight < configuredTotal || excludedUnpublishedInConfig.length > 0,
    categories,
  }
}
