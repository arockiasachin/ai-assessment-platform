import { z } from "zod"

import { nonEmptyString } from "@/lib/contracts/common"
import {
  aiGradeSuggestionResponseSchema,
  gradeResponseSchema,
  gradeReviewStatusSchema,
  gradeReviewResponseSchema,
  reviewDecisionSchema,
} from "@/lib/contracts/grading"

/**
 * The rubric-grading API contract.
 *
 * These schemas are the pod's own boundary (kept out of the shared
 * `lib/contracts/grading.ts` so the pod can evolve without stomping the quiz
 * and code pods). The decision schema is deliberately reused from the Phase 1
 * grading contract: `accept`/`override` remain the only publishing actions, and
 * that definition lives in exactly one place.
 */

export const rubricLevelInputSchema = z.object({
  /** Human label such as "Excellent" or "Developing". */
  label: nonEmptyString.max(120),
  /** The behaviourally-anchored descriptor for this level. */
  descriptor: z.string().trim().max(2000).optional(),
  /** Points awarded for this level. Never above the criterion's own ceiling. */
  points: z.number().finite().nonnegative().max(1_000_000),
})
export type RubricLevelInput = z.infer<typeof rubricLevelInputSchema>

export const rubricCriterionInputSchema = z.object({
  label: nonEmptyString.max(200),
  description: z.string().trim().max(2000).optional(),
  /** Relative emphasis. Must be positive; the model still scores against points. */
  weight: z.number().finite().positive().max(1000),
  /** The criterion's point ceiling. The model may not score above it. */
  maxPoints: z.number().finite().positive().max(1_000_000),
  levels: z.array(rubricLevelInputSchema).max(20).optional(),
})
export type RubricCriterionInput = z.infer<typeof rubricCriterionInputSchema>

export const rubricUpsertRequestSchema = z.object({
  assessmentId: nonEmptyString,
  title: nonEmptyString.max(300),
  description: z.string().trim().max(4000).optional(),
  /** Bumping this is what makes an override traceable to a prompt revision. */
  promptVersion: z.string().trim().max(50).optional(),
  /** Optional explicit total; must equal the sum of criterion points when set. */
  maxPoints: z.number().finite().positive().max(1_000_000).optional(),
  criteria: z
    .array(rubricCriterionInputSchema)
    .min(1, "A rubric needs at least one criterion.")
    .max(50),
})
export type RubricUpsertRequest = z.infer<typeof rubricUpsertRequestSchema>

export const rubricCriterionResponseSchema = z.object({
  id: z.string(),
  rubricId: z.string(),
  order: z.number().int(),
  label: z.string(),
  description: z.string().nullable(),
  weight: z.number(),
  maxPoints: z.number(),
  levels: z.array(rubricLevelInputSchema),
})
export type RubricCriterionResponse = z.infer<typeof rubricCriterionResponseSchema>

export const rubricResponseSchema = z.object({
  id: z.string(),
  assessmentId: z.string().nullable(),
  courseId: z.string().nullable(),
  title: z.string(),
  description: z.string().nullable(),
  maxPoints: z.number().nullable(),
  promptVersion: z.string(),
  criteria: z.array(rubricCriterionResponseSchema),
})
export type RubricResponse = z.infer<typeof rubricResponseSchema>

/** One assessment in the authoring list, with its rubric when one exists. */
export const teacherAssessmentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  maxMarks: z.number(),
  dueDate: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  className: z.string(),
  rubric: rubricResponseSchema.nullable(),
  /**
   * True when this assessment already has a rubric *and* a published grade was
   * produced against it, so the rubric can no longer be edited (TN-44). The
   * editor can therefore show the state before Save is attempted.
   */
  locked: z.boolean(),
})
export type TeacherAssessmentSummary = z.infer<typeof teacherAssessmentSummarySchema>

/** `POST /api/teacher/reviews/evaluate` request body. */
export const evaluationRequestSchema = z.object({
  submissionId: nonEmptyString,
})
export type EvaluationRequest = z.infer<typeof evaluationRequestSchema>

/** One row of `GET /api/teacher/reviews`. */
export const reviewQueueItemSchema = z.object({
  submission: z.object({
    id: z.string(),
    status: z.string(),
    contentText: z.string().nullable(),
    submittedAt: z.string().nullable(),
  }),
  student: z.object({
    id: z.string(),
    fullName: z.string(),
    registerNumber: z.string(),
    email: z.string(),
  }),
  assessment: z.object({
    id: z.string(),
    title: z.string(),
    maxMarks: z.number(),
    courseCode: z.string(),
    courseName: z.string(),
    className: z.string(),
  }),
  review: gradeReviewResponseSchema,
  grade: gradeResponseSchema.nullable(),
  suggestions: z.array(aiGradeSuggestionResponseSchema),
  /** Human-readable reasons the submission was flagged (empty when clean). */
  flags: z.array(z.string()),
})
export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>

/** `GET /api/teacher/reviews/candidates` — submissions ready for AI evaluation. */ export const evaluationCandidateSchema =
  z.object({
    submissionId: z.string(),
    status: z.string(),
    submittedAt: z.string().nullable(),
    student: z.object({
      id: z.string(),
      fullName: z.string(),
      registerNumber: z.string(),
    }),
    assessment: z.object({
      id: z.string(),
      title: z.string(),
      maxMarks: z.number(),
      rubricMaxPoints: z.number(),
    }),
    hasSuggestions: z.boolean(),
    reviewStatus: gradeReviewStatusSchema.nullable(),
    gradePublished: z.boolean(),
  })
export type EvaluationCandidate = z.infer<typeof evaluationCandidateSchema>

/** `POST /api/teacher/reviews/[assessmentId]/[studentId]` request body. */
export const reviewDecisionRequestSchema = reviewDecisionSchema
export type ReviewDecisionRequest = z.infer<typeof reviewDecisionRequestSchema>
