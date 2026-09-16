import type { FinalGradeConfig } from "@/lib/contracts/lms-export"

import { assessmentWeight, categoryForAssessment, totalWeight } from "./weights"

/**
 * Pure weighted-final-grade logic.
 *
 * The product rule this module exists to guarantee: **only published grades
 * count.** A modern `Grade` row contributes only when `publishedAt` is set. A
 * model suggestion that no teacher has approved, or a draft, is not zero-scored
 * — it is *excluded*, and it is reported in `excludedUnpublishedAssessmentIds`
 * so the caller can show why.
 *
 * There is no legacy fallback: `AssessmentGrade` was retired so this is the only
 * grade store, read from the modern `Grade`.
 */

export type ModernGradeCandidate = {
  points: number
  maxPoints: number
  publishedAt: Date | string | null
}

export type GradeCandidateInput = {
  assessmentId: string
  modern: ModernGradeCandidate | null
}

export type ResolvedMarkOrigin = "modern-grade"

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
 * Apply the published-only rule to one student's raw candidates. Pure and
 * order-preserving.
 */
export function resolveMarks(candidates: readonly GradeCandidateInput[]): ResolvedMarks {
  const marks: ResolvedMark[] = []
  const excludedUnpublishedAssessmentIds: string[] = []

  for (const candidate of candidates) {
    if (!candidate.modern) continue
    if (candidate.modern.publishedAt === null) {
      // An unpublished modern row is a draft/suggestion no teacher approved.
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
  }

  return { marks, excludedUnpublishedAssessmentIds }
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
  /**
   * **No letter.** Deliberately absent, and it was removed rather than corrected.
   *
   * The platform cannot compute a VIT letter honestly. VIT runs two regimes —
   * relative for theory above 10 students, absolute for smaller classes and for every
   * lab, project, soft-skills and NGCR course — and choosing between them needs the
   * course's **category**, which this schema does not model (there is no
   * `CourseCategory` field), plus the cohort's mean and σ. Without the category the
   * regime is unknown, and the two regimes disagree about both the band widths and the
   * pass line.
   *
   * The field it used to carry was `letterGrade(percentage)` — fixed `A/B/C/D/F` with
   * no `E`, passing at 60. That is wrong under VIT absolute (`D` is 55-60, `E` is
   * 50-55, pass is 50) and describes bands that do not exist under VIT relative. It
   * reached the LMS export payload, which is an institutional record: a letter that
   * disagrees with the result sheet is worse than no letter.
   *
   * Restoring one needs, in order: a `CourseCategory` on the course, the cohort's
   * published marks to compute `mean ± kσ`, and then `resolveGradingRegime` +
   * `absoluteLetter` / `gradeBandRanges` from `lib/analytics/grading-bands.ts`.
   */
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
    completedWeight,
    totalWeight: configuredTotal,
    incomplete: completedWeight < configuredTotal || excludedUnpublishedInConfig.length > 0,
    categories,
  }
}
