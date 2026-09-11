import { z } from "zod"

import { nonEmptyString } from "./common"

/**
 * Server-authoritative quiz grading contract.
 *
 * The client sends only the answers it selected. It never sends, and never
 * receives, correctness or an answer key until the server has graded the
 * submission; the response then includes the correct option per the product
 * spec ("students receive per-question correctness, their answer, the correct
 * answer, and an explanation").
 */

export const quizAnswerSchema = z.object({
  questionId: nonEmptyString,
  /** `null` means the question was left unanswered. */
  selectedIndex: z.number().int().nonnegative().nullable(),
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
  correctIndex: z.number().int(),
  correctText: z.string(),
  explanation: z.string().nullable(),
  isCorrect: z.boolean(),
  points: z.number(),
  maxPoints: z.number(),
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
