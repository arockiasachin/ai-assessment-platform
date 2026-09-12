import { z } from "zod"

import { nonEmptyString } from "./common"

/**
 * Server-authoritative quiz grading contract.
 *
 * The client sends only the answers it selected (a choice index and/or prose).
 * It never sends, and never receives, correctness or an answer key until the
 * server has graded the submission; the response then includes the correct
 * option per the product spec ("students receive per-question correctness,
 * their answer, the correct answer, and an explanation").
 */

/**
 * The maximum accepted length of a free-text answer, in characters. Chosen to
 * hold a generous short-answer/essay response (roughly 1,500 words) while
 * bounding the storage and model-prompt cost of a single submission. Longer
 * text is rejected at the contract boundary with a `400`.
 */
export const MAX_ANSWER_TEXT_LENGTH = 10_000

export const quizAnswerSchema = z.object({
  questionId: nonEmptyString,
  /** `null` means the question was left unanswered. */
  selectedIndex: z.number().int().nonnegative().nullable(),
  /**
   * The student's prose answer for a `SHORT_ANSWER`/`ESSAY` question. Never
   * accepted for a choice question, and never accepted alongside a
   * `selectedIndex`; the service enforces both against the question type.
   */
  answerText: z.string().trim().max(MAX_ANSWER_TEXT_LENGTH).optional(),
})
export type QuizAnswer = z.infer<typeof quizAnswerSchema>

export const quizGradeRequestSchema = z.object({
  assessmentId: nonEmptyString,
  /**
   * Only meaningful for a teacher/admin previewing a student's attempt. A
   * student's own profile is always resolved from the signed session, so a
   * student cannot grade on another student's behalf.
   */
  studentId: nonEmptyString.optional(),
  answers: z.array(quizAnswerSchema).min(1, "At least one answer is required."),
})
export type QuizGradeRequest = z.infer<typeof quizGradeRequestSchema>

export const quizQuestionResultSchema = z.object({
  questionId: z.string(),
  prompt: z.string(),
  selectedIndex: z.number().int().nullable(),
  selectedText: z.string().nullable(),
  /** `-1` on a free-text question, which has no option key. */
  correctIndex: z.number().int(),
  correctText: z.string(),
  explanation: z.string().nullable(),
  /**
   * `null` means neither fully correct nor wrong — an unanswered question, or a
   * free-text answer that earned partial credit. Free text never returns a
   * boolean "wrong" for a partially correct response.
   */
  isCorrect: z.boolean().nullable(),
  points: z.number(),
  maxPoints: z.number(),
  /** The student's prose answer, echoed back after submission. */
  answerText: z.string().nullable(),
  /** The grader's justification for a free-text answer. */
  rationale: z.string().nullable(),
  /** The grader's confidence in [0, 1] for a free-text answer. */
  confidence: z.number().nullable(),
  /** The similarity the free-text scorer used, in [0, 1]. */
  similarity: z.number().nullable(),
  /** True when a free-text answer had no reference answer and needs a human. */
  needsManualReview: z.boolean(),
})
export type QuizQuestionResult = z.infer<typeof quizQuestionResultSchema>

export const quizGradeResponseSchema = z.object({
  success: z.literal(true),
  assessmentId: z.string(),
  title: z.string(),
  score: z.number(),
  maxScore: z.number(),
  correctCount: z.number().int(),
  totalQuestions: z.number().int(),
  results: z.array(quizQuestionResultSchema),
})
export type QuizGradeResponse = z.infer<typeof quizGradeResponseSchema>
