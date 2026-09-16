import type { FinalGradeConfig } from "@/lib/contracts/lms-export"
import type { AssessmentType } from "@/lib/generated/prisma/client"

/**
 * Course grading policy: the weights, the eligibility rule, and which marks may enter
 * a mean.
 *
 * ## What already existed, and what this adds
 *
 * The platform already computes a **weighted** grand total:
 * `lib/lms-export/final-grade.ts` understands a `FinalGradeConfig` of categories that
 * sum to 100, each holding assessments with optional relative weights, and it already
 * applies the published-only rule and excludes missing assessments rather than
 * zero-filling them. Two things were missing and are here:
 *
 * 1. **Persistence.** The config was request-body only — a teacher could pass it to one
 *    export call and it was gone. Weights are course configuration, so they are stored
 *    on the offering (`CourseOffering.gradingConfig`).
 * 2. **A derivable default.** `defaultFinalGradeConfig` weights everything equally in
 *    one category, which is honest but does not express the CAT/FAT split a VIT course
 *    actually has. `deriveDefaultGradingConfig` below produces that shape.
 *
 * ## The CAT / FAT model
 *
 * A course's marks are two pools:
 *
 * - **CAT** — the continuous-assessment pool: every mini-assessment through the term.
 *   They are weighted equally by default, so their relative weight follows how much
 *   assessed work there is; a teacher can set explicit per-assessment weights instead.
 * - **FAT** — a **single** assessment at the end of the term.
 *
 * The default split is `CAT 40 / FAT 60`.
 *
 * **A note on that number, recorded rather than buried.** VIT's FFCS regulations (v4.0
 * §9.1, v5.0) state the opposite for theory: CAM 60 + FAT 40, with the continuous pool
 * carrying the larger share. The classic VIT split is CAT 40 + FAT 60. Both are real
 * institutional configurations, which is precisely why this is a stored config with an
 * editable default rather than a constant — the number belongs to the course, not to
 * the code. Changing the default is the one line below.
 */

/** The default CAT/FAT split. Course configuration, so it is editable. */
export const DEFAULT_CATEGORY_WEIGHTS = {
  CAT: 40,
  FAT: 60,
} as const

export const CATEGORY_NAMES = {
  CAT: "Continuous assessment",
  FAT: "Final assessment",
} as const

export const CAT_CATEGORY_ID = "cat"
export const FAT_CATEGORY_ID = "fat"

/**
 * The assessment types that can plausibly be a course's final assessment.
 *
 * There is **no `FAT` type** in `AssessmentType`, and no `isFinal` flag, so the
 * default cannot be derived from data — see `deriveDefaultGradingConfig`.
 */
export const FINAL_ASSESSMENT_TYPES: readonly AssessmentType[] = [
  "QUIZ",
  "DESCRIPTIVE",
  "CODE",
  "GROUP_PROJECT",
  "ASSIGNMENT",
]

export type GradingAssessmentInput = {
  id: string
  type: AssessmentType
  dueDate: Date | string
}

export type DerivedConfigOptions = {
  /** Override the split. Percentages; must sum to 100. */
  weights?: { CAT: number; FAT: number }
}

/**
 * A default CAT/FAT configuration for an offering's assessments.
 *
 * **The FAT is identified by due date** — the last assessment to fall due — because the
 * schema has no way to say which assessment is the final one. That is a heuristic, and
 * it is named as one: an offering whose last-due assessment is not its final exam gets a
 * wrong default, and the teacher corrects it. The alternative — inventing an
 * `Assessment.isFinal` column — was not taken because a course can also grade its final
 * as several components, which the category model already expresses and a flag cannot.
 *
 * Returns `null` when there are fewer than two assessments: with one, or none, there is
 * no CAT/FAT distinction to draw and a single equal-weight category is the honest
 * answer (the caller keeps `defaultFinalGradeConfig` for that case).
 */
