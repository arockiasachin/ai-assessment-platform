import { z } from "zod"

/**
 * Contracts for the course-level settings a teacher owns.
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
 * `PATCH /api/teacher/courses/[courseId]/category` request body.
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
