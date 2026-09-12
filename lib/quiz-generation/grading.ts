import type { QuizAnswer } from "@/lib/contracts/quiz"
import {
  isTextQuestionType,
  QuizScoringError,
  scoreQuiz,
  type ScorableQuizQuestion,
  type ScoredQuiz,
} from "@/lib/quiz-scoring"

import { QuizGenerationError } from "./errors"

/**
 * Server-side grading for generated questions.
 *
 * This is the reuse point for the existing server-authoritative grading path:
 * generated `Question` / `QuestionOption` rows are projected into the exact
 * `ScorableQuizQuestion` shape `lib/quiz-scoring.ts` already scores, and
 * `scoreQuiz` derives choice correctness only from the server-side answer key.
 *
 * Free-text (`SHORT_ANSWER`/`ESSAY`) questions have no option key. They are
 * projected with the similarity the caller computed (semantic grader or its
 * deterministic fallback) and a `-1` sentinel index, so the kernel awards
 * partial credit without ever requiring a correct option.
 *
 * Nothing in this module returns an answer key to a client; the caller decides
 * what to disclose (the existing quiz path discloses the correct answer only in
 * the post-submission grading response, per the product spec). There is no
 * client-side correctness logic anywhere in the generation pod.
 */

export type GeneratedQuestionForScoring = {
  id: string
  prompt: string
  explanation: string | null
  options: ReadonlyArray<{ text: string; isCorrect: boolean }>
  /** Optional per-question weight; the kernel falls back to 1 when absent. */
  points?: number
  /** The question type; `SHORT_ANSWER`/`ESSAY` are graded from free text. */
  type?: string | null
  /** Free-text similarity in [0, 1], supplied by the caller for text questions. */
  textSimilarity?: number | null
  /** Whether the text answer cleared the caller's similarity threshold. */
  textEligible?: boolean
  /** The student's prose (echoed into the result, not an answer key). */
  answerText?: string | null
  rationale?: string | null
  confidence?: number | null
  needsManualReview?: boolean
}

export function gradeGeneratedQuiz(
  questions: readonly GeneratedQuestionForScoring[],
  answers: QuizAnswer[],
  maxScore: number,
): ScoredQuiz {
  const scorable: ScorableQuizQuestion[] = questions.map((question) => {
    if (isTextQuestionType(question.type)) {
      return {
        id: question.id,
        prompt: question.prompt,
        options: [],
        correctIndex: -1,
        explanation: question.explanation,
        points: question.points,
        type: question.type,
        textSimilarity: question.textSimilarity,
        textEligible: question.textEligible,
        answerText: question.answerText,
        rationale: question.rationale,
        confidence: question.confidence,
        needsManualReview: question.needsManualReview,
      }
    }

    const correctIndex = question.options.findIndex((option) => option.isCorrect)
    if (correctIndex < 0) {
      throw new QuizGenerationError(
        409,
        `Question ${question.id} has no correct option and cannot be graded.`,
      )
    }
    return {
      id: question.id,
      prompt: question.prompt,
      options: question.options.map((option) => option.text),
      correctIndex,
      explanation: question.explanation,
      points: question.points,
      type: question.type,
    }
  })

  try {
    return scoreQuiz(scorable, answers, maxScore)
  } catch (error) {
    if (error instanceof QuizScoringError) {
      throw new QuizGenerationError(400, error.message)
    }
    throw error
  }
}
