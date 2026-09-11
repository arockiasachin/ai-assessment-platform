import type { QuizAnswer, QuizQuestionResult } from "@/lib/contracts/quiz"

/**
 * Pure quiz scoring kernel.
 *
 * Correctness is derived *only* from the server-side `correctIndex` on each
 * scorable question — never from anything the client sent. This module is
 * intentionally free of database and Next.js imports so the scoring rule is
 * trivially unit-testable and cannot leak an answer key on its own.
 *
 * `Question.points` is the per-question weight the client is shown. Scoring is
 * weighted: a question is worth its `points` relative to the sum of every
 * question's points, and the ratio is projected onto the assessment's
 * `maxScore`. A missing, zero, or non-finite weight falls back to `1`, so a
 * quiz whose questions all keep the default of `1` scores exactly as it did
 * when every question was weighted equally (`correctCount / total × maxScore`).
 */

export class QuizScoringError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "QuizScoringError"
  }
}

/** Every question is worth 1 mark unless it declares a usable positive weight. */
export const DEFAULT_QUESTION_POINTS = 1

export function normalizeQuestionPoints(points: number | null | undefined): number {
  return typeof points === "number" && Number.isFinite(points) && points > 0
    ? points
    : DEFAULT_QUESTION_POINTS
}

export type ScorableQuizQuestion = {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
  explanation?: string | null
  /** Optional per-question weight; defaults to 1. */
  points?: number
}

export type ScoredQuiz = {
  results: QuizQuestionResult[]
  correctCount: number
  totalQuestions: number
  score: number
  maxScore: number
}

export function scoreQuiz(
  questions: ScorableQuizQuestion[],
  answers: QuizAnswer[],
  maxScore: number,
): ScoredQuiz {
  const answerByQuestion = new Map<string, QuizAnswer>()
  for (const answer of answers) {
    if (answerByQuestion.has(answer.questionId)) {
      throw new QuizScoringError(`Duplicate answer for question ${answer.questionId}.`)
    }
    answerByQuestion.set(answer.questionId, answer)
  }

  const knownIds = new Set(questions.map((question) => question.id))
  for (const answer of answers) {
    if (!knownIds.has(answer.questionId)) {
      throw new QuizScoringError(`Answer references unknown question ${answer.questionId}.`)
    }
  }

  const pointsPerQuestion = questions.map((question) => normalizeQuestionPoints(question.points))
  const totalPoints = pointsPerQuestion.reduce((sum, points) => sum + points, 0)

  let earnedPoints = 0
  const results: QuizQuestionResult[] = questions.map((question, index) => {
    const answer = answerByQuestion.get(question.id)
    const selectedIndex = answer?.selectedIndex ?? null
    const isCorrect = selectedIndex !== null && selectedIndex === question.correctIndex
    const maxPoints = pointsPerQuestion[index]
    const points = isCorrect ? maxPoints : 0
    if (isCorrect) earnedPoints += maxPoints

    return {
      questionId: question.id,
      prompt: question.prompt,
      selectedIndex,
      selectedText: selectedIndex !== null ? (question.options[selectedIndex] ?? null) : null,
      correctIndex: question.correctIndex,
      correctText: question.options[question.correctIndex] ?? "",
      explanation: question.explanation ?? null,
      isCorrect,
      points,
      maxPoints,
    }
  })

  const correctCount = results.filter((result) => result.isCorrect).length
  const totalQuestions = questions.length

  // `totalPoints > 0` whenever there is at least one question (every weight is
  // >= 1), so this guards the empty-quiz case rather than any real division by
  // zero. `earnedPoints <= totalPoints`, so the ratio is in [0, 1]; the clamp is
  // belt-and-braces against floating-point drift and a non-positive `maxScore`.
  const boundedMaxScore = Number.isFinite(maxScore) && maxScore > 0 ? maxScore : 0
  const ratio = totalPoints > 0 ? earnedPoints / totalPoints : 0
  const score = Math.max(0, Math.min(boundedMaxScore, Math.round(ratio * boundedMaxScore)))

  return {
    results,
    correctCount,
    totalQuestions,
    score,
    maxScore: boundedMaxScore,
  }
}
