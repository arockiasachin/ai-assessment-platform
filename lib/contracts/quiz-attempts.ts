import { z } from "zod"

import { nonEmptyString } from "./common"
import { gradeResponseSchema, gradeReviewResponseSchema, gradeReviewStatusSchema } from "./grading"
import { quizAnswerSchema, quizQuestionResultSchema } from "./quiz"

/**
 * The quiz-attempt persistence and delivery contract.
 *
 * Server-authoritative rules this contract encodes:
 *
 * - The client submits only `{ questionId, selectedIndex }`. It never sends and
 *   never receives a correctness value or an answer key before submission.
 * - `studentQuizQuestionSchema` deliberately has no `correctIndex`, no
 *   `correctOptionId`, no `isCorrect`, and no `explanation`: the pre-submission
 *   payload cannot hint at the answer.
 * - Only the post-submission `results` (the existing `quizQuestionResultSchema`
 *   from the legacy quiz path) disclose correctness, the chosen answer, the
 *   correct answer, and the explanation.
 */

/**
 * The `criterionLabel` used for the deterministic auto-scorer's single
 * `AIGradeSuggestion`. It is deliberately constant per assessment/student so
 * `lib/grading`'s dedupe/supersede logic treats a later attempt as the latest
 * score for the same bucket instead of adding the two attempts together.
 */
export const QUIZ_ATTEMPT_CRITERION_LABEL = "Quiz score"

/** The `AIGradeSuggestion.model` value that marks a deterministic auto-scorer. */
export const QUIZ_AUTO_SCORER_MODEL = "deterministic-auto-scorer"

/** The `AIGradeSuggestion.promptVersion` value for the scoring kernel. */
export const QUIZ_SCORING_PROMPT_VERSION = "quiz-scoring-v1"

export const quizAttemptStartRequestSchema = z.object({
  assessmentId: nonEmptyString,
})
export type QuizAttemptStartRequest = z.infer<typeof quizAttemptStartRequestSchema>

export const quizAttemptSubmitRequestSchema = z.object({
  /** One entry per answered question; `selectedIndex: null` means unanswered. */
  answers: z.array(quizAnswerSchema).min(1, "At least one answer is required."),
})
export type QuizAttemptSubmitRequest = z.infer<typeof quizAttemptSubmitRequestSchema>

export const quizAttemptStatusSchema = z.enum([
  "IN_PROGRESS",
  "SUBMITTED",
  "GRADED",
  "EXPIRED",
  "ABANDONED",
])
export type QuizAttemptStatusValue = z.infer<typeof quizAttemptStatusSchema>

/** A pre-submission option: id and text only, never a correctness flag. */
export const studentQuizOptionSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  text: z.string(),
})
export type StudentQuizOption = z.infer<typeof studentQuizOptionSchema>

/** The pre-submission question shape: no key, no explanation. */
export const studentQuizQuestionSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  prompt: z.string(),
  points: z.number(),
  options: z.array(studentQuizOptionSchema),
})
export type StudentQuizQuestion = z.infer<typeof studentQuizQuestionSchema>

export const quizAttemptSettingsSchema = z.object({
  maxAttempts: z.number().int().positive(),
  attemptsUsed: z.number().int().nonnegative(),
  attemptsRemaining: z.number().int().nonnegative(),
})
export type QuizAttemptSettings = z.infer<typeof quizAttemptSettingsSchema>

export const quizAttemptSummarySchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  assessmentTitle: z.string(),
  attemptNumber: z.number().int().positive(),
  status: quizAttemptStatusSchema,
  score: z.number().nullable(),
  maxScore: z.number().nullable(),
  startedAt: z.string(),
  submittedAt: z.string().nullable(),
  dueDate: z.string(),
  /** True when the attempt was submitted after the assessment due date. */
  isLate: z.boolean(),
})
export type QuizAttemptSummary = z.infer<typeof quizAttemptSummarySchema>

