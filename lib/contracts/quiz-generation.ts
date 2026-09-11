import { z } from "zod"

import { nonEmptyString } from "./common"

/**
 * The LLM quiz-generation API contract.
 *
 * Server-authoritative rule: the answer key lives in `QuestionOption.isCorrect`
 * on the server. The teacher-authoring response (`correctOptionId`) is only ever
 * returned to the owning teacher, behind `requireRole("teacher")` plus an
 * object-level ownership check. The student-facing serializer
 * (`generatedQuestionForStudentSchema`) deliberately has no answer-key field at
 * all, and grading is delegated to the existing `lib/quiz-scoring` kernel.
 */

/** Options the model may return per question. The spec requires 4-5. */
export const GENERATED_OPTION_MIN = 4
export const GENERATED_OPTION_MAX = 5

export const generatedOptionResponseSchema = z.object({
  id: z.string(),
  order: z.number().int(),
  text: z.string(),
  rationale: z.string().nullable(),
})
export type GeneratedOptionResponse = z.infer<typeof generatedOptionResponseSchema>

export const generatedQuestionStatusSchema = z.enum(["draft", "published"])
export type GeneratedQuestionStatus = z.infer<typeof generatedQuestionStatusSchema>

/**
 * A generated question as returned to its owning teacher for review and edit.
 *
 * `correctOptionId` is the answer key. It is present only on teacher-authoring
 * responses; it is never included in a student-facing payload.
 */
export const generatedQuestionResponseSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  type: z.string(),
  order: z.number().int(),
  prompt: z.string(),
  explanation: z.string().nullable(),
  subtopic: z.string().nullable(),
  /** Normalized difficulty in [0, 1]; `null` when the model omitted one. */
  difficulty: z.number().nullable(),
  points: z.number(),
  status: generatedQuestionStatusSchema,
  publishedAt: z.string().nullable(),
  promptVersion: z.string().nullable(),
  model: z.string().nullable(),
  topic: z.string().nullable(),
  sourceChunkIds: z.array(z.string()),
  options: z.array(generatedOptionResponseSchema),
  correctOptionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})
export type GeneratedQuestionResponse = z.infer<typeof generatedQuestionResponseSchema>

/**
 * The student-facing shape: identical except it has no answer key, no model or
 * prompt provenance, and no draft/publish state. `serializeQuestionForStudent`
 * emits exactly this, and a test asserts the payload never contains a key.
 */
export const generatedQuestionForStudentSchema = z.object({
  id: z.string(),
  assessmentId: z.string(),
  order: z.number().int(),
  type: z.string(),
  prompt: z.string(),
  explanation: z.string().nullable(),
  subtopic: z.string().nullable(),
  difficulty: z.number().nullable(),
  points: z.number(),
  options: z.array(
    z.object({
      id: z.string(),
      order: z.number().int(),
      text: z.string(),
    }),
  ),
})
export type GeneratedQuestionForStudent = z.infer<typeof generatedQuestionForStudentSchema>

export const quizGenerationDifficultyTargetSchema = z.enum(["easy", "medium", "hard", "mixed"])
export type QuizGenerationDifficultyTarget = z.infer<typeof quizGenerationDifficultyTargetSchema>

/** `POST /api/teacher/quiz-generation` request body. */
export const quizGenerationRequestSchema = z.object({
  assessmentId: nonEmptyString,
  /** The lesson/topic description the teacher supplies. */
  topic: nonEmptyString.max(4000),
  questionCount: z.number().int().min(1).max(20).default(5),
  difficulty: quizGenerationDifficultyTargetSchema.default("mixed"),
  subtopics: z
    .array(z.string().trim().min(1).max(200))
    .max(20, "At most 20 subtopics are supported.")
    .optional(),
  /** How many material chunks to retrieve as grounding context (1-20). */
  retrievalLimit: z.number().int().min(1).max(20).optional(),
})
export type QuizGenerationRequest = z.infer<typeof quizGenerationRequestSchema>

