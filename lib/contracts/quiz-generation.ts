import { z } from "zod"

import { nonEmptyString } from "./common"

/**
 * Quiz generation API contract (Phase 2, pod 1).
 *
 * These schemas are the pod's boundary: the teacher-facing generation/edit/
 * publish payloads and the two delivery payloads. The grading request/response
 * are deliberately NOT redefined here — the delivery routes reuse
 * `quizGradeRequestSchema` / `quizGradeResponseSchema` from `./quiz` so the
 * server-authoritative answer-key path has exactly one definition.
 */

/** Generated multiple-choice questions carry 4-5 options (product spec). */
export const QUIZ_GENERATION_MIN_OPTIONS = 4
export const QUIZ_GENERATION_MAX_OPTIONS = 5
/** Difficulty is an integer-like value on a 1 (easiest) to 5 (hardest) scale. */
export const QUIZ_GENERATION_MIN_DIFFICULTY = 1
export const QUIZ_GENERATION_MAX_DIFFICULTY = 5

export const quizGenerationStateSchema = z.enum(["DRAFT", "PUBLISHED"])
export type QuizGenerationState = z.infer<typeof quizGenerationStateSchema>

/** One option as authored/edited by a teacher or emitted by the model. */
export const quizGenerationOptionInputSchema = z.object({
  text: nonEmptyString.max(1000),
  /** Exactly one option per question may be correct (enforced by the service). */
  isCorrect: z.boolean(),
  /** Why the option is (in)correct — distractors must target a misconception. */
  rationale: nonEmptyString.max(1000),
})
export type QuizGenerationOptionInput = z.infer<typeof quizGenerationOptionInputSchema>

export const quizGenerationOptionsInputSchema = z
  .array(quizGenerationOptionInputSchema)
  .min(QUIZ_GENERATION_MIN_OPTIONS)
  .max(QUIZ_GENERATION_MAX_OPTIONS)
  .refine((options) => options.filter((option) => option.isCorrect).length === 1, {
    message: "Exactly one option must be marked correct.",
  })

/** `POST /api/teacher/quiz/generate` request body. */
export const quizGenerationRequestSchema = z.object({
  assessmentId: nonEmptyString,
  /** The topic or lesson description to retrieve material for and generate from. */
  topic: nonEmptyString.max(2000),
  /** How many questions to draft. Acceptance requires exactly this many back. */
  questionCount: z.number().int().min(1).max(20).optional(),
  /** How many retrieved chunks to feed the model (1-20). */
  materialLimit: z.number().int().min(1).max(20).optional(),
})
export type QuizGenerationRequest = z.infer<typeof quizGenerationRequestSchema>

/** `PATCH /api/teacher/quiz/questions/[questionId]` request body. */
export const quizDraftUpdateRequestSchema = z
  .object({
    prompt: nonEmptyString.max(2000).optional(),
    subtopic: nonEmptyString.max(200).optional(),
    difficulty: z
      .number()
      .finite()
      .min(QUIZ_GENERATION_MIN_DIFFICULTY)
      .max(QUIZ_GENERATION_MAX_DIFFICULTY)
      .optional(),
    explanation: nonEmptyString.max(2000).optional(),
    options: quizGenerationOptionsInputSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update.",
  })
export type QuizDraftUpdateRequest = z.infer<typeof quizDraftUpdateRequestSchema>

/** `POST /api/teacher/quiz/publish` request body. */
export const quizPublishRequestSchema = z.object({
  assessmentId: nonEmptyString,
  questionIds: z.array(nonEmptyString).min(1, "Select at least one question.").max(200),
})
export type QuizPublishRequest = z.infer<typeof quizPublishRequestSchema>

/** Teacher/owner view of one option (includes the answer key and rationales). */
export const quizGenerationOptionResponseSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  text: z.string(),
  isCorrect: z.boolean(),
  rationale: z.string().nullable(),
})
export type QuizGenerationOptionResponse = z.infer<typeof quizGenerationOptionResponseSchema>

/** Teacher/owner view of one question. Owner-only: it carries the answer key. */
export const quizGenerationQuestionResponseSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  order: z.number().int(),
  prompt: z.string(),
  explanation: z.string().nullable(),
  subtopic: z.string().nullable(),
  difficulty: z.number().nullable(),
  state: quizGenerationStateSchema,
  promptVersion: z.string().nullable(),
  createdAt: z.string(),
  options: z.array(quizGenerationOptionResponseSchema),
})
export type QuizGenerationQuestionResponse = z.infer<typeof quizGenerationQuestionResponseSchema>

export const quizGenerationListResponseSchema = z.object({
  assessmentId: z.string(),
  counts: z.object({
    draft: z.number().int(),
    published: z.number().int(),
  }),
  questions: z.array(quizGenerationQuestionResponseSchema),
})
export type QuizGenerationListResponse = z.infer<typeof quizGenerationListResponseSchema>

/**
 * Student-facing published-question view. This shape is intentionally narrower
 * than the owner view: it has no `isCorrect`, no `rationale`, and no
 * `explanation`. The answer key is only ever produced after a server-side grade.
 */
export const publishedQuizOptionSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  text: z.string(),
})
export type PublishedQuizOption = z.infer<typeof publishedQuizOptionSchema>

export const publishedQuizQuestionSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  subtopic: z.string().nullable(),
  difficulty: z.number().nullable(),
  options: z.array(publishedQuizOptionSchema),
})
export type PublishedQuizQuestion = z.infer<typeof publishedQuizQuestionSchema>

export const publishedQuizResponseSchema = z.object({
  assessmentId: z.string(),
  title: z.string(),
  questions: z.array(publishedQuizQuestionSchema),
})
export type PublishedQuizResponse = z.infer<typeof publishedQuizResponseSchema>

/** One quiz assessment the teacher owns, for the generation UI. */
export const ownedQuizAssessmentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  className: z.string(),
  maxMarks: z.number(),
  draftCount: z.number().int(),
  publishedCount: z.number().int(),
})
export type OwnedQuizAssessmentSummary = z.infer<typeof ownedQuizAssessmentSummarySchema>