export function deriveDefaultGradingConfig(
  assessments: readonly GradingAssessmentInput[],
  options: DerivedConfigOptions = {},
): FinalGradeConfig | null {
  if (assessments.length < 2) return null

  const weights = options.weights ?? DEFAULT_CATEGORY_WEIGHTS
  const byDueDate = [...assessments].sort(
    (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
  )

  const finalAssessment = byDueDate[byDueDate.length - 1]
  const continuous = byDueDate.slice(0, -1)

  return {
    categories: [
      {
        id: CAT_CATEGORY_ID,
        name: CATEGORY_NAMES.CAT,
        weight: weights.CAT,
        assessmentIds: continuous.map((assessment) => assessment.id),
        // No `assessmentWeights`: equal share within the pool, so each mini-assessment
        // carries 1/n of the CAT pool and the relative weight follows the assessed
        // workload. A teacher can pin explicit weights instead.
      },
      {
        id: FAT_CATEGORY_ID,
        name: CATEGORY_NAMES.FAT,
        weight: weights.FAT,
        assessmentIds: [finalAssessment.id],
      },
    ],
  }
}

/**
 * Whether an assessment's marks may enter a mean yet.
 *
 * Two conditions, and both are the owner's rules:
 *
 * - **The due date has passed.** A mean taken mid-term that already contains an
 *   assessment students have not sat yet is not a mean of anything. This is also what
 *   makes a weekly series stable: a week's point does not move while its assessment is
 *   still open.
 * - **The mark is published.** Unpublished is *excluded*, never counted as zero — which
 *   `computeFinalGrade` already does, and which matters because zero-filling drives the
 *   cohort boundary to a number that flags nobody (see `docs/plans/wave-3.md` §8, U5).
 *
 * **A genuine zero is included.** "Exclude 0" is not implemented as "drop the value
 * zero", deliberately: a student who submitted and scored 0 has a real mark, and
 * dropping it would inflate their average — the same class of error as zero-filling, in
 * the opposite direction. What is excluded is a mark that *does not exist* (no
 * submission, or not yet published), which is what the owner's rule is protecting
 * against.
 */
export function isMarkIncludedInMean(
  assessment: { dueDate: Date | string },
  mark: { publishedAt: Date | string | null } | null,
  now: Date = new Date(),
): boolean {
  if (mark === null || mark.publishedAt === null) return false
  return new Date(assessment.dueDate).getTime() <= now.getTime()
}

/** Whether an assessment itself is past due, independent of any one student's mark. */
export function isPastDue(dueDate: Date | string, now: Date = new Date()): boolean {
  return new Date(dueDate).getTime() <= now.getTime()
}

// ---------------------------------------------------------------------------
// FAT eligibility
// ---------------------------------------------------------------------------

/**
 * Why a student may not sit the final assessment.
 *
 * VIT gates the FAT on more than marks — attendance, debarment and a minimum
 * continuous-assessment score all feed the `N` grade — but the only input this platform
 * models is marks, so the rule here is the marks-based one and says so.
 */
export type FatEligibility =
  | { eligible: true; catPercent: number | null }
  | { eligible: false; reason: "below-cat-minimum"; catPercent: number; minimum: number }
  | { eligible: false; reason: "insufficient-cat-work" }

export type FatEligibilityOptions = {
  /**
   * Minimum continuous-assessment percentage required to sit the FAT.
   *
   * Defaults to `DEFAULT_FAT_MINIMUM_CAT_PERCENT` (30). Pass `null` to disable the gate
   * entirely — which is the only honest way to express "this course has no CAT gate",
   * as distinct from "the gate is at zero".
   */
  minimumCatPercent: number | null
  /**
   * How much of the CAT pool must be marked before eligibility can be judged.
   *
   * Defaults to `0.5`: judging on a tenth of the term's work would fail a student on
   * evidence that barely exists. Below it, the verdict is `insufficient-cat-work` —
   * which is a *third* answer, not "fail".
   */
  minimumCatCompletionRatio?: number
}

/**
 * The default minimum CAT percentage required to sit the FAT — the institution's
 * figure, supplied by the owner rather than invented.
 *
 * **This one is a default and not a required argument, unlike an earlier version of
 * this module.** It is still overridable per offering, because the number is course
 * configuration; it simply now has a stated value to fall back on instead of forcing
 * every caller to pass one.
 */
export const DEFAULT_FAT_MINIMUM_CAT_PERCENT = 30

const DEFAULT_CAT_COMPLETION_RATIO = 0.5

export type CatProgress = {
  /** Marks that have entered the CAT mean. */
  markedCount: number
  /** Assessments in the CAT pool. */
  totalCount: number
  /** `markedCount / totalCount`, or 0 with an empty pool. */
  completionRatio: number
  /** Weighted CAT percentage, or `null` when nothing is marked. */
  percent: number | null
}

/**
 * Judge FAT eligibility from a student's CAT progress.
 *
 * Returns one of three outcomes rather than a boolean, because "not enough marked yet"
 * and "below the minimum" are different facts and only one of them is about the
 * student. Collapsing them into `false` would tell a student they cannot sit the exam
 * when the truth is that marking is unfinished.
 */
export function evaluateFatEligibility(
  progress: CatProgress,
  options: FatEligibilityOptions,
): FatEligibility {
  const minimum = options.minimumCatPercent
  if (minimum === null) return { eligible: true, catPercent: progress.percent }

  const required = options.minimumCatCompletionRatio ?? DEFAULT_CAT_COMPLETION_RATIO
  if (progress.completionRatio < required) {
    return { eligible: false, reason: "insufficient-cat-work" }
  }

  if (progress.percent === null || progress.percent < minimum) {
    return {
      eligible: false,
      reason: "below-cat-minimum",
      catPercent: progress.percent ?? 0,
      minimum,
    }
  }

  return { eligible: true, catPercent: progress.percent }
}

// ---------------------------------------------------------------------------
// Passing the course
// ---------------------------------------------------------------------------

/**
 * The combined CAT+FAT percentage required to pass.
 *
 * **Inclusive, and that is deliberate.** `>= 50` passes, matching VIT's absolute
 * Table-6, where the `E` band starts *at* 50 — so a student on exactly 50 passes. The
 * rule was stated as "above 50%", and read literally that would be `> 50` and would fail
 * a student on exactly 50; the institution's own table says otherwise, so the inclusive
 * reading is used and the discrepancy is recorded rather than guessed silently.
 */
export const PASS_MARK = 50

export type CourseOutcome =
  | { status: "pass"; grandTotal: number }
  | { status: "fail"; grandTotal: number; reason: "below-pass-mark" }
  /** The CAT gate was not cleared, so the FAT cannot be sat and the course cannot pass. */
  | { status: "fail"; reason: "fat-ineligible"; catPercent: number; minimum: number }
  /** Not judged: too little of the CAT pool is marked, or the FAT has not been taken. */
  | { status: "not-judged"; reason: "insufficient-cat-work" | "no-grand-total" }

export type CourseOutcomeOptions = {
  minimumCatPercent?: number | null
  minimumCatCompletionRatio?: number
  passMark?: number
}

/**
 * The whole verdict for one student: the CAT gate, then the combined pass mark.
 *
 * Modelled as a four-way union rather than a boolean for the same reason
 * `FatEligibility` is: **"fail" and "not judged yet" are different facts**, and only one
 * of them is about the student. A course mid-term has students with no FAT mark and a
 * partly-marked CAT pool, and reporting those as failures would be wrong for every one
 * of them.
 *
 * Order matters. The CAT gate is checked **first**, because a student who may not sit the
 * FAT cannot have a grand total at all — so a missing grand total is expected for them,
 * not an unexplained gap.
 */
export function evaluateCourseOutcome(
  progress: CatProgress,
  grandTotal: number | null,
  options: CourseOutcomeOptions = {},
): CourseOutcome {
  const minimum =
    options.minimumCatPercent === undefined
      ? DEFAULT_FAT_MINIMUM_CAT_PERCENT
      : options.minimumCatPercent

  const eligibility = evaluateFatEligibility(progress, {
    minimumCatPercent: minimum,
    minimumCatCompletionRatio: options.minimumCatCompletionRatio,
  })

  if (!eligibility.eligible) {
    if (eligibility.reason === "insufficient-cat-work") {
      return { status: "not-judged", reason: "insufficient-cat-work" }
    }
    return {
      status: "fail",
      reason: "fat-ineligible",
      catPercent: eligibility.catPercent,
      minimum: eligibility.minimum,
    }
  }

  if (grandTotal === null) {
    return { status: "not-judged", reason: "no-grand-total" }
  }

  const passMark = options.passMark ?? PASS_MARK
  return grandTotal >= passMark
    ? { status: "pass", grandTotal }
    : { status: "fail", grandTotal, reason: "below-pass-mark" }
}

/**
 * CAT progress from an assessment's marks.
 *
 * **Precondition: pass one entry per CAT assessment, including the unmarked ones as
 * `included: false`.** `totalCount` is the array length, so a caller who passes only the
 * marked assessments gets `completionRatio: 1` and a fully-marked score from a
 * part-marked pool — which then clears the `insufficient-cat-work` guard and judges a
 * student on evidence that does not exist. There is a test that demonstrates exactly
 * that outcome, so the trap is visible rather than only described here.
 *
 * The shape of a correct call:
 *
 * ```ts
 * catProgress(assessments.map((a) => ({
 *   percentage: marksByAssessment.get(a.id)?.percentage ?? 0,
 *   included: isMarkIncludedInMean(a, marksByAssessment.get(a.id) ?? null),
 * })))
 * ```
 *
 * `catPercent` is the **weighted average of percentages**, which is what
 * `computeFinalGrade` produces for a category — so the eligibility verdict and the grand
 * total cannot disagree about how the CAT pool scored. Missing marks are skipped rather
 * than counted as zero, for the same reason as `isMarkIncludedInMean`.
 */
export function catProgress(
  marks: readonly { percentage: number; weight?: number; included: boolean }[],
): CatProgress {
  const included = marks.filter((mark) => mark.included)
  const totalCount = marks.length
  const markedCount = included.length

  if (markedCount === 0) {
    return { markedCount, totalCount, completionRatio: 0, percent: null }
  }

  const weightSum = included.reduce((sum, mark) => sum + (mark.weight ?? 1), 0)
  const weighted = included.reduce((sum, mark) => sum + mark.percentage * (mark.weight ?? 1), 0)

  return {
    markedCount,
    totalCount,
    completionRatio: totalCount === 0 ? 0 : markedCount / totalCount,
    percent: weightSum > 0 ? Math.round((weighted / weightSum) * 100) / 100 : null,
  }
}