export const quizGenerationRetrievalSummarySchema = z.object({
  chunkCount: z.number().int(),
  sourceTitles: z.array(z.string()),
  chunkIds: z.array(z.string()),
})
export type QuizGenerationRetrievalSummary = z.infer<typeof quizGenerationRetrievalSummarySchema>

export const quizGenerationResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  retrieval: quizGenerationRetrievalSummarySchema,
  questions: z.array(generatedQuestionResponseSchema),
})
export type QuizGenerationResponse = z.infer<typeof quizGenerationResponseSchema>

export const generatedQuestionListResponseSchema = z.object({
  success: z.literal(true),
  questions: z.array(generatedQuestionResponseSchema),
})
export type GeneratedQuestionListResponse = z.infer<typeof generatedQuestionListResponseSchema>

export const generatedOptionInputSchema = z.object({
  /** Present when editing an option in place; omitted for a new option. */
  id: nonEmptyString.optional(),
  text: nonEmptyString.max(2000),
  isCorrect: z.boolean(),
  rationale: z.string().trim().max(2000).optional(),
})
export type GeneratedOptionInput = z.infer<typeof generatedOptionInputSchema>

/**
 * `PATCH /api/teacher/quiz-generation/[questionId]`. Every field is optional,
 * but at least one must be present, and when options are supplied exactly one
 * must be marked correct.
 */
export const generatedQuestionEditRequestSchema = z
  .object({
    prompt: nonEmptyString.max(5000).optional(),
    explanation: z.string().trim().max(4000).nullable().optional(),
    subtopic: z.string().trim().max(200).nullable().optional(),
    difficulty: z.number().finite().min(0).max(1).nullable().optional(),
    points: z.number().finite().positive().max(1000).optional(),
    options: z
      .array(generatedOptionInputSchema)
      .min(GENERATED_OPTION_MIN, "A question needs at least 4 options.")
      .max(GENERATED_OPTION_MAX, "A question can have at most 5 options.")
      .optional(),
  })
  .refine(
    (value) =>
      [
        value.prompt,
        value.explanation,
        value.subtopic,
        value.difficulty,
        value.points,
        value.options,
      ].some((field) => field !== undefined),
    { message: "At least one field must be provided." },
  )
  .refine(
    (value) => !value.options || value.options.filter((option) => option.isCorrect).length === 1,
    { message: "Exactly one option must be marked correct." },
  )
export type GeneratedQuestionEditRequest = z.infer<typeof generatedQuestionEditRequestSchema>

/** `POST /api/teacher/quiz-generation/publish` request body. */
export const publishQuestionsRequestSchema = z.object({
  assessmentId: nonEmptyString,
  /** Omit to publish every draft question on the owned assessment. */
  questionIds: z.array(nonEmptyString).min(1).max(100).optional(),
})
export type PublishQuestionsRequest = z.infer<typeof publishQuestionsRequestSchema>

export const publishQuestionsResponseSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  published: z.array(generatedQuestionResponseSchema),
  /** Question ids that were already published and therefore left untouched. */
  alreadyPublished: z.array(z.string()),
})
export type PublishQuestionsResponse = z.infer<typeof publishQuestionsResponseSchema>

export const generatedQuestionResponseEnvelopeSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  question: generatedQuestionResponseSchema,
})
export type GeneratedQuestionResponseEnvelope = z.infer<
  typeof generatedQuestionResponseEnvelopeSchema
>

/** One option in the teacher's assessment picker. */
export const generationAssessmentSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.string(),
  maxMarks: z.number(),
  dueDate: z.string(),
  courseCode: z.string(),
  courseName: z.string(),
  className: z.string(),
  generatedQuestionCount: z.number().int(),
  draftCount: z.number().int(),
  publishedCount: z.number().int(),
})
export type GenerationAssessmentSummary = z.infer<typeof generationAssessmentSummarySchema>

export const generationAssessmentsResponseSchema = z.object({
  success: z.literal(true),
  assessments: z.array(generationAssessmentSummarySchema),
})
export type GenerationAssessmentsResponse = z.infer<typeof generationAssessmentsResponseSchema>
