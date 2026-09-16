import type { AssessmentType } from "@/lib/generated/prisma/client"

import {
  resolveFinalGradeConfig,
  resolveGradingPolicy,
  type StoredGradingConfig,
} from "./offering-config"
import {
  catProgress,
  evaluateFatEligibility,
  isMarkIncludedInMean,
  isPastDue,
  type CatProgress,
  type FatEligibility,
} from "./policy"

/**
 * Who may sit the final assessment, and why.
 *
 * ## Why this module exists
 *
 * `evaluateFatEligibility` and `catProgress` in `lib/grading/policy.ts` encode the owner's
 * rule — a student needs a minimum continuous-assessment score to sit the FAT — but nothing
 * called them, so the rule was not applied to anybody. This turns a stored policy plus a
 * class's marks into a per-student verdict.
 *
 * ## Advisory, and that is stated rather than implied
 *
 * Nothing here *blocks* a student from attempting the FAT. It reports the verdict, which the
 * grading panel shows before the teacher exports. Enforcing it at attempt time is a separate
 * change: it would need the FAT's own delivery path (a quiz attempt, or a submission) to
 * consult the offering's policy, and refusing an attempt is a harder failure than refusing an
 * export — get it wrong and a student cannot sit an exam they are entitled to. So the rule is
 * computed and surfaced first, and enforcement is recorded as the follow-up rather than
 * half-built here.
 *
 * ## One source of truth for the numbers
 *
 * The CAT percentage is computed with the same helpers the export uses for its grand total
 * (`catProgress` over marks resolved by the export's own published-only rule), so the
 * eligibility verdict and the exported total cannot disagree about how the pool scored.
 */

/** One student's marks for the offering, already resolved to published percentages. */
export type EligibilityMark = {
  assessmentId: string
  /** Percentage of the assessment's maximum, 0-100. */
  percentage: number
  publishedAt: Date | string | null
}

export type EligibilityStudent = {
  id: string
  name: string
  registerNumber: string
  marks: readonly EligibilityMark[]
}

/** The CAT gate verdict for one student, flattened for display. */
export type CatEligibilityRow = {
  studentId: string
  name: string
  registerNumber: string
  progress: CatProgress
  eligibility: FatEligibility
  /**
   * A short, student-facing status. Derived from `eligibility.reason` rather than being the
   * storage format, so the UI has one thing to render and does not re-derive the union.
   */
  status: "eligible" | "below-cat-minimum" | "insufficient-cat-work" | "no-cat-gate"
}

export type EligibilityAssessment = {
  id: string
  title: string
  type: AssessmentType
  dueDate: Date | string
}

/**
 * A short, student-facing status.
 *
 * Derived from the gate's state and then `eligibility.reason`, in that order. **The gate is
 * checked first** because "this course has no CAT gate" is a property of the course, not of the
 * student — deriving it from a student's marks would label a gated student with a good CAT
 * score as "no gate", which reads as a promise the course never made.
 */
function toStatus(eligibility: FatEligibility, gateEnabled: boolean): CatEligibilityRow["status"] {
  if (!gateEnabled) return "no-cat-gate"
  if (eligibility.eligible) return "eligible"
  return eligibility.reason
}

/**
 * Per-student CAT progress and FAT eligibility for one offering.
 *
 * **The CAT pool is the resolved configuration's, not a guess.** Whatever the policy resolves
 * to — the stored weights and the teacher's chosen final assessment, or the derived default —
 * is what decides which assessments count toward the gate. That matters because the gate and
 * the grand total must agree about which assessments are continuous assessment.
 *
 * Returns `[]` when the policy resolves to nothing, which happens with fewer than two
 * assessments: there is no CAT/FAT split, so there is no gate to report. A single-assessment
 * course falls back to equal weighting in the export and has no eligibility concept here.
 */
export function buildCatEligibility(
  stored: StoredGradingConfig,
  assessments: readonly EligibilityAssessment[],
  students: readonly EligibilityStudent[],
  /**
   * The clock the inclusion rule is judged against. Defaults to now; tests pass a fixed instant
   * rather than dating their fixtures around the day the suite happens to run.
   */
  options: { now?: Date } = {},
): CatEligibilityRow[] {
  // Goes through the resolver, so an unusable stored config defaults rather than producing a
  // verdict against zero weights — and an offering with a corrupt column still reports the
  // gate against the documented default split.
  const now = options.now ?? new Date()
  const { config } = resolveGradingPolicy(stored)
  const resolved = resolveFinalGradeConfig(config, assessments)
  if (resolved === null) return []

  const catCategory = resolved.categories.find((category) => category.id === "cat")
  const catIds = new Set(catCategory?.assessmentIds ?? [])
  /*
   * Only CAT work that has **fallen due** counts toward the gate.
   *
   * The completion ratio exists to avoid judging a student on evidence that barely exists, but
   * its denominator originally included every CAT assessment on the course — including the ones
   * still ahead. That inverts the rule: a course three weeks into a term would report
   * `insufficient-cat-work` for the whole cohort, not because marking is behind but because the
   * term is not over, and the gate could never reach a verdict until the final week. The
   * question the ratio should answer is "of the continuous assessment that has actually
   * happened, how much is marked?"
   *
   * `percent` is unaffected: `isMarkIncludedInMean` already excluded not-yet-due assessments
   * from the mean, so this only corrects the denominator.
   *
   * With nothing yet due there is nothing to judge, and the zero-length progress below reports
   * `insufficient-cat-work` — honest, and it is why an offering early in its term shows no
   * verdicts rather than failing everyone.
   */
  const dueCatAssessments = assessments.filter(
    (assessment) => catIds.has(assessment.id) && isPastDue(assessment.dueDate, now),
  )
  if (dueCatAssessments.length === 0) return []

  const minimumCatPercent = config.minimumCatPercent
  const gateEnabled = minimumCatPercent !== null

  return students.map((student) => {
    const byAssessment = new Map(student.marks.map((mark) => [mark.assessmentId, mark]))

    const progress = catProgress(
      dueCatAssessments.map((assessment) => {
        const mark = byAssessment.get(assessment.id) ?? null
        return {
          // The percentage is unused when `included` is false, so the placeholder cannot leak
          // into the mean — `catProgress` filters on `included` before averaging.
          percentage: mark?.percentage ?? 0,
          included: isMarkIncludedInMean(assessment, mark, now),
        }
      }),
    )

    const eligibility = evaluateFatEligibility(progress, { minimumCatPercent })

    return {
      studentId: student.id,
      name: student.name,
      registerNumber: student.registerNumber,
      progress,
      eligibility,
      status: toStatus(eligibility, gateEnabled),
    }
  })
}
