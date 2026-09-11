import { z } from "zod"

import { nonEmptyString } from "./common"

/**
 * The grading pipeline contract: `AIGradeSuggestion` -> `GradeReview` -> `Grade`.
 *
 * These schemas are the single definition of the explainability envelope every
 * AI score must carry, and of the only actions a human reviewer may take.
 */

export const gradeReviewStatusSchema = z.enum([
  "PENDING",
  "AUTO_ACCEPTED",
  "NEEDS_REVIEW",
  "OVERRIDDEN",
  "REJECTED",
])
export type GradeReviewStatusValue = z.infer<typeof gradeReviewStatusSchema>

export const gradeSourceSchema = z.enum(["AI_SUGGESTED", "TEACHER_OVERRIDE", "AUTO", "IMPORTED"])

/**
 * One per criterion (rubric grading) or per quiz response. The envelope fields
 * (`rationale`, `evidence`, `confidence`, `model`, `promptVersion`, `latencyMs`)
 * are mandatory so no AI score can be stored without an explanation.
 */
export const aiGradeSuggestionInputSchema = z.object({
  assessmentId: nonEmptyString,
  studentId: nonEmptyString,
  submissionId: nonEmptyString.optional(),
  quizResponseId: nonEmptyString.optional(),
  rubricCriterionId: nonEmptyString.optional(),
  criterionLabel: nonEmptyString.optional(),
  suggestedPoints: z.number().nonnegative(),
  maxPoints: z.number().nonnegative().optional(),
  rationale: nonEmptyString,
  evidence: z.string().trim().min(1).optional(),
  confidence: z.number().min(0).max(1),
  model: nonEmptyString,
  promptVersion: nonEmptyString,
  promptTokens: z.number().int().nonnegative().optional(),
  completionTokens: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative(),
  rawResponse: z.unknown().optional(),
})
export type AiGradeSuggestionInput = z.infer<typeof aiGradeSuggestionInputSchema>

/**
 * A human review action. `accept` and `override` are the only actions that can
 * publish a grade; both require the reviewer's authenticated identity, which the
 * service supplies from the signed session rather than the request body.
 */
export const reviewDecisionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept") }),
  z.object({ action: z.literal("flag"), notes: z.string().trim().max(2000).optional() }),
  z.object({ action: z.literal("reject"), reason: z.string().trim().max(2000).optional() }),
  z.object({
    action: z.literal("override"),
    points: z.number().nonnegative(),
    reason: nonEmptyString.max(2000),
  }),
  z.object({ action: z.literal("reopen") }),
])
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>

export const reviewActionSchema = z.enum(["accept", "override", "reject", "flag", "reopen"])

export const gradeReviewResponseSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  studentId: z.string(),
  status: gradeReviewStatusSchema,
  reviewerId: z.string().nullable(),
  notes: z.string().nullable(),
  decidedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type GradeReviewResponse = z.infer<typeof gradeReviewResponseSchema>

export const gradeResponseSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  studentId: z.string(),
  points: z.number(),
  maxPoints: z.number(),
  percentage: z.number().nullable(),
  source: gradeSourceSchema,
  approvedById: z.string().nullable(),
  overrideReason: z.string().nullable(),
  publishedAt: z.string().nullable(),
  isPublished: z.boolean(),
})
export type GradeResponse = z.infer<typeof gradeResponseSchema>

export const aiGradeSuggestionResponseSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  studentId: z.string(),
  criterionLabel: z.string().nullable(),
  suggestedPoints: z.number(),
  maxPoints: z.number().nullable(),
  rationale: z.string(),
  evidence: z.string().nullable(),
  confidence: z.number(),
  model: z.string(),
  promptVersion: z.string(),
  latencyMs: z.number(),
  createdAt: z.string(),
})
export type AiGradeSuggestionResponse = z.infer<typeof aiGradeSuggestionResponseSchema>

export const reviewPipelineResponseSchema = z.object({
  suggestion: aiGradeSuggestionResponseSchema.optional(),
  review: gradeReviewResponseSchema,
  grade: gradeResponseSchema,
})
export type ReviewPipelineResponse = z.infer<typeof reviewPipelineResponseSchema>