export const quizAttemptViewSchema = quizAttemptSummarySchema.extend({
  settings: quizAttemptSettingsSchema,
  /**
   * Always present and always key-free. A student can re-read the questions of a
   * submitted attempt without ever receiving the answer key from this field.
   */
  questions: z.array(studentQuizQuestionSchema),
  /**
   * `null` until the attempt is submitted, then the per-question disclosure
   * (correctness, the student's answer, the correct answer, the explanation).
   */
  results: z.array(quizQuestionResultSchema).nullable(),
})
export type QuizAttemptView = z.infer<typeof quizAttemptViewSchema>

export const studentQuizSummarySchema = z.object({
  assessmentId: z.string(),
  title: z.string(),
  dueDate: z.string(),
  maxMarks: z.number(),
  questionCount: z.number().int(),
  maxAttempts: z.number().int().positive(),
  attemptsUsed: z.number().int().nonnegative(),
  attemptsRemaining: z.number().int().nonnegative(),
  canStart: z.boolean(),
  blockedReason: z.string().nullable(),
  latestAttempt: quizAttemptSummarySchema.nullable(),
})
export type StudentQuizSummary = z.infer<typeof studentQuizSummarySchema>

export const studentQuizzesResponseSchema = z.object({
  success: z.literal(true),
  quizzes: z.array(studentQuizSummarySchema),
})
export type StudentQuizzesResponse = z.infer<typeof studentQuizzesResponseSchema>

export const quizAttemptViewResponseSchema = z.object({
  success: z.literal(true),
  attempt: quizAttemptViewSchema,
})
export type QuizAttemptViewResponse = z.infer<typeof quizAttemptViewResponseSchema>

export const quizAttemptListResponseSchema = z.object({
  success: z.literal(true),
  attempts: z.array(quizAttemptSummarySchema),
})
export type QuizAttemptListResponse = z.infer<typeof quizAttemptListResponseSchema>

// ---------------------------------------------------------------------------
// Teacher reads (owned assessments only)
// ---------------------------------------------------------------------------

export const teacherQuizAttemptSummarySchema = quizAttemptSummarySchema.extend({
  studentId: z.string(),
  studentName: z.string(),
  registerNumber: z.string(),
  reviewStatus: gradeReviewStatusSchema.nullable(),
  gradePublishedAt: z.string().nullable(),
  gradePoints: z.number().nullable(),
})
export type TeacherQuizAttemptSummary = z.infer<typeof teacherQuizAttemptSummarySchema>

export const teacherQuizResponseSchema = z.object({
  questionId: z.string(),
  prompt: z.string(),
  selectedOptionId: z.string().nullable(),
  selectedText: z.string().nullable(),
  isCorrect: z.boolean().nullable(),
  pointsAwarded: z.number().nullable(),
  maxPoints: z.number(),
  correctOptionId: z.string(),
  correctText: z.string(),
  explanation: z.string().nullable(),
})
export type TeacherQuizResponse = z.infer<typeof teacherQuizResponseSchema>

export const teacherQuizAttemptDetailSchema = z.object({
  attempt: teacherQuizAttemptSummarySchema,
  responses: z.array(teacherQuizResponseSchema),
  review: gradeReviewResponseSchema.nullable(),
  grade: gradeResponseSchema.nullable(),
})
export type TeacherQuizAttemptDetail = z.infer<typeof teacherQuizAttemptDetailSchema>

export const teacherQuizAttemptsResponseSchema = z.object({
  success: z.literal(true),
  attempts: z.array(teacherQuizAttemptSummarySchema),
})
export type TeacherQuizAttemptsResponse = z.infer<typeof teacherQuizAttemptsResponseSchema>

export const teacherQuizAttemptDetailResponseSchema = z.object({
  success: z.literal(true),
  detail: teacherQuizAttemptDetailSchema,
})
export type TeacherQuizAttemptDetailResponse = z.infer<
  typeof teacherQuizAttemptDetailResponseSchema
>
