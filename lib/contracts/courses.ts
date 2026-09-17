import { z } from "zod"

/**
 * Contracts for the course-level settings an admin owns.
 *
 * The category is the only one so far, and it exists because VIT's grading regime is chosen
 * from it: theory and lab-embedded theory are graded relatively above 10 students, every
 * other category absolutely at any size. Without it the platform cannot decide which bands
 * apply, so it falls back to absolute with a warning rather than guessing.
 */

export const courseCategorySchema = z.enum([
  "THEORY",
  "LAB_EMBEDDED_THEORY",
  "LABORATORY",
  "PROJECT",
  "SOFT_SKILLS",
  "EXTRA_CURRICULAR",
  "NGCR",
])
export type CourseCategoryValue = z.infer<typeof courseCategorySchema>

/**
 * `PATCH /api/admin/courses/[courseId]/category` request body.
 *
 * Deliberately **not** accepting `null`. Clearing the category is a meaningful action — it
 * returns the course to the fallback — but it should be its own explicit operation rather
 * than something a client can do by omitting a field, which is how a category gets wiped by
 * a client that never knew about it.
 */
export const updateCourseCategoryRequestSchema = z.object({
  category: courseCategorySchema,
})
export type UpdateCourseCategoryRequest = z.infer<typeof updateCourseCategoryRequestSchema>

export const updateCourseCategoryResponseSchema = z.object({
  success: z.literal(true),
  courseId: z.string(),
  /** The value now stored. */
  category: courseCategorySchema,
  /** What the change means for grading, so a caller need not re-derive it. */
  gradingEffect: z.string(),
})
export type UpdateCourseCategoryResponse = z.infer<typeof updateCourseCategoryResponseSchema>

// ---------------------------------------------------------------------------
// Offering grading policy (CAT / FAT weights and the FAT gate)
// ---------------------------------------------------------------------------

/**
 * The course grading policy stored on `CourseOffering.gradingConfig`.
 *
 * **What is not here, deliberately: category membership.** The policy says what the split
 * is and which assessment is the final one; which assessments fall in each pool is derived
 * from the offering's assessments at read time (`lib/grading/offering-config.ts`). Storing
 * an `assessmentIds` list instead would hard-bind the configuration to the assessment set
 * as it was when the teacher saved it, so adding an assessment afterwards would silently
 * drop it from the weighted total.
 *
 * `finalAssessmentId: null` means "derive it", which the resolver does by taking the last
 * assessment to fall due. That is a heuristic and is named as one in
 * `deriveDefaultGradingConfig`; setting an id here is how a teacher overrides it.
 *
 * The sum-to-100 refinement is part of this schema rather than a separate one because both
 * callers need it — the API to reject a bad body, and the reader to decide that a stored
 * value is unusable and fall back to the defaults.
 */
export const offeringGradingConfigSchema = z
  .object({
    /** Percentage of the final grade carried by the CAT pool. */
    catWeight: z.number().finite().min(0).max(100),
    /** Percentage carried by the single final assessment. */
    fatWeight: z.number().finite().min(0).max(100),
    /** Which assessment is the FAT; `null` derives it from the due dates. */
    finalAssessmentId: z.string().min(1).nullable(),
    /**
     * Minimum CAT percentage required to sit the FAT. `null` disables the gate, which is
     * the only honest way to express "this course has no CAT gate" as distinct from "the
     * gate is at zero".
     */
    minimumCatPercent: z.number().finite().min(0).max(100).nullable(),
    /**
     * How much of the CAT pool must be marked before eligibility is judged. Omitted means
     * the code default (`DEFAULT_CAT_COMPLETION_RATIO`, 0.5).
     */
    minimumCatCompletionRatio: z.number().finite().gt(0).lte(1).optional(),
  })
  .refine((config) => Math.abs(config.catWeight + config.fatWeight - 100) < 0.001, {
    message: "CAT and FAT weights must sum to 100.",
    path: ["fatWeight"],
  })
export type OfferingGradingConfigValue = z.infer<typeof offeringGradingConfigSchema>

/** `GET`/`PUT /api/teacher/offerings/[offeringId]/grading` request body. */
export const updateOfferingGradingRequestSchema = offeringGradingConfigSchema
export type UpdateOfferingGradingRequest = z.infer<typeof updateOfferingGradingRequestSchema>

/** One of the offering's assessments, as the policy editor needs it. */
export const gradingAssessmentOptionSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  dueDate: z.string(),
  maxMarks: z.number(),
})
export type GradingAssessmentOption = z.infer<typeof gradingAssessmentOptionSchema>

/** One student's CAT standing and FAT verdict. */
export const offeringCatEligibilityRowSchema = z.object({
  studentId: z.string(),
  name: z.string(),
  registerNumber: z.string(),
  /** Weighted CAT percentage, or `null` when nothing in the pool is marked. */
  catPercent: z.number().nullable(),
  markedCount: z.number(),
  totalCount: z.number(),
  completionRatio: z.number(),
  /**
   * `no-cat-gate` is distinct from `eligible`: the first means the course has no gate,
   * the second means the student cleared one. Collapsing them would tell a student they
   * passed a gate that does not exist.
   */
  status: z.enum(["eligible", "below-cat-minimum", "insufficient-cat-work", "no-cat-gate"]),
})
export type OfferingCatEligibilityRow = z.infer<typeof offeringCatEligibilityRowSchema>
export type OfferingGradingResponse = z.infer<typeof offeringGradingResponseSchema>

export const offeringGradingResponseSchema = z.object({
  success: z.literal(true),
  offeringId: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  /** The policy in force, whether stored or defaulted. */
  config: offeringGradingConfigSchema,
  /** True when nothing is stored and the code defaults apply. */
  usingDefaults: z.boolean(),
  /** The offering's assessments, so the editor can offer them. */
  assessments: z.array(gradingAssessmentOptionSchema),
  /**
   * What the policy resolves to against those assessments, derived server-side so the
   * editor cannot disagree with the export about the CAT/FAT membership. `null` when there
   * are fewer than two assessments: there is no split to draw, and the export falls back to
   * equal weighting.
   */
  derived: z
    .object({
      catAssessmentIds: z.array(z.string()),
      fatAssessmentId: z.string().nullable(),
      /** True when the FAT was derived from due dates rather than chosen. */
      fatDerived: z.boolean(),
    })
    .nullable(),
  /**
   * Per-student CAT progress and FAT eligibility, so the gate is visible before the export
   * rather than only implied by it. Empty when the policy resolves to no CAT/FAT split.
   *
   * **Advisory.** Nothing refuses the FAT; this reports the verdict.
   */
  roster: z.array(offeringCatEligibilityRowSchema),
})
